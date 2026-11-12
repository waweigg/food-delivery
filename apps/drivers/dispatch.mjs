import {randomUUID} from 'node:crypto';
export function distanceMetres(a,b,c,d){const rad=Math.PI/180,x=Math.sin((c-a)*rad/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.min(1,x)));}
export function createDispatch({pool,transaction,fresh,audit,body}){
 const radius=Number(process.env.DISPATCH_RADIUS_METRES||5000),seconds=Number(process.env.DISPATCH_OFFER_SECONDS||45),limit=Number(process.env.DISPATCH_LIMIT_SECONDS||300),max=Number(process.env.DISPATCH_MAX_ATTEMPTS||5);
 if(![radius,seconds,limit,max].every(Number.isInteger)||radius<1||radius>50000||seconds<5||seconds>300||limit<seconds||limit>3600||max<1||max>20)throw Error('Invalid dispatch policy');
 const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
 async function rpc(path,data){const r=await fetch(process.env.ORDERS_URL+path,{method:data?'POST':'GET',headers:{authorization:'Bearer '+process.env.DISPATCH_ORDER_TOKEN,'content-type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(4000)});if(!r.ok){const e=await r.json().catch(()=>({}));throw Object.assign(Error(e.message||'Order confirmation failed'),{status:r.status});}return r.json();}
 async function syncDelivery(c,j,data){
  if(!['ASSIGNED','PICKED_UP','DELIVERED','FAILED'].includes(data.state))return;
  await c.query('UPDATE dispatch_jobs SET state=$2,issue=$3 WHERE order_id=$1',[j.order_id,data.state,data.issue??null]);
  if(['DELIVERED','FAILED'].includes(data.state))await c.query("UPDATE driver_offers SET state='COMPLETED' WHERE id=$1 AND state='ACCEPTED'",[j.offer_id]);
 }
 async function delivery(req,path,a){
  const m=path.match(/^\/driver\/deliveries\/([a-f0-9-]{36})$/);if(!m)fail(404,'Delivery unavailable');
  if(req.method!=='POST'&&req.method!=='GET')fail(405,'Unsupported action');
  const b=req.method==='POST'?await body(req):{action:'view'};
  return transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['dispatch:'+m[1]]);
   const j=(await c.query('SELECT * FROM dispatch_jobs WHERE order_id=$1 FOR UPDATE',[m[1]])).rows[0];
   const d=(await c.query('SELECT status FROM driver_profiles WHERE user_id=$1 FOR UPDATE',[a.id])).rows[0];
   if(!j||j.driver_id!==a.id||!['ASSIGNED','PICKED_UP','DELIVERED','FAILED'].includes(j.state))fail(404,'Assigned delivery unavailable');
   if(d?.status!=='APPROVED')fail(403,'Approved driver required; contact support');
   const result=await rpc('/internal/dispatch/'+j.order_id+'/delivery',{...b,driverId:a.id,offerId:j.offer_id});
   await syncDelivery(c,j,result);return result;
  });
 }
 async function candidates(c,j){
  if(j.latitude==null||j.longitude==null)return [];
  const rows=(await c.query("SELECT d.* FROM driver_profiles d WHERE status='APPROVED' AND online AND EXISTS(SELECT 1 FROM driver_registrations r WHERE r.user_id=d.user_id) AND NOT EXISTS(SELECT 1 FROM driver_offers o WHERE o.driver_id=d.user_id AND o.state='ACCEPTED')")).rows;
  return rows.filter(fresh).map(d=>({user_id:d.user_id,name:d.name,vehicle:d.vehicle,distanceMetres:Math.round(distanceMetres(j.latitude,j.longitude,d.latitude,d.longitude))})).filter(d=>d.distanceMetres<=radius).sort((a,b)=>a.distanceMetres-b.distanceMetres||a.user_id.localeCompare(b.user_id));
 }
 async function newOffer(c,j,driver){
  const d=(await c.query('SELECT * FROM driver_profiles WHERE user_id=$1 FOR UPDATE',[driver.user_id])).rows[0];
  if(!d||!fresh(d)||distanceMetres(j.latitude,j.longitude,d.latitude,d.longitude)>radius||(await c.query("SELECT 1 FROM driver_offers WHERE driver_id=$1 AND state='ACCEPTED'",[driver.user_id])).rowCount)return false;
  const id=randomUUID();
  await c.query("INSERT INTO driver_offers(id,order_id,driver_id,pickup,expires_at,dispatch_round) VALUES($1,$2,$3,$4,LEAST(now()+$5*interval '1 second',$6::timestamptz),$7)",[id,j.order_id,driver.user_id,j.pickup,seconds,j.deadline,j.round]);
  await c.query("UPDATE dispatch_jobs SET offer_id=$2,attempts=attempts+1,issue=NULL WHERE order_id=$1",[j.order_id,id]);
  return true;
 }
 let cursor='';
 async function discover(){
  const ready=await rpc('/internal/dispatch/ready'+(cursor?'?after='+cursor:''));
  for(const o of ready)await pool.query("INSERT INTO dispatch_jobs(order_id,restaurant_id,deadline) VALUES($1,$2,now()+$3*interval '1 second') ON CONFLICT DO NOTHING",[o.id,o.restaurant_id,limit]);
  cursor=ready.length===100?ready.at(-1).id:'';
 }
 async function tick(orderId){return transaction(async c=>{
  // Acceptance takes the same per-order lock before profile/offer locks.
  if(!(await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS ok',['dispatch:'+orderId])).rows[0].ok)return;
  const j=(await c.query('SELECT * FROM dispatch_jobs WHERE order_id=$1 AND next_attempt<=now() FOR UPDATE',[orderId])).rows[0];if(!j)return;
  await c.query("UPDATE dispatch_jobs SET next_attempt=now()+interval '5 seconds' WHERE order_id=$1",[orderId]);
  if(j.state==='RESERVED'){
   try{await rpc('/internal/dispatch/'+orderId,{state:'ASSIGNED',driverId:j.driver_id,offerId:j.offer_id});await c.query("UPDATE dispatch_jobs SET state='ASSIGNED',notified_state='ASSIGNED',issue=NULL WHERE order_id=$1",[orderId]);}
   catch(e){await c.query('UPDATE dispatch_jobs SET issue=$2 WHERE order_id=$1',[orderId,e.status===409?'Assignment conflict: operator review required':'Assignment confirmation pending; reservation remains held']);}
   return;
  }
  if(['ASSIGNED','PICKED_UP'].includes(j.state)){
   try{const result=await rpc('/internal/dispatch/'+orderId+'/delivery',{action:'view',driverId:j.driver_id,offerId:j.offer_id});await syncDelivery(c,j,result);if(['DELIVERED','FAILED'].includes(result.state))return;if(result.issue)return;}catch{await c.query("UPDATE dispatch_jobs SET issue='Delivery reconciliation pending; reservation remains held' WHERE order_id=$1",[orderId]);return;}
   const d=(await c.query('SELECT * FROM driver_profiles WHERE user_id=$1',[j.driver_id])).rows[0];
   await c.query('UPDATE dispatch_jobs SET issue=$2 WHERE order_id=$1',[orderId,d&&fresh(d)?null:'Assigned driver offline or stale: contact driver; do not reassign blindly']);return;
  }
  if(j.state==='SEARCHING'){
   const offer=j.offer_id?(await c.query('SELECT * FROM driver_offers WHERE id=$1 FOR UPDATE',[j.offer_id])).rows[0]:null;
   if(offer?.state==='ACCEPTED'){await c.query("UPDATE dispatch_jobs SET state='RESERVED',driver_id=$2 WHERE order_id=$1",[orderId,offer.driver_id]);return;}
   const timedOut=new Date(j.deadline)<=new Date();
   if(offer?.state==='PENDING'){
    const d=(await c.query('SELECT * FROM driver_profiles WHERE user_id=$1',[offer.driver_id])).rows[0];
    if(!timedOut&&new Date(offer.expires_at)>new Date()&&d&&fresh(d))return;
    await c.query("UPDATE driver_offers SET state='EXPIRED' WHERE id=$1 AND state='PENDING'",[offer.id]);
   }
   if(timedOut||j.attempts>=max){j.state='NEEDS_ATTENTION';await c.query("UPDATE dispatch_jobs SET state='NEEDS_ATTENTION',issue=$2 WHERE order_id=$1",[orderId,timedOut?'Dispatch time limit exceeded: contact customer':'Offer attempt limit reached: contact customer']);}
   else {
    if(j.latitude==null){try{const r=await fetch(process.env.RESTAURANTS_URL+'/catalog/restaurants/'+encodeURIComponent(j.restaurant_id),{signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error();const p=await r.json();if(!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)throw Error();j.latitude=p.latitude;j.longitude=p.longitude;j.pickup=String(p.name+' — '+p.address).slice(0,200);await c.query('UPDATE dispatch_jobs SET latitude=$2,longitude=$3,pickup=$4 WHERE order_id=$1',[orderId,j.latitude,j.longitude,j.pickup]);}catch{await c.query("UPDATE dispatch_jobs SET issue='Pickup details unavailable' WHERE order_id=$1",[orderId]);return;}}
    const tried=new Set((await c.query('SELECT driver_id FROM driver_offers WHERE order_id=$1 AND dispatch_round=$2',[orderId,j.round])).rows.map(o=>o.driver_id));
    let sent=false;for(const d of (await candidates(c,j)).filter(d=>!tried.has(d.user_id))){if(await newOffer(c,j,d)){sent=true;break;}}
    if(!sent)await c.query("UPDATE dispatch_jobs SET issue='No eligible nearby driver; waiting until dispatch deadline' WHERE order_id=$1",[orderId]);
   }
  }
  if(j.notified_state!==j.state){try{await rpc('/internal/dispatch/'+orderId,{state:j.state});await c.query('UPDATE dispatch_jobs SET notified_state=$2 WHERE order_id=$1',[orderId,j.state]);}catch{/* Retry the idempotent update next tick. */}}
 });}
 async function cycle(){try{await discover();}catch{/* Existing deadlines and reservations must progress even if discovery is unavailable. */}const rows=(await pool.query("SELECT order_id FROM dispatch_jobs WHERE state NOT IN ('DELIVERED','FAILED') AND next_attempt<=now() ORDER BY next_attempt LIMIT 30")).rows;for(const r of rows){try{await tick(r.order_id);}catch{await pool.query("UPDATE dispatch_jobs SET next_attempt=now()+interval '5 seconds',issue='Dispatch service retry pending' WHERE order_id=$1",[r.order_id]);}}}
 async function route(req,path,a){
  if(a.role!=='ADMIN')fail(403,'Admin required');
  if(path==='/driver-admin/dispatch'&&req.method==='GET')return (await pool.query('SELECT order_id,pickup,state,attempts,deadline,driver_id,issue,round FROM dispatch_jobs ORDER BY (issue IS NOT NULL) DESC,created_at DESC LIMIT 200')).rows;
  const m=path.match(/^\/driver-admin\/dispatch\/([a-f0-9-]+)\/(candidates|manual|contact)$/);if(!m)fail(404,'Dispatch not found');
  return transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['dispatch:'+m[1]]);
   const j=(await c.query('SELECT * FROM dispatch_jobs WHERE order_id=$1 FOR UPDATE',[m[1]])).rows[0];if(!j)fail(404,'Dispatch not found');
   if(m[2]==='contact'&&req.method==='GET')return rpc('/internal/dispatch/'+j.order_id+'/contact');
   if(m[2]==='candidates'&&req.method==='GET')return candidates(c,j);
   if(m[2]!=='manual'||req.method!=='POST')fail(405,'Unsupported action');
   const b=await body(req);if(typeof b.driverId!=='string')fail(400,'Select a driver');
   if(!['SEARCHING','NEEDS_ATTENTION'].includes(j.state))fail(409,'Assignment already reserved');
   if((await c.query("SELECT 1 FROM driver_offers WHERE order_id=$1 AND state='ACCEPTED'",[j.order_id])).rowCount)fail(409,'Assignment already reserved');
   const d=(await candidates(c,j)).find(d=>d.user_id===b.driverId);if(!d)fail(409,'Driver no longer eligible');
   await c.query("UPDATE driver_offers SET state='EXPIRED' WHERE order_id=$1 AND state='PENDING'",[j.order_id]);
   j.round++;j.deadline=new Date(Date.now()+limit*1000);
   await c.query("UPDATE dispatch_jobs SET state='SEARCHING',attempts=0,round=$2,deadline=$3,notified_state=NULL,next_attempt=now(),driver_id=NULL WHERE order_id=$1",[j.order_id,j.round,j.deadline]);
   if(!await newOffer(c,j,d))fail(409,'Driver no longer eligible');
   await audit(c,a.id,d.user_id,'MANUAL_DISPATCH_OFFER:'+j.order_id);return {ok:true};
  });
 }
 return {cycle,tick,route,candidates,delivery};
}

