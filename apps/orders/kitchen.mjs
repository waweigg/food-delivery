// State and payment remain in the same transaction; restaurant membership is
// verified by the restaurant service for every queue read and staff command.
const steps={accept:['NEW','ACCEPTED'],prepare:['ACCEPTED','PREPARING'],ready:['PREPARING','READY'],reject:['NEW','REJECTED']};
const selection=`SELECT k.order_id,k.restaurant_id,k.state,k.deadline,k.estimate_minutes,k.reason,k.accepted_at,k.updated_at,o.quote,
 EXISTS(SELECT 1 FROM restaurant_alerts a WHERE a.order_id=k.order_id) AS alerted
 FROM kitchen_tickets k JOIN orders o ON o.id=k.order_id`;
function deny(status,message){throw Object.assign(new Error(message),{status});}
async function lookup(base,path,auth){
 const r=await fetch(base+path,{headers:{authorization:auth},redirect:'error',signal:AbortSignal.timeout(4000)});
 if(!r.ok)deny([401,403,404].includes(r.status)?r.status:503,'Unable to verify access');
 return r.json();
}
export async function enqueueKitchen(c,order){
 const mins=Number(process.env.KITCHEN_ACCEPT_MINUTES??30);
 if(!Number.isInteger(mins)||mins<1||mins>1440)throw Error('Invalid acceptance window');
 await c.query("INSERT INTO kitchen_tickets(order_id,restaurant_id,deadline) VALUES($1,$2,clock_timestamp()+interval '1 minute'*$3)",[order.id,order.restaurant_id,mins]);
}
async function recover(c,id,reason){
 await c.query('INSERT INTO payment_recovery(order_id,reason) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,reason]);
}
async function expire(c,event,id){
 const r=await c.query("UPDATE kitchen_tickets SET state='EXPIRED', updated_at=now(),reason='Acceptance window elapsed' WHERE order_id=$1 AND state='NEW' AND deadline<=clock_timestamp() RETURNING order_id",[id]);
 if(r.rowCount){await recover(c,id,'Acceptance window elapsed');await event(c,id,'KITCHEN_EXPIRED','system');}
 return r.rowCount;
}
export async function expireBatch(transaction,event){
 await transaction(async c=>{
   const rows=await c.query("SELECT order_id FROM kitchen_tickets WHERE state='NEW' AND deadline<=now() ORDER BY deadline LIMIT 32 FOR UPDATE SKIP LOCKED");
   for(const row of rows.rows)await expire(c,event,row.order_id);
 });
}
export async function kitchenRoute({req,path,pool,transaction,event,body}){
 const auth=req.headers.authorization;
 if(!auth?.startsWith('Bearer '))deny(401,'Sign in required');
 const actor=await lookup(process.env.IDENTITY_URL,'/me',auth);
 if(path==='/orders/kitchen-admin/recovery'&&req.method==='GET'){
   if(actor.role!=='ADMIN')deny(403,'Admin required');
   return (await pool.query("SELECT * FROM (SELECT order_id,reason,status,created_at FROM payment_recovery UNION ALL SELECT DISTINCT ON (o.id) o.id,'Payment failed before capture','UNPAID_NO_REFUND',e.created_at FROM orders o JOIN order_events e ON e.order_id=o.id WHERE o.payment_state='UNPAID' AND e.kind='TEST_PAYMENT_FAILED') issues ORDER BY created_at DESC LIMIT 200")).rows;
 }
 const match=path.match(/^\/orders\/kitchen\/([\w-]+)(?:\/([\da-f-]{36})(?:\/(accept|prepare|ready|reject))?)?$/);
 if(!match)deny(404,'Unknown queue');
 if(!['CUSTOMER','RESTAURANT'].includes(actor.role))deny(403,'Restaurant staff access required');
 const [,rid,id,action]=match;
 const profile=await lookup(process.env.RESTAURANTS_URL,'/restaurant-onboarding/'+rid,auth);
 if(profile.id!==rid||profile.status!=='APPROVED')deny(403,'Approved restaurant membership required');
 if(req.method==='GET'&&!action){
   const query=id?selection+' WHERE k.restaurant_id=$1 AND k.order_id=$2':selection+" WHERE k.restaurant_id=$1 AND k.state IN ('NEW','ACCEPTED','PREPARING','READY') ORDER BY CASE k.state WHEN 'NEW' THEN 0 WHEN 'ACCEPTED' THEN 1 WHEN 'PREPARING' THEN 2 ELSE 3 END,k.deadline";
   const rows=(await pool.query(query,id?[rid,id]:[rid])).rows;
   if(id&&!rows.length)deny(404,'Order not found');
   return id?rows[0]:rows;
 }
 if(req.method!=='POST'||!action)deny(405,'Unsupported kitchen action');
 const input=await body(req);
 const result=await transaction(async c=>{
   const order=(await c.query(selection+' WHERE k.restaurant_id=$1 AND k.order_id=$2 FOR UPDATE OF k',[rid,id])).rows[0];
   if(!order)deny(404,'Order not found');
   if(await expire(c,event,id))return {expired:true};
   const [from,to]=steps[action];
   if(order.state===to)return {state:to};
   if(order.state!==from)deny(409,'This order changed. Refresh the queue.');
   const estimate=input?.minutes,reason=input?.reason?.trim?.();
   if(action==='accept'&&(!Number.isInteger(estimate)||estimate<1||estimate>180))deny(400,'Estimate must be 1–180 minutes');
   if(action==='reject'&&(!reason||reason.length>300))deny(400,'A short reason is required');
   await c.query("UPDATE kitchen_tickets SET state=$2,updated_at=now(), estimate_minutes=coalesce($3,estimate_minutes),reason=$4,accepted_at=CASE WHEN $2='ACCEPTED' THEN now() ELSE accepted_at END WHERE order_id=$1",[id,to,action==='accept'?estimate:null,action==='reject'?reason:null]);
   if(action==='reject')await recover(c,id,reason);
   await event(c,id,'KITCHEN_'+to,actor.id);
   return {state:to};
 });
 if(result.expired)deny(409,'Acceptance deadline elapsed');
 return result;
}

