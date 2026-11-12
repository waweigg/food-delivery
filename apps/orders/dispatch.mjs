import {driverDelivery} from './delivery.mjs';
import {timingSafeEqual} from 'node:crypto';
export async function dispatchRoute({req,path,pool,transaction,event,body}) {
 const fail=(s,m)=>{throw Object.assign(Error(m),{status:s});};
 const key=process.env.DISPATCH_ORDER_TOKEN,a=Buffer.from(req.headers.authorization||''),b=Buffer.from('Bearer '+key);
 if(!key||key.length<32||a.length!==b.length||!timingSafeEqual(a,b))fail(403,'Service authentication required');
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 if(path==='/internal/dispatch/ready'&&req.method==='GET'){
  const after=new URL(req.url,'http://local').searchParams.get('after');if(after&&!uuid.test(after))fail(400,'Invalid cursor');
  return (await pool.query("SELECT o.id,o.restaurant_id FROM orders o JOIN kitchen_tickets k ON k.order_id=o.id WHERE o.order_state='PLACED' AND o.payment_state='PAID' AND o.delivery_state='UNASSIGNED' AND k.state='READY' AND ($1::uuid IS NULL OR o.id>$1) ORDER BY o.id LIMIT 100",[after])).rows;
 }
 const delivery=path.match(/^\/internal\/dispatch\/([^/]+)\/delivery$/);
 if(delivery&&uuid.test(delivery[1])&&req.method==='POST')return driverDelivery({req,id:delivery[1],transaction,event,body});
 const contact=path.match(/^\/internal\/dispatch\/([^/]+)\/contact$/);
 if(contact&&uuid.test(contact[1])&&req.method==='GET'){
  const o=(await pool.query('SELECT address FROM orders WHERE id=$1',[contact[1]])).rows[0];if(!o)fail(404,'Order unavailable');return {phone:o.address.phone??null};
 }
 const match=path.match(/^\/internal\/dispatch\/([^/]+)$/);if(!match||!uuid.test(match[1])||req.method!=='POST')fail(404,'Unknown dispatch route');
 const data=await body(req);if(!['SEARCHING','NEEDS_ATTENTION','ASSIGNED'].includes(data.state))fail(400,'Invalid dispatch state');
 if(data.state==='ASSIGNED'&&(!uuid.test(data.offerId)||typeof data.driverId!=='string'||!data.driverId||data.driverId.length>200))fail(400,'Invalid assignment');
 return transaction(async c=>{
  const o=(await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[match[1]])).rows[0];if(!o)fail(404,'Order unavailable');
  const old=(await c.query('SELECT * FROM order_dispatch WHERE order_id=$1',[o.id])).rows[0];
  if(old?.state==='ASSIGNED'){
   if(data.state==='ASSIGNED'&&old.driver_id===data.driverId&&old.offer_id===data.offerId)return {ok:true};
   fail(409,'Order already assigned');
  }
  if(o.order_state!=='PLACED'||o.payment_state!=='PAID'||o.delivery_state!=='UNASSIGNED'||!(await c.query("SELECT 1 FROM kitchen_tickets WHERE order_id=$1 AND state='READY'",[o.id])).rowCount)fail(409,'Order not dispatchable');
  try{await c.query('INSERT INTO order_dispatch(order_id,state,driver_id,offer_id) VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO UPDATE SET state=excluded.state,driver_id=excluded.driver_id,offer_id=excluded.offer_id,updated_at=now()',[o.id,data.state,data.state==='ASSIGNED'?data.driverId:null,data.state==='ASSIGNED'?data.offerId:null]);}catch(e){if(e.code==='23505')fail(409,'Driver or offer already assigned');throw e;}
  if(data.state==='ASSIGNED')await c.query("UPDATE orders SET delivery_state='ASSIGNED' WHERE id=$1",[o.id]);
  if(old?.state!==data.state)await event(c,o.id,'DISPATCH_'+data.state,'dispatch');
  return {ok:true};
 });
}
