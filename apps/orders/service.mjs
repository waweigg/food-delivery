import {customerDelivery,adminDelivery} from './delivery.mjs';
import {adminOrders} from './admin-orders.mjs';
import {pilotAdmission} from './pilot.mjs';
import {dispatchRoute} from './dispatch.mjs';
import {enqueueKitchen,expireBatch,kitchenRoute} from './kitchen.mjs';
import http from 'node:http';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

const pool=new pg.Pool({connectionString:process.env.ORDERS_DATABASE_URL,connectionTimeoutMillis:5000});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(status,message){throw Object.assign(new Error(message),{status});}
function canonical(v){
  if(Array.isArray(v))return v.map(canonical);
  if(v && typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  return v;
}
function digest(v){return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');}
async function body(req){
  const chunks=[];let n=0;
  for await(const c of req){n+=c.length;if(n>32768)fail(413,'Basket is too large');chunks.push(c);}
  try{return JSON.parse(Buffer.concat(chunks));}catch{fail(400,'Invalid request');}
}
async function transaction(fn){
  const c=await pool.connect();
  try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function event(c,order,kind,actor){
  const id=randomUUID();
  await c.query('INSERT INTO order_events(id,order_id,kind,actor) VALUES($1,$2,$3,$4)',[id,order,kind,actor]);
  await c.query('INSERT INTO outbox(event_id) VALUES($1)',[id]);
}
async function customer(req){
  const authorization=req.headers.authorization;
  if(!authorization?.startsWith('Bearer '))fail(401,'Sign in to place a test order');
  const r=await fetch(process.env.IDENTITY_URL+'/me',{headers:{authorization},signal:AbortSignal.timeout(4000)});
  if(!r.ok)fail(r.status===401||r.status===403?401:503,'Unable to verify customer');
  const actor=await r.json();
  if(actor.role!=='CUSTOMER'||typeof actor.id!=='string')fail(403,'A customer account is required');
  return actor.id;
}
const projection='id,restaurant_id,quote,order_state,payment_state,delivery_state,created_at';
async function checkout(owner,b){
  if(!b || !uuid.test(b.key)||typeof b.restaurantId!=='string'||!/^[-\w]{1,100}$/.test(b.restaurantId)||!b.basket||!b.review)fail(400,'Invalid checkout');
  const fingerprint=digest([b.restaurantId,b.basket,b.review]);
  return transaction(async c=>{
    // Serialize only requests for this customer's checkout intent, including retries after a lost response.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[owner+':'+b.key]);
    const previous=(await c.query('SELECT '+projection+',fingerprint FROM orders WHERE customer_id=$1 AND checkout_key=$2',[owner,b.key])).rows[0];
    if(previous){if(previous.fingerprint!==fingerprint)fail(409,'Checkout key already used for another basket');delete previous.fingerprint;return previous;}
    const r=await fetch(process.env.RESTAURANTS_URL+'/catalog/restaurants/'+b.restaurantId+'/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b.basket),signal:AbortSignal.timeout(5000)});
    if(!r.ok)fail([400,404,422].includes(r.status)?422:503,'This basket is no longer available. Check your address and review again.');
    const quote=await r.json();
    const normalized=q=>({...q,items:[...q.items].sort((a,b)=>a.itemId.localeCompare(b.itemId))});
    if(!Array.isArray(b.review.items)||digest(normalized(quote))!==digest(normalized(b.review)))fail(409,'Prices changed. Review the latest quote.');
    const windowId=await pilotAdmission(c,b.restaurantId);
    const id=randomUUID();
    const result=await c.query("INSERT INTO orders(id,customer_id,checkout_key,fingerprint,restaurant_id,quote,address,order_state,payment_state,delivery_state) VALUES($1,$2,$3,$4,$5,$6,$7,'PLACED','UNPAID','UNASSIGNED') RETURNING "+projection,[id,owner,b.key,fingerprint,b.restaurantId,quote,b.basket.address]);
    if(windowId)await c.query('INSERT INTO pilot_admissions(window_id,order_id) VALUES($1,$2)',[windowId,id]);
    await event(c,id,'TEST_ORDER_PLACED',owner);
    return result.rows[0];
  });
}
async function paymentUpdate(req,orderId,action){
  const key=process.env.PAYMENTS_ORDER_TOKEN;
  const supplied=Buffer.from(req.headers.authorization??'');
  const expected=Buffer.from('Bearer '+key);
  if(!key || key.length<32 || supplied.length!==expected.length || !timingSafeEqual(expected,supplied))fail(403,'Service authentication required');
  const data=await body(req);
  if(!uuid.test(data.attempt)||!uuid.test(orderId))fail(400,'Invalid reference');
  return transaction(async c=>{
    const o=(await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
    if(!o||o.customer_id!==data.owner)fail(404,'Order unavailable');
    if(data.amount!==o.quote.totalMinor||data.currency!==o.quote.currency)fail(409,'Payment amount mismatch');
    const existing=(await c.query('SELECT * FROM order_payment_reservations WHERE attempt_id=$1',[data.attempt])).rows[0];
    if(existing && existing.order_id!==orderId)fail(409,'Reference mismatch');
    if(action==='reserve'){
      if(existing?.status==='OPEN')return {ok:true};
      if(existing||o.order_state!=='PLACED'||o.payment_state!=='UNPAID')fail(409,'Order unavailable');
      const inserted=await c.query("INSERT INTO order_payment_reservations VALUES($1,$2,'OPEN') ON CONFLICT DO NOTHING",[data.attempt,orderId]);
      if(!inserted.rowCount)fail(409,'Another payment is in progress');
    }else{
      if(!['SUCCEEDED','FAILED','ABANDONED'].includes(data.status)||!existing)fail(409,'Invalid payment update');
      if(existing.status===data.status)return {ok:true};
      if(existing.status!=='OPEN')fail(409,'Payment already finalized');
      if(data.status==='SUCCEEDED'){
        if(o.order_state!=='PLACED'||o.payment_state!=='UNPAID')fail(409,'Order unavailable');
        await enqueueKitchen(c,o);
        await c.query("UPDATE orders SET payment_state='PAID' WHERE id=$1",[orderId]);
      }
      await c.query('UPDATE order_payment_reservations SET status=$2 WHERE attempt_id=$1',[data.attempt,data.status]);
      await event(c,orderId,'TEST_PAYMENT_'+data.status,'payments');
    }
    return {ok:true};
  });
}
async function refundUpdate(req,orderId,action){
  const key=process.env.PAYMENTS_ORDER_TOKEN,supplied=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+key);
  if(!key||key.length<32||supplied.length!==expected.length||!timingSafeEqual(expected,supplied))fail(403,'Service authentication required');
  const b=await body(req);if(!uuid.test(b.attempt)||!uuid.test(b.refundId))fail(400,'Invalid refund reference');
  return transaction(async c=>{
    const o=(await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];if(!o)fail(404,'Order unavailable');
    if(Number(b.amount)!==Number(o.quote.totalMinor)||b.currency!==o.quote.currency)fail(409,'Refund amount mismatch');
    const pay=(await c.query("SELECT status FROM order_payment_reservations WHERE order_id=$1 AND attempt_id=$2",[orderId,b.attempt])).rows[0];
    if(!pay||pay.status!=='SUCCEEDED')fail(409,'Captured payment not found');
    const old=(await c.query('SELECT * FROM order_payment_refunds WHERE attempt_id=$1 FOR UPDATE',[b.attempt])).rows[0];
    if(action==='reserve'){
      if(old){if(old.refund_id===b.refundId&&old.order_id===orderId)return {ok:true};fail(409,'A refund is already recorded for this payment');}
      if(o.payment_state!=='PAID'||['ASSIGNED','PICKED_UP'].includes(o.delivery_state))fail(409,'Resolve delivery before refund');
      const kitchen=(await c.query('SELECT state FROM kitchen_tickets WHERE order_id=$1',[orderId])).rows[0];
      if(!['REJECTED','EXPIRED'].includes(kitchen?.state)&&o.delivery_state!=='FAILED')fail(409,'Refund requires a rejected or expired restaurant ticket, or a failed delivery');
      await c.query("INSERT INTO order_payment_refunds(refund_id,attempt_id,order_id,amount,status) VALUES($1,$2,$3,$4,'OPEN')",[b.refundId,b.attempt,orderId,b.amount]);return {ok:true};
    }
    if(!old||old.refund_id!==b.refundId||old.order_id!==orderId)fail(409,'Refund reservation not found');
    if(old.status==='SUCCEEDED')return {ok:true};
    if(o.payment_state!=='PAID')fail(409,'Order payment is not refundable');
    await c.query("UPDATE orders SET payment_state='REFUNDED' WHERE id=$1",[orderId]);
    await c.query("UPDATE order_payment_refunds SET status='SUCCEEDED',completed_at=now() WHERE refund_id=$1",[b.refundId]);
    await c.query("UPDATE payment_recovery SET status='REFUNDED' WHERE order_id=$1",[orderId]);
    await event(c,orderId,'PAYMENT_REFUNDED',b.refundId);return {ok:true};
  });
}
async function route(req){
  const path=new URL(req.url,'http://orders').pathname;
  if(path==='/orders-health'){await pool.query('SELECT 1');return {ok:true};}
  if(path.startsWith('/internal/dispatch/'))return dispatchRoute({req,path,pool,transaction,event,body});
  const payment=path.match(/^\/internal\/orders\/([^/]+)\/payment\/(reserve|settle)$/);
  if(payment && req.method==='POST')return paymentUpdate(req,payment[1],payment[2]);
  const refund=path.match(/^\/internal\/orders\/([^/]+)\/payment\/refund\/(reserve|settle)$/);
  if(refund&&req.method==='POST')return refundUpdate(req,refund[1],refund[2]);
  if(path.startsWith('/orders/admin'))return adminOrders({req,path,pool,transaction,event,body});
  if(path.startsWith('/orders/kitchen'))return kitchenRoute({req,path,pool,transaction,event,body});
  if(path.startsWith('/orders/delivery-admin'))return adminDelivery({req,path,pool,transaction,event,body});
  const owner=await customer(req);
  const tracking=path.match(/^\/orders\/([a-f0-9-]{36})\/delivery$/);
  if(tracking&&req.method==='GET')return customerDelivery({id:tracking[1],owner,transaction});
  if(path==='/orders'&&req.method==='GET')return (await pool.query('SELECT '+projection+', (SELECT state FROM kitchen_tickets WHERE order_id=orders.id) AS kitchen_state, (SELECT state FROM order_dispatch WHERE order_id=orders.id) AS dispatch_state FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100',[owner])).rows;
  if(path==='/orders'&&req.method==='POST'){
    if(process.env.TEST_ORDERS_ENABLED!=='true'||process.env.APP_ENV!=='development')fail(403,'Test checkout disabled');
    return checkout(owner,await body(req));
  }
  const [,prefix,id,action,...extra]=path.split('/');
  if(prefix!=='orders'||!uuid.test(id)||extra.length)fail(404,'Order not found');
  return transaction(async c=>{
    const order=(await c.query('SELECT '+projection+' FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE',[id,owner])).rows[0];
    if(!order)fail(404,'Order not found');
    if(!action&&req.method==='GET')return {...order,dispatch_state:(await c.query('SELECT state FROM order_dispatch WHERE order_id=$1',[id])).rows[0]?.state??null,kitchen_state:(await c.query('SELECT state FROM kitchen_tickets WHERE order_id=$1',[id])).rows[0]?.state??null};
    if(action==='cancel'&&req.method==='POST'){
      const active=await c.query("SELECT 1 FROM order_payment_reservations WHERE order_id=$1 AND status='OPEN'",[id]);
      if(active.rowCount)fail(409,'Payment is pending');
      if(order.order_state!=='PLACED'||order.payment_state!=='UNPAID'||order.delivery_state!=='UNASSIGNED')fail(409,'Order cannot be cancelled');
      await c.query("UPDATE orders SET order_state='CANCELLED' WHERE id=$1",[id]);
      await event(c,id,'TEST_ORDER_CANCELLED',owner);
      return {...order,order_state:'CANCELLED'};
    }
    fail(405,'Transition not allowed');
  });
}
const worker=process.argv.includes('--worker');
if(!worker)await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
if(worker){
  for(;;){
    try{await expireBatch(transaction,event);const worked=await transaction(async c=>{
      const row=(await c.query('SELECT event_id FROM outbox WHERE processed_at IS NULL AND attempts<10 AND next_attempt<=now() ORDER BY next_attempt LIMIT 1 FOR UPDATE SKIP LOCKED')).rows[0];
      if(!row)return false;
      await c.query('SAVEPOINT delivery');
      try{
        await c.query('INSERT INTO order_activity SELECT id,order_id,kind,created_at FROM order_events WHERE id=$1 ON CONFLICT DO NOTHING',[row.event_id]);
        await c.query("INSERT INTO restaurant_alerts(event_id,order_id,restaurant_id) SELECT e.id,k.order_id,k.restaurant_id FROM order_events e JOIN kitchen_tickets k ON k.order_id=e.order_id WHERE e.id=$1 AND e.kind='TEST_PAYMENT_SUCCEEDED' ON CONFLICT DO NOTHING",[row.event_id]);
        await c.query('UPDATE outbox SET processed_at=now() WHERE event_id=$1',[row.event_id]);
      }catch{await c.query('ROLLBACK TO SAVEPOINT delivery');await c.query("UPDATE outbox SET attempts=attempts+1,next_attempt=now()+interval '1 second'*power(2,attempts) WHERE event_id=$1",[row.event_id]);}
      return true;
    });if(worked)continue;}catch{console.error('Order worker temporarily unavailable');}
    await new Promise(r=>setTimeout(r,1000));
  }
}else http.createServer(async(req,res)=>{
  try{const result=await route(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}
  catch(e){res.writeHead(e.status??503,{'content-type':'application/json'});res.end(JSON.stringify({message:e.status?e.message:'Order service temporarily unavailable'}));}
}).listen(3002,'0.0.0.0');



