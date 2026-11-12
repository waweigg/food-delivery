import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const db=new pg.Client({connectionString:process.env.DRIVERS_DATABASE_URL});await db.connect();
const schema='dispatch_test_'+randomUUID().replaceAll('-','');await db.query('CREATE SCHEMA '+schema);await db.query('SET search_path TO '+schema);
const scoped=new URL(process.env.DRIVERS_DATABASE_URL);scoped.searchParams.set('options','-c search_path='+schema);
const token=randomUUID()+randomUUID(),ready=new Map(),acks=new Map(),deliveries=new Map();let refuseAck=true,refuseDelivery=false;
const stub=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');const url=new URL(req.url,'http://local');
 if(url.pathname==='/me'){const id=req.headers.authorization?.slice(7);res.end(JSON.stringify({id,role:id==='admin'?'ADMIN':'CUSTOMER'}));return;}
 if(url.pathname.startsWith('/catalog/')){res.end(JSON.stringify({name:'Test kitchen',address:'Fixture',latitude:12.9716,longitude:77.5946}));return;}
 if(req.headers.authorization!=='Bearer '+token){res.writeHead(403);res.end('{}');return;}
 if(url.pathname==='/internal/dispatch/ready'){res.end(JSON.stringify([...ready].filter(([id])=>acks.get(id)?.state!=='ASSIGNED'&&id>(url.searchParams.get('after')||'')).map(([id,restaurant_id])=>({id,restaurant_id})).sort((a,b)=>a.id.localeCompare(b.id))));return;}
 if(url.pathname.endsWith('/contact')){res.end('{"phone":"fixture-only"}');return;}
 let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),id=url.pathname.split('/').at(-1);
 if(b.state==='ASSIGNED'&&refuseAck){res.writeHead(503);res.end('{}');return;}
 if(url.pathname.endsWith('/delivery')){
  const orderId=url.pathname.split('/').at(-2),assignment=acks.get(orderId);
  if(!assignment||assignment.driverId!==b.driverId||assignment.offerId!==b.offerId){res.writeHead(404);res.end('{}');return;}
  if(refuseDelivery){res.writeHead(503);res.end('{}');return;}
  const state=deliveries.get(orderId)||'ASSIGNED';
  if(b.action==='deliver')deliveries.set(orderId,'DELIVERED');
  if(b.action==='pickup')deliveries.set(orderId,'PICKED_UP');
  res.end(JSON.stringify({state:deliveries.get(orderId)||state}));return;
 }
 const old=acks.get(id);if(old?.state==='ASSIGNED'&&JSON.stringify(old)!==JSON.stringify(b)){res.writeHead(409);res.end('{}');return;}
 acks.set(id,b);res.end('{"ok":true}');
});stub.listen(0,'127.0.0.1');await once(stub,'listening');
const base='http://127.0.0.1:'+stub.address().port,children=[];
const env={...process.env,DRIVERS_DATABASE_URL:scoped.href,IDENTITY_URL:base,ORDERS_URL:base,RESTAURANTS_URL:base,DISPATCH_ORDER_TOKEN:token,DISPATCH_ENABLED:'true',DISPATCH_OFFER_SECONDS:'45',DISPATCH_LIMIT_SECONDS:'300',DISPATCH_MAX_ATTEMPTS:'3'};
function start(args=[]){const p=spawn(process.execPath,['service.mjs',...args],{env,stdio:'inherit'});children.push(p);}
const call=(path,who='admin',b)=>fetch('http://localhost:3004'+path,{method:b?'POST':'GET',headers:{authorization:'Bearer '+who,'content-type':'application/json'},body:b?JSON.stringify(b):undefined});
async function until(fn){for(let i=0;i<100;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}throw Error('Condition timed out');}
const job=async id=>(await db.query('SELECT * FROM dispatch_jobs WHERE order_id=$1',[id])).rows[0];
async function due(id){await db.query('UPDATE dispatch_jobs SET next_attempt=now() WHERE order_id=$1',[id]);}
async function seed(id,lat){await db.query("INSERT INTO driver_profiles(user_id,name,vehicle,status,online,latitude,longitude,accuracy,observed_at,received_at,heartbeat_at) VALUES($1,$1,'TEST','APPROVED',true,$2,77.5946,5,now(),now(),now())",[id,lat]);await db.query("INSERT INTO driver_registrations(user_id,channel) VALUES($1,'foreground-poll')",[id]);}
try{
 start();await until(async()=>{try{return(await call('/drivers-health')).ok;}catch{return false;}});
 await seed('nearest',12.9716);await seed('second',12.9816);await seed('third',12.9916);await seed('outside',13.9716);
 const id=randomUUID();ready.set(id,'test');start(['--worker']);
 const first=await until(async()=>{const j=await job(id);return j?.offer_id&&(await db.query('SELECT * FROM driver_offers WHERE id=$1',[j.offer_id])).rows[0];});
 assert.equal(first.driver_id,'nearest');
 assert.equal((await call('/driver-admin/dispatch','nearest')).status,403);
 assert.equal((await call('/driver-admin/dispatch/'+id+'/contact','nearest')).status,403);
 assert.equal((await call('/driver-admin/dispatch/'+id+'/contact').then(r=>r.json())).phone,'fixture-only');
 assert.equal((await call('/driver/offers/'+first.id+'/decline','nearest',{})).status,200);
 const second=await until(async()=>{const j=await job(id);return j.offer_id!==first.id&&(await db.query('SELECT * FROM driver_offers WHERE id=$1',[j.offer_id])).rows[0];});assert.equal(second.driver_id,'second');
 await db.query("UPDATE driver_offers SET expires_at=now()-interval '1 second' WHERE id=$1",[second.id]);await due(id);
 const third=await until(async()=>{const j=await job(id);return j.offer_id!==second.id&&(await db.query('SELECT * FROM driver_offers WHERE id=$1',[j.offer_id])).rows[0];});assert.equal(third.driver_id,'third');
 const claims=await Promise.all([call('/driver/offers/'+second.id+'/accept','second',{}),call('/driver/offers/'+third.id+'/accept','third',{})]);assert.deepEqual(claims.map(r=>r.status),[409,200]);
 await until(async()=>(await job(id)).issue?.includes('pending'));assert.equal((await job(id)).state,'RESERVED');assert.equal((await db.query("SELECT count(*) FROM driver_offers WHERE order_id=$1 AND state='ACCEPTED'",[id])).rows[0].count,'1');
 assert.equal((await call('/driver-admin/dispatch/'+id+'/manual','admin',{driverId:'nearest'})).status,409);
 refuseAck=false;await due(id);await until(async()=>(await job(id)).state==='ASSIGNED');assert.equal(acks.get(id).driverId,'third');assert.equal((await call('/driver/offers/'+third.id+'/accept','third',{})).status,200);

 assert.equal((await call('/driver/deliveries/'+id,'nearest')).status,404);
 assert.equal((await call('/driver/deliveries/'+id,'third',{action:'pickup',driverId:'nearest'})).status,200);
 assert.equal((await job(id)).state,'PICKED_UP');
 refuseDelivery=true;assert.equal((await call('/driver/deliveries/'+id,'third',{action:'deliver',pin:'123456'})).status,503);
 assert.equal((await db.query('SELECT state FROM driver_offers WHERE id=$1',[third.id])).rows[0].state,'ACCEPTED');
 // Simulate a committed order-service response lost before local acknowledgement.
 deliveries.set(id,'DELIVERED');refuseDelivery=false;await due(id);
 await until(async()=>(await job(id)).state==='DELIVERED');
 assert.equal((await db.query('SELECT state FROM driver_offers WHERE id=$1',[third.id])).rows[0].state,'COMPLETED');
 console.log('PASS: owner-only progression, request identity cannot be forged, ambiguous failure holds reservation, worker reconciliation releases terminal delivery.');
 await db.query('UPDATE driver_profiles SET online=false');
 const empty=randomUUID();ready.set(empty,'test');await until(()=>job(empty));await db.query("UPDATE dispatch_jobs SET deadline=now()-interval '1 second',next_attempt=now() WHERE order_id=$1",[empty]);await until(async()=>(await job(empty)).state==='NEEDS_ATTENTION');await until(()=>acks.get(empty)?.state==='NEEDS_ATTENTION');
 assert.ok((await call('/driver-admin/dispatch').then(r=>r.json())).find(j=>j.order_id===empty&&j.issue));
 await db.query("UPDATE driver_profiles SET online=true,observed_at=now(),heartbeat_at=now() WHERE user_id IN ('nearest','second','outside')");
 assert.equal((await call('/driver-admin/dispatch/'+empty+'/manual','admin',{driverId:'outside'})).status,409);
 assert.equal((await call('/driver-admin/dispatch/'+empty+'/manual','admin',{driverId:'nearest'})).status,200);
 const pending=(await job(empty)).offer_id;
 await db.query("UPDATE driver_profiles SET online=false WHERE user_id='nearest'");await due(empty);
 await until(async()=>(await job(empty)).offer_id!==pending);assert.equal((await db.query('SELECT state FROM driver_offers WHERE id=$1',[pending])).rows[0].state,'EXPIRED');
 await db.query("UPDATE dispatch_jobs SET attempts=3,next_attempt=now() WHERE order_id=$1",[empty]);await db.query("UPDATE driver_offers SET state='DECLINED' WHERE order_id=$1 AND state='PENDING'",[empty]);await until(async()=>(await job(empty)).state==='NEEDS_ATTENTION');
 console.log('PASS: distance ranking/radius, sequential decline/expiry/disconnect, expired acceptance rejected, one winner, held reservation across outage, confirmation retry, no-driver operations alert, bounded attempts and guarded manual fallback.');
}finally{for(const c of children)c.kill();await Promise.all(children.map(c=>once(c,'exit')));stub.closeAllConnections();stub.close();await db.query('DROP SCHEMA '+schema+' CASCADE');await db.end();}
