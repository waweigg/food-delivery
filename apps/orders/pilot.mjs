const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const pilotPath = '/orders/admin/pilot';

export async function pilotAdmission(client, restaurantId) {
  // Serialize the final admission, including operator pause, after re-quoting.
  const {rows:[pilot]} = await client.query('SELECT * FROM pilot_control WHERE singleton FOR UPDATE');
  if (!pilot || pilot.paused) fail(409, 'New orders are paused. Existing orders can still be completed.');
  if (!pilot.window_id) return null;
  const {rows:[{open}]} = await client.query(
    'SELECT clock_timestamp() >= $1::timestamptz AND clock_timestamp() < $2::timestamptz AS open',
    [pilot.opens_at, pilot.closes_at],
  );
  if (!open) fail(409, 'The pilot is outside its staffed hours.');
  if (!pilot.restaurants.includes(restaurantId)) fail(409, 'This restaurant is outside the local pilot.');
  if (pilot.admitted >= pilot.order_cap) fail(409, 'The pilot has reached its order limit.');
  await client.query('UPDATE pilot_control SET admitted=admitted+1 WHERE singleton');
  return pilot.window_id;
}

export async function pilotAdmin({req, path, pool, transaction, body, admin}) {
  if (process.env.APP_ENV !== 'development' || process.env.TEST_ORDERS_ENABLED !== 'true') {
    fail(403, 'Local pilot only');
  }
  if (path === pilotPath && req.method === 'GET') {
    const {rows:[control]} = await pool.query('SELECT *,clock_timestamp() AS server_time FROM pilot_control WHERE singleton');
    const {rows:orders} = await pool.query(`
      SELECT o.id,o.restaurant_id,o.payment_state,o.delivery_state,o.order_state,
             k.state AS kitchen_state,d.state AS dispatch_state
      FROM pilot_admissions p JOIN orders o ON o.id=p.order_id
      LEFT JOIN kitchen_tickets k ON k.order_id=o.id
      LEFT JOIN order_dispatch d ON d.order_id=o.id
      WHERE p.window_id=$1 ORDER BY o.created_at
    `, [control.window_id]);
    return {control, orders};
  }
  if (path !== pilotPath || req.method !== 'POST') fail(404, 'Pilot route unavailable');
  const data = await body(req);
  if (!data || !Number.isInteger(data.version) || !['configure','pause','resume'].includes(data.action) ||
      typeof data.reason !== 'string' || data.reason.trim().length < 10 || data.reason.length > 500) {
    fail(400, 'Choose an action and enter a reason of 10–500 characters.');
  }
  return transaction(async client => {
    const {rows:[pilot]} = await client.query('SELECT * FROM pilot_control WHERE singleton FOR UPDATE');
    if (data.version !== pilot.version) fail(409, 'Pilot settings changed. Refresh and retry.');
    let updated;
    if (data.action === 'configure') {
      const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;
      const opens = timestamp(data.opensAt), closes = timestamp(data.closesAt);
      if (!(closes > opens && closes > Date.now() && closes-opens <= 86400000) ||
          !Number.isInteger(data.cap) || data.cap < 1 || data.cap > 100 ||
          !Array.isArray(data.restaurants) || !data.restaurants.length || data.restaurants.length > 20 ||
          new Set(data.restaurants).size !== data.restaurants.length ||
          data.restaurants.some(id => typeof id !== 'string' || !/^[-\w]{1,100}$/.test(id))) {
        fail(400, 'Enter a UTC window of up to 24 hours, 1–20 restaurant IDs and a cap of 1–100.');
      }
      if (!pilot.paused) fail(409, 'Pause new orders before configuring a pilot window.');
      if (pilot.admitted && (pilot.closes_at.getTime() > Date.now() || opens < pilot.closes_at.getTime())) {
        fail(409, 'The next window must start after the current staffed window ends.');
      }
      ({rows:[updated]} = await client.query(`
        UPDATE pilot_control SET window_id=gen_random_uuid(), opens_at=$1, closes_at=$2,
          restaurants=$3, order_cap=$4, admitted=0, version=version+1 WHERE singleton RETURNING *
      `, [new Date(opens), new Date(closes), data.restaurants, data.cap]));
    } else {
      ({rows:[updated]} = await client.query(
        'UPDATE pilot_control SET paused=$1,version=version+1 WHERE singleton RETURNING *',
        [data.action === 'pause'],
      ));
    }
    await client.query('INSERT INTO pilot_audit(actor,action,reason,settings) VALUES($1,$2,$3,$4)',
      [admin.id, data.action, data.reason.trim(), JSON.stringify(updated)]);
    return updated;
  });
}
