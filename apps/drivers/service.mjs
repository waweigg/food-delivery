import {createDispatch} from './dispatch.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DRIVERS_DATABASE_URL,connectionTimeoutMillis:5000});
const stale=Number(process.env.DRIVER_STALE_SECONDS||60),retention=Number(process.env.DRIVER_RETENTION_SECONDS||900);
if(!Number.isInteger(stale)||stale<30||!Number.isInteger(retention)||retention<stale)throw Error('Invalid location policy');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>8192)fail(413,'Request too large');}try{return JSON.parse(data);}catch{fail(400,'Invalid JSON');}}
async function actor(req){const authorization=req.headers.authorization;if(!authorization?.startsWith('Bearer '))fail(401,'Sign in required');const r=await fetch(process.env.IDENTITY_URL+'/me',{headers:{authorization},signal:AbortSignal.timeout(4000)});if(!r.ok)fail(r.status===401||r.status===403?401:503,'Identity unavailable');const a=await r.json();if(!a.id||!['CUSTOMER','DRIVER','ADMIN'].includes(a.role))fail(403,'Driver access required');return a;}
function internal(req){const a=Buffer.from(req.headers.authorization||''),key=process.env.DRIVER_SERVICE_TOKEN,b=Buffer.from('Bearer '+key);if(!key||key.length<32||a.length!==b.length||!timingSafeEqual(a,b))fail(403,'Service authentication required');}
function fresh(d){return d.status==='APPROVED'&&d.online&&d.accuracy<=100&&d.observed_at&&Date.now()-new Date(d.observed_at).getTime()<stale*1000&&d.heartbeat_at&&Date.now()-new Date(d.heartbeat_at).getTime()<stale*1000;}
async function profile(c,id){const d=(await c.query('SELECT * FROM driver_profiles WHERE user_id=$1 FOR UPDATE',[id])).rows[0];if(!d)fail(404,'Apply as a driver first');return d;}
async function audit(c,a,id,action){await c.query('INSERT INTO driver_audit(actor,driver_id,action) VALUES($1,$2,$3)',[a,id,action]);}
async function clean(){await pool.query("UPDATE driver_profiles SET online=false WHERE online AND (observed_at IS NULL OR observed_at<now()-$1*interval '1 second' OR heartbeat_at<now()-$1*interval '1 second')",[stale]);await pool.query("UPDATE driver_profiles SET latitude=NULL,longitude=NULL,accuracy=NULL,observed_at=NULL,received_at=NULL WHERE received_at<now()-$1*interval '1 second'",[retention]);await pool.query("UPDATE driver_offers SET state='EXPIRED' WHERE state='PENDING' AND expires_at<=now()");}
const dispatch=createDispatch({pool,transaction,fresh,audit,body});
async function route(req){
 const path=new URL(req.url,'http://local').pathname,post=req.method==='POST';
 if(req.method==='GET'&&path==='/drivers-health'){await pool.query('SELECT 1');return {ok:true};}
 if(path.startsWith('/internal/drivers/')){
  internal(req);await clean();
  const tracking=path.match(/^\/internal\/drivers\/tracking\/([a-f0-9-]{36})$/);
  if(tracking&&req.method==='GET'){
   const d=(await pool.query("SELECT p.* FROM dispatch_jobs j JOIN driver_profiles p ON p.user_id=j.driver_id JOIN driver_offers o ON o.id=j.offer_id WHERE j.order_id=$1 AND j.state IN ('ASSIGNED','PICKED_UP') AND o.state='ACCEPTED'",[tracking[1]])).rows[0];
   if(!d)fail(404,'Tracking unavailable');
   return {stale:!fresh(d),observedAt:d.observed_at,latitude:d.latitude,longitude:d.longitude};
  }
  if(req.method==='GET'&&path==='/internal/drivers/eligible')return (await pool.query("SELECT user_id FROM driver_profiles d WHERE status='APPROVED' AND online AND observed_at>now()-$1*interval '1 second' AND heartbeat_at>now()-$1*interval '1 second' AND NOT EXISTS(SELECT 1 FROM driver_offers o WHERE o.driver_id=d.user_id AND o.state='ACCEPTED')",[stale])).rows;
  if(post&&path==='/internal/drivers/offers'){
   if(process.env.DISPATCH_ENABLED==='true')fail(409,'Dispatch coordinator owns offers');
   const b=await body(req);if(!uuid.test(b.id)||!uuid.test(b.orderId)||typeof b.driverId!=='string'||typeof b.pickup!=='string'||!b.pickup.trim()||b.pickup.length>200)fail(400,'Invalid offer');
   return transaction(async c=>{const d=await profile(c,b.driverId);const old=(await c.query('SELECT * FROM driver_offers WHERE id=$1',[b.id])).rows[0];if(old){if(old.driver_id!==b.driverId||old.order_id!==b.orderId||old.pickup!==b.pickup)fail(409,'Offer conflict');return old;}if(!fresh(d))fail(409,'Driver unavailable');if((await c.query("SELECT 1 FROM driver_offers WHERE driver_id=$1 AND state='ACCEPTED'",[d.user_id])).rowCount)fail(409,'Driver busy');return (await c.query("INSERT INTO driver_offers(id,order_id,driver_id,pickup,expires_at) VALUES($1,$2,$3,$4,now()+interval '45 seconds') RETURNING *",[b.id,b.orderId,b.driverId,b.pickup])).rows[0];});
  }
  fail(404,'Unknown service route');
 }
 const a=await actor(req);
 if(path.startsWith('/driver/deliveries/'))return dispatch.delivery(req,path,a);
 if(path.startsWith('/driver-admin/dispatch'))return dispatch.route(req,path,a);
 if(path==='/driver-admin'&&req.method==='GET'){if(a.role!=='ADMIN')fail(403,'Admin required');return (await pool.query('SELECT user_id,name,vehicle,status,version FROM driver_profiles ORDER BY user_id LIMIT 200')).rows;}
 const review=path.match(/^\/driver-admin\/([^/]+)\/review$/);
 if(review&&post){if(a.role!=='ADMIN')fail(403,'Admin required');const b=await body(req);if(!['APPROVED','REJECTED','SUSPENDED'].includes(b.status)||!Number.isInteger(b.version))fail(400,'Invalid review');return transaction(async c=>{const d=await profile(c,decodeURIComponent(review[1]));if(d.version!==b.version)fail(409,'Review changed');await c.query('UPDATE driver_profiles SET status=$2,version=version+1,online=false,latitude=NULL,longitude=NULL,accuracy=NULL,observed_at=NULL,received_at=NULL,heartbeat_at=NULL WHERE user_id=$1',[d.user_id,b.status]);await c.query("UPDATE driver_offers SET state='EXPIRED' WHERE driver_id=$1 AND state='PENDING'",[d.user_id]);await audit(c,a.id,d.user_id,b.status);return {ok:true};});}
 if(path==='/driver/me'&&req.method==='GET'){const d=(await pool.query('SELECT * FROM driver_profiles WHERE user_id=$1',[a.id])).rows[0];return d?{...d,eligible:fresh(d),staleSeconds:stale,retentionSeconds:retention}:null;}
 if(path==='/driver/apply'&&post){const b=await body(req);if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||typeof b.vehicle!=='string'||!b.vehicle.trim()||b.vehicle.length>100)fail(400,'Name and vehicle required');return transaction(async c=>{await c.query('INSERT INTO driver_profiles(user_id,name,vehicle) VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING',[a.id,b.name.trim(),b.vehicle.trim()]);return profile(c,a.id);});}
 if(path==='/driver/notifications'&&post){const b=await body(req);if(b.channel!=='foreground-poll')fail(400,'Only foreground pilot supported');return transaction(async c=>{await profile(c,a.id);await c.query("INSERT INTO driver_registrations(user_id,channel) VALUES($1,'foreground-poll') ON CONFLICT(user_id) DO UPDATE SET updated_at=now()",[a.id]);return {ok:true,channel:'foreground-poll'};});}
 if(path==='/driver/availability'&&post){const b=await body(req);if(typeof b.online!=='boolean')fail(400,'Online must be boolean');return transaction(async c=>{const d=await profile(c,a.id);if(b.online&&(!fresh({...d,online:true,heartbeat_at:new Date()})||!(await c.query('SELECT 1 FROM driver_registrations WHERE user_id=$1',[a.id])).rowCount))fail(409,'Approval, fresh GPS and notification registration required');await c.query('UPDATE driver_profiles SET online=$2,heartbeat_at=now() WHERE user_id=$1',[a.id,b.online]);if(!b.online)await c.query("UPDATE driver_offers SET state='EXPIRED' WHERE driver_id=$1 AND state='PENDING'",[a.id]);return {online:b.online};});}
 if(path==='/driver/location'&&post){const b=await body(req);if(Object.keys(b).some(k=>!['latitude','longitude','accuracy','observedAt'].includes(k))||typeof b.latitude!=='number'||!Number.isFinite(b.latitude)||Math.abs(b.latitude)>90||typeof b.longitude!=='number'||!Number.isFinite(b.longitude)||Math.abs(b.longitude)>180||typeof b.accuracy!=='number'||!Number.isFinite(b.accuracy)||b.accuracy<0||b.accuracy>100||!Number.isFinite(Date.parse(b.observedAt))||Date.now()-Date.parse(b.observedAt)>stale*1000||Date.parse(b.observedAt)>Date.now()+5000)fail(400,'Fresh accurate device location required');return transaction(async c=>{const d=await profile(c,a.id);if(d.status!=='APPROVED')fail(403,'Approval required');if(d.received_at&&Date.now()-new Date(d.received_at).getTime()<5000)fail(429,'Wait before next location');if(d.observed_at&&Date.parse(b.observedAt)<=new Date(d.observed_at).getTime())fail(409,'Location must be newer');await c.query('UPDATE driver_profiles SET latitude=$2,longitude=$3,accuracy=$4,observed_at=$5,received_at=now(),heartbeat_at=now() WHERE user_id=$1',[a.id,b.latitude,b.longitude,b.accuracy,b.observedAt]);return {ok:true};});}
 if(path==='/driver/offers'&&req.method==='GET'){return transaction(async c=>{const d=await profile(c,a.id);if(d.status!=='APPROVED')return [];return (await c.query("SELECT id,order_id,pickup,expires_at,state,(SELECT state FROM dispatch_jobs WHERE order_id=driver_offers.order_id) AS dispatch_state FROM driver_offers WHERE driver_id=$1 AND (state='ACCEPTED' OR (state='PENDING' AND expires_at>now() AND $2)) ORDER BY created_at",[a.id,Boolean(fresh(d))])).rows;});}
 const decision=path.match(/^\/driver\/offers\/([a-f0-9-]+)\/(accept|decline)$/);
 if(decision&&post){return transaction(async c=>{
  const ref=(await c.query('SELECT order_id FROM driver_offers WHERE id=$1 AND driver_id=$2',[decision[1],a.id])).rows[0];if(!ref)fail(404,'Offer unavailable');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['dispatch:'+ref.order_id]);
  const j=(await c.query('SELECT * FROM dispatch_jobs WHERE order_id=$1 FOR UPDATE',[ref.order_id])).rows[0];
  const d=await profile(c,a.id);const o=(await c.query('SELECT * FROM driver_offers WHERE id=$1 AND driver_id=$2 FOR UPDATE',[decision[1],a.id])).rows[0];if(!o)fail(404,'Offer unavailable');const state=decision[2]==='accept'?'ACCEPTED':'DECLINED';if(d.status!=='APPROVED')fail(403,'Approval required');if(o.state===state)return o;if(j&&(j.state!=='SEARCHING'||new Date(j.deadline)<=new Date()||j.offer_id!==o.id))fail(409,'Dispatch offer no longer current');if(o.state!=='PENDING'||new Date(o.expires_at)<=new Date()||!fresh(d))fail(409,'Offer unavailable');const result=(await c.query('UPDATE driver_offers SET state=$2 WHERE id=$1 RETURNING *',[o.id,state])).rows[0];if(state==='ACCEPTED')await c.query("UPDATE driver_offers SET state='EXPIRED' WHERE driver_id=$1 AND id<>$2 AND state='PENDING'",[a.id,o.id]);if(j&&state==='ACCEPTED')await c.query("UPDATE dispatch_jobs SET state='RESERVED',driver_id=$2,offer_id=$3,next_attempt=now(),issue=NULL WHERE order_id=$1",[o.order_id,a.id,o.id]);if(j&&state==='DECLINED')await c.query('UPDATE dispatch_jobs SET next_attempt=now() WHERE order_id=$1',[o.order_id]);await audit(c,a.id,a.id,state);return result;});}
 fail(404,'Not found');
}
const worker=process.argv.includes('--worker');
if(!worker)await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
if(worker){
 if(process.env.DISPATCH_ENABLED!=='true')throw Error('Dispatch disabled');
 for(;;){try{await clean();await dispatch.cycle();}catch{console.error('Dispatch cycle unavailable; will retry');}await new Promise(r=>setTimeout(r,1000));}
}
await clean();const timer=setInterval(()=>clean().catch(()=>console.error('Driver cleanup failed')),10000);
const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');try{res.end(JSON.stringify(await route(req)));}catch(e){res.statusCode=e.status||(e.code==='23505'?409:503);res.end(JSON.stringify({message:e.status?e.message:'Driver service unavailable'}));}});
server.listen(Number(process.env.PORT||3004),'0.0.0.0');
process.on('SIGTERM',()=>{clearInterval(timer);server.close(()=>pool.end());});
