import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {local,sql} from './day14-local.mjs';

const base=process.env.GATEWAY_URL??'http://localhost:8088';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local simulator only');
const pilotRun=process.argv.includes('--pilot');
if(pilotRun)assert.equal(local(['exec','-T','payments','printenv','PAYMENT_PROVIDER']),'local-test','Pilot requires the local simulator');
const credentials=JSON.parse(await readFile(new URL('../.local/demo-credentials.json',import.meta.url),'utf8'));
// Dedicated local fixture: never take over the interactive demo driver's delivery.
const fixtureFile=new URL('../.local/day13-driver.json',import.meta.url);
let fixture;
try {fixture=JSON.parse(await readFile(fixtureFile,'utf8'));} catch(e){if(e.code!=='ENOENT')throw e;}
if(!fixture){
 const account={email:'day13-driver-'+randomUUID()+'@waweigg.test',password:randomUUID()+'Aa1!',name:'Day 13 test driver'};
 const r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',Origin:base},body:JSON.stringify(account)});
 assert.ok(r.ok,'Test driver registration');fixture={...account,id:(await r.json()).user.id};await writeFile(fixtureFile,JSON.stringify(fixture));
}
execFileSync('docker',['compose','-f','compose.yaml','-f','compose.services.yaml','exec','-T','-e','FIXTURE_ID='+fixture.id,'identity','node','--input-type=module'],{input:`
 import {Database} from './dist/database.js';
 if(process.env.APP_ENV!=='development')throw Error('Development only');
 const db=new Database();await db.ready();const id=process.env.FIXTURE_ID;
 await db.$transaction(async tx=>{const u=await tx.user.findUnique({where:{id}});if(!u?.email.startsWith('day13-driver-')||!u.email.endsWith('@waweigg.test'))throw Error('Wrong fixture');await tx.driverProfile.upsert({where:{userId:id},create:{userId:id,approved:true},update:{approved:true}});if(u.role!=='DRIVER'){await tx.user.update({where:{id},data:{role:'DRIVER'}});await tx.session.deleteMany({where:{userId:id}});await tx.auditEvent.create({data:{actorId:'local-day13-operator',targetId:id,action:'LOCAL_DEMO_DRIVER'}});}});await db.$disconnect();`,stdio:['pipe','pipe','pipe']});
credentials.delivery=fixture;
async function request(path,body,token){
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',Origin:base,...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await r.json();assert.ok(r.ok,`${path}: ${data.message??r.status}`);return data;
}
async function login(role){
 const r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json',Origin:base},body:JSON.stringify({email:credentials[role].email,password:credentials[role].password}),signal:AbortSignal.timeout(15000)});
 assert.ok(r.ok,'Demo sign-in failed');const token=r.headers.get('set-auth-token');assert.ok(token);return token;
}
async function until(fn,label){for(let i=0;i<90;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,1000));}throw Error('Timed out: '+label);}
const customer=await login('customer'),restaurant=await login('restaurant'),driver=await login('delivery'),admin=await login('admin');
await request('/driver/apply',{name:'Day 13 test driver',vehicle:'DAY13-LOCAL'},driver);
const profile=await request('/driver/me',undefined,driver);
if(profile.status!=='APPROVED')await request('/driver-admin/'+encodeURIComponent(fixture.id)+'/review',{status:'APPROVED',version:profile.version},admin);
const rid='mlp-demo-malabar',samples=[],dispatch=[],assignment=[],created=[];
let heartbeat,heartbeatError,online=false,pilotWindow,refundOrder;
const pilotPath='/orders/admin/pilot';
const pilotStatus=()=>request(pilotPath,undefined,admin);
async function pilotChange(action,settings={}){
 const {control}=await pilotStatus();
 return request(pilotPath,{action,version:control.version,reason:'Day 15 local pilot rehearsal',...settings},admin);
}
try {
 const existing=await request('/driver/offers',undefined,driver);
 assert.ok(!existing.some(o=>o.state==='ACCEPTED'),'Demo driver has an existing active delivery; finish it before this test');
 await request('/driver/notifications',{channel:'foreground-poll'},driver);
 const locate=()=>request('/driver/location',{latitude:11.0735,longitude:76.074,accuracy:5,observedAt:new Date().toISOString()},driver);
 await locate();await request('/driver/availability',{online:true},driver);online=true;
 heartbeat=setInterval(()=>locate().catch(e=>{heartbeatError=e;}),15000);
 const menu=await request(`/catalog/restaurants/${rid}/menu`);
 const basket={address:{street:'Day 13 local load test · Malappuram',phone:'0500000000',latitude:11.0735,longitude:76.074},currency:'INR',items:[{itemId:menu.categories[0].items[0].id,quantity:1}]};
 const review=await request(`/catalog/restaurants/${rid}/quote`,basket);
 if(pilotRun){
  const {control}=await pilotStatus();
  assert.ok(!control.admitted||Date.parse(control.closes_at)<=Date.now(),'Wait for the existing pilot window to end');
  await pilotChange('pause');
  pilotWindow=await pilotChange('configure',{opensAt:new Date(Date.now()-5000).toISOString(),closesAt:new Date(Date.now()+300000).toISOString(),cap:2,restaurants:[rid]});
  await pilotChange('resume');
  const intents=Array.from({length:3},()=>({key:randomUUID(),restaurantId:rid,basket,review}));
  const attempts=await Promise.allSettled(intents.map(intent=>request('/orders',intent,customer)));
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,2);
  assert.match(attempts.find(a=>a.status==='rejected').reason.message,/order limit/);
  for(let i=0;i<attempts.length;i++)if(attempts[i].status==='fulfilled')created.push({intent:intents[i],order:attempts[i].value});
  await pilotChange('pause');
  await assert.rejects(request('/orders',{...intents[0],key:randomUUID()},customer),/paused/);
  for(const {intent,order} of created)assert.equal((await request('/orders',intent,customer)).id,order.id);
 }
 const results=await Promise.allSettled(Array.from({length:pilotRun?2:3},async(_,index)=>{
  const body={key:randomUUID(),restaurantId:rid,basket,review},start=performance.now();
  const order=pilotRun?created[index].order:await request('/orders',body,customer);
  if(!pilotRun){
   created.push(order.id);samples.push(Math.round(performance.now()-start));
   const repeat=await request('/orders',body,customer);assert.equal(repeat.id,order.id,'Checkout retry must reuse order');
  }
  const attempt=await request('/payments',{orderId:order.id},customer);
  assert.equal((await request(`/payments/${attempt.id}/confirm`,{methodToken:'test_approve'},customer)).status,'SUCCEEDED');
  await until(async()=>(await request('/orders/'+order.id,undefined,customer)).payment_state==='PAID','paid order');
  if(pilotRun&&index===1){
   await request(`/orders/kitchen/${rid}/${order.id}/reject`,{reason:'Day 15 local support refund rehearsal'},restaurant);
   const refundPath=`/admin/payments/${attempt.id}/refund`;
   const refund=await request(refundPath,{reason:'Day 15 controlled simulator refund'},admin);
   assert.equal((await request(refundPath,{reason:'Day 15 refund retry verification'},admin)).id,refund.id);
   await until(async()=>(await request('/orders/'+order.id,undefined,customer)).payment_state==='REFUNDED','refunded order');
   refundOrder=order.id;
   return null;
  }
  for(const [action,body] of [['accept',{minutes:10}],['prepare',{}],['ready',{}]])await request(`/orders/kitchen/${rid}/${order.id}/${action}`,body,restaurant);
  return {id:order.id,ready:performance.now(),attemptId:attempt.id,total:review.totalMinor};
 }));
 for(const result of results)if(result.status==='rejected')throw result.reason;
 const pending=new Map(results.map(r=>r.value).filter(Boolean).map(o=>[o.id,o]));
 while(pending.size){
  const offer=await until(async()=>{
   if(heartbeatError)throw heartbeatError;
   const offers=await request('/driver/offers',undefined,driver);
   assert.ok(offers.filter(o=>o.state==='ACCEPTED').length<=1,'At most one active delivery');
   return offers.find(o=>pending.has(o.order_id)&&o.state==='PENDING');
  },'automatic offer');
  dispatch.push(Math.round(performance.now()-pending.get(offer.order_id).ready));
  const accepted=performance.now();await request(`/driver/offers/${offer.id}/accept`,{},driver);
  await until(async()=>(await request('/orders/'+offer.order_id,undefined,customer)).delivery_state==='ASSIGNED','assignment');
  assignment.push(Math.round(performance.now()-accepted));
  const active=await request('/driver/offers',undefined,driver);assert.equal(active.filter(o=>o.state==='ACCEPTED').length,1);
  const path='/driver/deliveries/'+offer.order_id;
  assert.equal((await request(path,{action:'pickup'},driver)).state,'PICKED_UP');
  if(pilotRun){
   await request(path,{action:'report',reason:'CUSTOMER_UNREACHABLE'},driver);
   assert.equal((await request(`/orders/${offer.order_id}/delivery`,undefined,customer)).issue,'CUSTOMER_UNREACHABLE');
  }
  const delivery=await request(`/orders/${offer.order_id}/delivery`,undefined,customer);assert.match(delivery.pin,/^\d{6}$/);
  assert.equal((await request(path,{action:'deliver',pin:delivery.pin},driver)).state,'DELIVERED');
  assert.equal((await request(path,{action:'deliver',pin:delivery.pin},driver)).state,'DELIVERED','Completion retry is idempotent');
  const final=await request(`/orders/${offer.order_id}/delivery`,undefined,customer);assert.equal(final.state,'DELIVERED');assert.equal(final.pin,null);assert.equal(final.tracking,null);
  if(pilotRun){
   assert.equal(final.issue,null);
   const {attemptId,total}=pending.get(offer.order_id);
   const path='/admin/payments/settlements/'+attemptId;
   const restaurantMinor=total-3000,driverMinor=3000;
   await request(path,{restaurantMinor,driverMinor,platformMinor:0,reason:'Day 15 test allocation only'},admin);
   for(const [beneficiary,amount] of [['restaurant',restaurantMinor],['driver',driverMinor]]){
    const data={beneficiary,reference:'TEST-'+randomUUID(),reason:'Day 15 simulated payout only'};
    assert.equal(Number((await request(path+'/payout',data,admin)).amount),amount);
    assert.equal((await request(path+'/payout',data,admin)).reference,data.reference);
   }
   const records=await request('/admin/payments/settlements',undefined,admin);
   const settlement=records.settlements.find(row=>row.attempt_id===attemptId);
   assert.equal(Number(settlement.restaurant_minor)+Number(settlement.driver_minor)+Number(settlement.platform_minor),total);
   const payouts=records.payouts.filter(row=>row.attempt_id===attemptId);
   assert.equal(payouts.length,2);
   assert.equal(payouts.reduce((sum,row)=>sum+Number(row.amount),0),total);
  }
  pending.delete(offer.order_id);
 }
 assert.equal((await request('/driver/offers',undefined,driver)).filter(o=>o.state==='ACCEPTED').length,0,'Driver released');
 const stats=values=>{const v=[...values].sort((a,b)=>a-b);return {count:v.length,p50Ms:v[Math.ceil(v.length*.5)-1],p95Ms:v[Math.ceil(v.length*.95)-1],maxMs:v.at(-1)};};
 if(pilotRun){
  const state=await pilotStatus();
  assert.ok(state.control.paused);
  assert.equal(state.control.window_id,pilotWindow.window_id);
  assert.equal(state.orders.length,2);
  assert.equal(state.orders.find(o=>o.id===refundOrder).payment_state,'REFUNDED');
  assert.equal(state.orders.filter(o=>o.delivery_state==='DELIVERED').length,1);
  const reconciliation=await request('/admin/reconciliation',undefined,admin);
  assert.ok(Object.values(reconciliation.differences).every(amount=>amount===0),'UTC reconciliation differences');
  assert.equal((await request('/admin/ledger',undefined,admin)).balanced,true);
 assert.equal(sql('payments-db','SELECT count(*) FROM (SELECT attempt_id FROM settlement_journal GROUP BY attempt_id HAVING sum(amount)<>0) differences'),0,'Settlement journals balance');
  const report={at:new Date().toISOString(),admitted:2,capRejected:1,delivered:1,refunded:1,simulatedPayouts:2,checkoutPaused:true,readyToOfferMs:dispatch[0],acceptToAssignedMs:assignment[0],reconciliation};
  await writeFile(new URL('../.local/day15-pilot-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
 }else{
 const report={at:new Date().toISOString(),scope:'Local simulator, 3 concurrent checkouts, one driver, serial deliveries; not a capacity guarantee',delivered:3,checkout:stats(samples),readyToOffer:stats(dispatch),acceptToAssigned:stats(assignment)};
 await writeFile(new URL('../.local/day13-delivery-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }
} finally {
 clearInterval(heartbeat);
 try{
  if(pilotWindow&&!(await pilotStatus()).control.paused)await pilotChange('pause');
 }finally{
  if(online)await request('/driver/availability',{online:false},driver);
 }
 // Keep local test orders and their audit history for investigation, including failures.
 console.log('Local test orders retained:',created.length);
}
