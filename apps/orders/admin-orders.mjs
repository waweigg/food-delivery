const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
async function administrator(req){
 const auth=req.headers.authorization;if(!auth)fail(401,'Sign in required');
 const r=await fetch(process.env.IDENTITY_URL+'/me',{headers:{authorization:auth},signal:AbortSignal.timeout(4000)});
 if(!r.ok)fail(r.status===401?401:503,'Unable to verify administrator');
 const a=await r.json();if(a.role!=='ADMIN'||typeof a.id!=='string')fail(403,'Admin required');return a;
}
export async function adminOrders({req,path,pool,transaction,event,body}){
 const admin=await administrator(req);
 if(path==='/orders/admin'&&req.method==='GET'){
  const q=(new URL(req.url,'http://local').searchParams.get('q')??'').trim().slice(0,100);
  return (await pool.query(`SELECT o.id,o.customer_id,o.restaurant_id,o.order_state,o.payment_state,o.delivery_state,o.quote->>'currency' AS currency,
   (o.quote->>'totalMinor')::bigint AS total_minor,o.created_at,k.state AS kitchen_state,d.driver_id
   FROM orders o LEFT JOIN kitchen_tickets k ON k.order_id=o.id LEFT JOIN order_dispatch d ON d.order_id=o.id
   WHERE $1='' OR o.id::text ILIKE $2 OR o.customer_id ILIKE $2 OR COALESCE(o.address->>'phone','') ILIKE $2
   ORDER BY o.created_at DESC LIMIT 100`,[q,'%'+q+'%'])).rows;
 }
 const detail=path.match(/^\/orders\/admin\/([a-f0-9-]{36})$/);
 if(detail&&req.method==='GET'){
  const o=(await pool.query(`SELECT o.*,k.state AS kitchen_state,k.reason AS kitchen_reason,d.driver_id,d.state AS dispatch_state,d.active AS dispatch_active,
   p.reason AS payment_review_reason,p.status AS payment_review_status FROM orders o
   LEFT JOIN kitchen_tickets k ON k.order_id=o.id LEFT JOIN order_dispatch d ON d.order_id=o.id LEFT JOIN payment_recovery p ON p.order_id=o.id WHERE o.id=$1`,[detail[1]])).rows[0];
  if(!o)fail(404,'Order not found');
  o.events=(await pool.query('SELECT kind,actor,created_at FROM order_events WHERE order_id=$1 ORDER BY created_at,id',[detail[1]])).rows;
  return o;
 }
 const cancel=path.match(/^\/orders\/admin\/([a-f0-9-]{36})\/cancel$/);
 if(cancel&&req.method==='POST'){
  const b=await body(req);if(typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>500)fail(400,'A support reason (10–500 characters) is required');
  return transaction(async c=>{
   const o=(await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[cancel[1]])).rows[0];if(!o)fail(404,'Order not found');
   if(o.order_state==='CANCELLED')return {ok:true};
   if(o.order_state!=='PLACED'||!['UNPAID','REFUNDED'].includes(o.payment_state)||!['UNASSIGNED','FAILED'].includes(o.delivery_state))fail(409,'Resolve payment and delivery before cancellation');
   if((await c.query("SELECT 1 FROM order_payment_reservations WHERE order_id=$1 AND status='OPEN'",[o.id])).rowCount)fail(409,'A payment is still in progress');
   const k=(await c.query('SELECT state FROM kitchen_tickets WHERE order_id=$1',[o.id])).rows[0];
   if(k&&!['REJECTED','EXPIRED'].includes(k.state))fail(409,'Resolve the restaurant ticket before cancellation');
   await c.query("UPDATE orders SET order_state='CANCELLED' WHERE id=$1",[o.id]);
   await event(c,o.id,'ADMIN_ORDER_CANCELLED',admin.id+': '+b.reason.trim());return {ok:true};
  });
 }
 fail(404,'Unknown admin order route');
}
