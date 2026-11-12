import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const terminal=s=>['DELIVERED','FAILED'].includes(s);
function pin(id,nonce){
 const key=process.env.DELIVERY_PIN_KEY;
 if(!key||key.length<32)fail(503,'Delivery confirmation unavailable');
 return (createHmac('sha256',key).update(id+':'+nonce).digest().readUInt32BE(0)%1000000).toString().padStart(6,'0');
}
async function record(c,id){
 await c.query('INSERT INTO delivery_confirmations(order_id,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,randomBytes(32).toString('hex')]);
 return (await c.query('SELECT * FROM delivery_confirmations WHERE order_id=$1 FOR UPDATE',[id])).rows[0];
}
async function finish(c,event,o,actor,state,reason){
 await c.query('UPDATE orders SET delivery_state=$2 WHERE id=$1',[o.id,state]);
 await c.query('UPDATE order_dispatch SET active=false,updated_at=now() WHERE order_id=$1',[o.id]);
 await c.query('UPDATE delivery_confirmations SET completed_at=now(),issue=NULL,resolution=$2 WHERE order_id=$1',[o.id,reason]);
 if(state==='FAILED')await c.query("INSERT INTO payment_recovery(order_id,reason,status) VALUES($1,$2,'REVIEW_REQUIRED') ON CONFLICT(order_id) DO UPDATE SET reason=excluded.reason,status='REVIEW_REQUIRED'",[o.id,reason]);
 await event(c,o.id,'DELIVERY_'+state,actor);
}
export async function driverDelivery({req,id,transaction,event,body}){
 const b=await body(req);
 if(!['view','pickup','deliver','report'].includes(b.action))fail(400,'Invalid delivery action');
 // Return validation failures outside the transaction so failed PIN attempts persist.
 const result=await transaction(async c=>{
  const o=(await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
  const d=(await c.query('SELECT * FROM order_dispatch WHERE order_id=$1',[id])).rows[0];
  if(!o||!d||d.driver_id!==b.driverId||d.offer_id!==b.offerId||d.state!=='ASSIGNED')fail(404,'Assigned delivery unavailable');
  const r=await record(c,id);
  const view=()=>({orderId:id,state:o.delivery_state,ready:true,issue:r.issue,
   ...(terminal(o.delivery_state)?{}:{address:o.address,items:o.quote.items})});
  if(b.action==='view')return view();
  if(o.order_state!=='PLACED'||o.payment_state!=='PAID')fail(409,'Order cannot progress');
  if(b.action==='pickup'){
   if(['PICKED_UP','DELIVERED'].includes(o.delivery_state))return view();
   if(o.delivery_state!=='ASSIGNED'||!(await c.query("SELECT 1 FROM kitchen_tickets WHERE order_id=$1 AND state='READY'",[id])).rowCount)fail(409,'Restaurant must be ready');
   await c.query("UPDATE orders SET delivery_state='PICKED_UP' WHERE id=$1",[id]);
   await c.query('UPDATE delivery_confirmations SET picked_up_at=now() WHERE order_id=$1',[id]);
   await event(c,id,'DELIVERY_PICKED_UP',b.driverId);o.delivery_state='PICKED_UP';return view();
  }
  if(b.action==='report'){
   if(terminal(o.delivery_state))fail(409,'Delivery already closed');
   if(!['CUSTOMER_UNREACHABLE','DELIVERY_FAILED','CANCELLATION_REQUESTED'].includes(b.reason))fail(400,'Choose an issue');
   if(r.issue!==b.reason){await c.query('UPDATE delivery_confirmations SET issue=$2 WHERE order_id=$1',[id,b.reason]);await event(c,id,'DELIVERY_ISSUE_'+b.reason,b.driverId);}
   r.issue=b.reason;return view();
  }
  if(o.delivery_state==='DELIVERED')return view();
  if(o.delivery_state!=='PICKED_UP')fail(409,'Confirm pickup first');
  if(r.locked_until&&new Date(r.locked_until)>new Date())return {error:429,message:'Too many PIN attempts. Wait 15 minutes or contact support.'};
  if(typeof b.pin!=='string'||!/^\d{6}$/.test(b.pin))fail(400,'Enter the six-digit customer PIN');
  if(!timingSafeEqual(Buffer.from(b.pin),Buffer.from(pin(id,r.nonce)))){
   const attempts=r.locked_until?1:r.attempts+1;
   await c.query("UPDATE delivery_confirmations SET attempts=$2,locked_until=CASE WHEN $2>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE order_id=$1",[id,attempts]);
   await event(c,id,'DELIVERY_PIN_REJECTED',b.driverId);
   return {error:attempts>=5?429:422,message:attempts>=5?'Too many PIN attempts. Wait 15 minutes or contact support.':'Incorrect PIN. Ask the customer to check their order.'};
  }
  await finish(c,event,o,b.driverId,'DELIVERED','Customer PIN confirmed');o.delivery_state='DELIVERED';return view();
 });
 if(result.error)fail(result.error,result.message);return result;
}
export async function customerDelivery({id,owner,transaction}){
 const data=await transaction(async c=>{
  const o=(await c.query('SELECT * FROM orders WHERE id=$1 AND customer_id=$2 FOR UPDATE',[id,owner])).rows[0];if(!o)fail(404,'Order not found');
  const active=['ASSIGNED','PICKED_UP'].includes(o.delivery_state);
  const r=active?await record(c,id):(await c.query('SELECT * FROM delivery_confirmations WHERE order_id=$1',[id])).rows[0];
  const events=(await c.query("SELECT kind,created_at FROM order_events WHERE order_id=$1 AND kind NOT IN ('DELIVERY_PIN_REJECTED') ORDER BY created_at,id",[id])).rows;
  return {orderId:id,state:o.delivery_state,pin:active?pin(id,r.nonce):null,issue:r?.issue??null,events,tracking:null};
 });
 if(['ASSIGNED','PICKED_UP'].includes(data.state)){
  try{
   const r=await fetch(process.env.DRIVERS_URL+'/internal/drivers/tracking/'+id,{headers:{authorization:'Bearer '+process.env.DRIVER_SERVICE_TOKEN},signal:AbortSignal.timeout(3000)});
   if(!r.ok)throw Error();data.tracking=await r.json();
  }catch{data.tracking={stale:true,unavailable:true};}
 }
 return data;
}
export async function adminDelivery({req,path,pool,transaction,event,body}){
 const auth=req.headers.authorization;
 if(!auth)fail(401,'Sign in required');
 const r=await fetch(process.env.IDENTITY_URL+'/me',{headers:{authorization:auth},signal:AbortSignal.timeout(4000)});
 if(!r.ok)fail(r.status===401?401:503,'Unable to verify administrator');
 const a=await r.json();if(a.role!=='ADMIN')fail(403,'Admin required');
 if(path==='/orders/delivery-admin'&&req.method==='GET')return (await pool.query("SELECT o.id,o.delivery_state,d.driver_id,c.issue,c.locked_until FROM orders o JOIN order_dispatch d ON d.order_id=o.id LEFT JOIN delivery_confirmations c ON c.order_id=o.id WHERE d.active ORDER BY o.created_at DESC LIMIT 200")).rows;
 const m=path.match(/^\/orders\/delivery-admin\/([a-f0-9-]{36})$/);
 if(!m||req.method!=='POST')fail(404,'Unknown delivery');
 const b=await body(req);
 if(!['DELIVERED','FAILED'].includes(b.state)||typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>500)fail(400,'State and support verification reason (10–500 characters) required');
 return transaction(async c=>{
  const o=(await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[m[1]])).rows[0];
  if(!o)fail(404,'Order not found');
  if(o.delivery_state===b.state)return {ok:true};
  if(!['ASSIGNED','PICKED_UP'].includes(o.delivery_state)||(b.state==='DELIVERED'&&o.delivery_state!=='PICKED_UP'))fail(409,'Delivery cannot be resolved in this state');
  await record(c,o.id);await finish(c,event,o,'admin:'+a.id,b.state,b.reason.trim());
  await event(c,o.id,'DELIVERY_ADMIN_EXCEPTION',a.id);return {ok:true};
 });
}
