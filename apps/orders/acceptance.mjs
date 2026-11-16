import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const db=new pg.Client({connectionString:process.env.ORDERS_DATABASE_URL});
await db.connect();
const schema='checkout_test_'+randomUUID().replaceAll('-','');
await db.query('CREATE SCHEMA '+schema);
const scoped=new URL(process.env.ORDERS_DATABASE_URL);
scoped.searchParams.set('options','-c search_path='+schema);
const owner=randomUUID(),other=randomUUID();
let price=17900,trackingReads=0;
function current(){return {restaurantId:'kitchen',currency:'INR',items:[{itemId:'bowl',name:'Bowl',quantity:1,unitMinor:price,lineMinor:price}],subtotalMinor:price,deliveryMinor:3000,otherMinor:0,totalMinor:price+3000};}
const api=http.createServer((req,res)=>{
  if(req.url.startsWith('/internal/drivers/tracking/')){trackingReads++;res.setHeader('content-type','application/json');res.end(JSON.stringify({stale:true,latitude:null,longitude:null}));return;}
  if(req.url.startsWith('/restaurant-onboarding/')){
    res.setHeader('Content-Type','application/json');
    if(req.headers.authorization!=='Bearer '+owner){res.writeHead(404);res.end('{}');return;}
    res.end(JSON.stringify({id:'kitchen',status:'APPROVED'}));return;
  }
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url==='/me'?{id:req.headers.authorization.slice(7),role:req.headers.authorization==='Bearer admin'?'ADMIN':'CUSTOMER'}:current()));
});
api.listen(0,'127.0.0.1');await once(api,'listening');
const service='http://127.0.0.1:'+api.address().port;
const env={...process.env,DELIVERY_PIN_KEY:randomUUID()+randomUUID(),DRIVERS_URL:service,ORDERS_DATABASE_URL:scoped.href,IDENTITY_URL:service,RESTAURANTS_URL:service,TEST_ORDERS_ENABLED:'true',APP_ENV:'development'};
const children=[];
function start(args){const proc=spawn(process.execPath,['service.mjs',...args],{env,stdio:'inherit'});children.push(proc);}
async function call(path,who,payload){return fetch('http://localhost:3002'+path,{method:payload?'POST':'GET',headers:{authorization:'Bearer '+who,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});}
try{
  start([]);
  let ready=false;
  for(let i=0;i<60;i++){try{if((await call('/orders-health',owner)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready);
  const b={key:randomUUID(),restaurantId:'kitchen',basket:{address:{street:'Fixture'},currency:'INR',items:[{itemId:'bowl',quantity:1}]},review:current()};
  const responses=await Promise.all(Array.from({length:12},()=>call('/orders',owner,b)));
  const orders=await Promise.all(responses.map(r=>{assert.equal(r.status,200);return r.json();}));
  const id=orders[0].id;
  assert.equal(new Set(orders.map(o=>o.id)).size,1);
  assert.equal((await call('/orders',owner).then(r=>r.json())).length,1);
  price+=100;
  assert.equal((await call('/orders',owner,b).then(r=>r.json())).quote.totalMinor,20900);
  assert.equal((await call('/orders',owner,{...b,key:randomUUID()})).status,409);
  assert.equal((await call('/orders',owner,{...b,review:current()})).status,409);
  assert.equal((await call('/orders/'+id,other)).status,404);
  assert.equal((await call('/orders/'+id+'/cancel',other,{})).status,404);
  assert.equal((await call('/orders/'+id+'/pay',owner,{})).status,405);
  assert.equal((await call('/orders/'+id+'/cancel',owner,{})).status,200);
  assert.equal((await call('/orders/'+id+'/cancel',owner,{})).status,409);
  const snapshot=await call('/orders/'+id,owner).then(r=>r.json());
  assert.equal(snapshot.quote.totalMinor,20900);
  assert.equal(snapshot.payment_state,'UNPAID');assert.equal(snapshot.delivery_state,'UNASSIGNED');
  await db.query('SET search_path TO '+schema);
  await assert.rejects(db.query("UPDATE orders SET quote='{}' WHERE id=$1",[id]),/immutable/);
  await assert.rejects(db.query("UPDATE orders SET delivery_state='ASSIGNED' WHERE id=$1",[id]),/invalid delivery/);
  await assert.rejects(db.query("UPDATE orders SET payment_state='PAID' WHERE id=$1",[id]),/invalid payment/);
  assert.equal((await db.query('SELECT * FROM outbox')).rowCount,2);
  start(['--worker']);
  for(let i=0;i<40;i++){if((await db.query('SELECT * FROM order_activity')).rowCount===2)break;await new Promise(r=>setTimeout(r,150));}
  assert.equal((await db.query('SELECT * FROM outbox WHERE processed_at IS NOT NULL')).rowCount,2);
  const stopped=children.pop();const stoppedExit=once(stopped,'exit');stopped.kill();await stoppedExit;
  const fresh=await call('/orders',owner,{...b,key:randomUUID(),review:current()}).then(r=>r.json());
  assert.ok((await db.query('SELECT 1 FROM outbox WHERE processed_at IS NULL')).rowCount>0);
  start(['--worker']);
  for(let i=0;i<40;i++){if(!(await db.query('SELECT 1 FROM outbox WHERE processed_at IS NULL')).rowCount)break;await new Promise(r=>setTimeout(r,150));}
  assert.equal((await db.query('SELECT 1 FROM outbox WHERE processed_at IS NULL')).rowCount,0);
  assert.equal((await db.query('SELECT count(*) n FROM order_activity')).rows[0].n,'3');
  console.log('PASS: restarted order worker resumes persisted pending work without duplicate activity');
  const serviceToken=env.PAYMENTS_ORDER_TOKEN;
  assert.ok(serviceToken);
  const attempt=randomUUID();
  const settlement={attempt,owner,amount:current().totalMinor,currency:'INR'};
  const internal=(action,data)=>call('/internal/orders/'+fresh.id+'/payment/'+action,serviceToken,data);
  assert.equal((await internal('reserve',settlement)).status,200);
  assert.equal((await internal('settle',{...settlement,status:'SUCCEEDED'})).status,200);
  const kitchen='/orders/kitchen/kitchen/'+fresh.id;
  assert.equal((await call(kitchen,other)).status,404);
  assert.equal((await call(kitchen+'/ready',owner,{})).status,409);
  await db.query('DELETE FROM restaurant_alerts WHERE order_id=$1',[fresh.id]);
  assert.equal((await call(kitchen,owner)).status,200);
  const accepted=await Promise.all(Array.from({length:8},()=>call(kitchen+'/accept',owner,{minutes:20})));
  assert.ok(accepted.every(r=>r.status===200));
  assert.equal((await db.query("SELECT * FROM order_events WHERE order_id=$1 AND kind='KITCHEN_ACCEPTED'",[fresh.id])).rowCount,1);
  assert.equal((await call(kitchen+'/prepare',owner,{})).status,200);
  assert.equal((await call(kitchen+'/ready',owner,{})).status,200);
  assert.equal((await call(kitchen,owner).then(r=>r.json())).state,'READY');
  assert.equal((await call('/orders/'+fresh.id,owner).then(r=>r.json())).payment_state,'PAID');
  for (const mode of ['reject','expire']) {
    const target=await call('/orders',owner,{...b,key:randomUUID(),review:current()}).then(r=>r.json());
    const data={...settlement,attempt:randomUUID()};
    const pay=(action,value)=>call('/internal/orders/'+target.id+'/payment/'+action,serviceToken,value);
    assert.equal((await pay('reserve',data)).status,200);
    assert.equal((await pay('settle',{...data,status:'SUCCEEDED'})).status,200);
    const url='/orders/kitchen/kitchen/'+target.id;
    if(mode==='reject'){
      assert.equal((await call(url+'/reject',owner,{reason:'Test kitchen unavailable'})).status,200);
      assert.equal((await call(url+'/reject',owner,{reason:'Test kitchen unavailable'})).status,200);
    }else{
      await db.query("UPDATE kitchen_tickets SET deadline=now()-interval '1 minute' WHERE order_id=$1",[target.id]);
      assert.equal((await call(url+'/accept',owner,{minutes:20})).status,409);
    }
    assert.equal((await db.query('SELECT * FROM payment_recovery WHERE order_id=$1',[target.id])).rowCount,1);
    await assert.rejects(db.query("UPDATE orders SET delivery_state='ASSIGNED' WHERE id=$1",[target.id]),/ready/);
    assert.equal((await call(url+'/prepare',owner,{})).status,409);
  }
  const dispatchToken=env.DISPATCH_ORDER_TOKEN;
  assert.ok(dispatchToken);
  assert.equal((await call('/internal/dispatch/'+fresh.id+'/contact',owner)).status,403);
  assert.equal((await call('/internal/dispatch/'+fresh.id+'/contact',dispatchToken)).status,200);
  const assignment={state:'ASSIGNED',driverId:randomUUID(),offerId:randomUUID()};
  assert.equal((await call('/internal/dispatch/'+fresh.id,owner,assignment)).status,403);
  assert.equal((await call('/internal/dispatch/'+id,dispatchToken,assignment)).status,409);
  const rival={...assignment,driverId:randomUUID(),offerId:randomUUID()};
  const race=await Promise.all([assignment,rival].map(a=>call('/internal/dispatch/'+fresh.id,dispatchToken,a)));
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const winner=race[0].ok?assignment:rival;
  assert.equal((await call('/internal/dispatch/'+fresh.id,dispatchToken,winner)).status,200);
  assert.equal((await call('/orders/'+fresh.id,owner).then(r=>r.json())).delivery_state,'ASSIGNED');
  assert.equal((await db.query("SELECT 1 FROM order_events WHERE order_id=$1 AND kind='DISPATCH_ASSIGNED'",[fresh.id])).rowCount,1);

  const delivery='/internal/dispatch/'+fresh.id+'/delivery';
  const command=(action,extra={})=>call(delivery,dispatchToken,{...winner,action,...extra});
  const tracking='/orders/'+fresh.id+'/delivery';
  assert.equal((await call(delivery,owner,{...winner,action:'pickup'})).status,403);
  assert.equal((await command('pickup',{driverId:'intruder'})).status,404);
  assert.equal((await command('deliver',{pin:'123456'})).status,409);
  await assert.rejects(db.query("UPDATE orders SET delivery_state='DELIVERED' WHERE id=$1",[fresh.id]),/invalid delivery/);
  assert.equal((await call(tracking,other)).status,404);assert.equal(trackingReads,0);
  const customerView=await call(tracking,owner).then(r=>r.json());assert.match(customerView.pin,/^\d{6}$/);assert.equal(customerView.tracking.stale,true);
  const driverView=await command('view').then(r=>r.json());assert.equal(driverView.pin,undefined);assert.equal(driverView.nonce,undefined);
  assert.equal((await call('/orders/delivery-admin',owner)).status,403);
  assert.equal((await call('/orders/delivery-admin/'+fresh.id,'admin',{state:'DELIVERED',reason:'Verified customer receipt'})).status,409);
  const pickups=await Promise.all(Array.from({length:6},()=>command('pickup')));assert.ok(pickups.every(r=>r.ok));
  assert.equal((await db.query("SELECT 1 FROM order_events WHERE order_id=$1 AND kind='DELIVERY_PICKED_UP'",[fresh.id])).rowCount,1);
  assert.equal((await command('report',{reason:'CUSTOMER_UNREACHABLE'})).status,200);
  assert.equal((await call('/orders/delivery-admin','admin').then(r=>r.json()))[0].issue,'CUSTOMER_UNREACHABLE');
  const wrong=customerView.pin==='000000'?'000001':'000000';
  for(let n=1;n<=5;n++)assert.equal((await command('deliver',{pin:wrong})).status,n===5?429:422);
  assert.equal((await command('deliver',{pin:customerView.pin})).status,429);
  await db.query("UPDATE delivery_confirmations SET locked_until=now()-interval '1 second' WHERE order_id=$1",[fresh.id]);
  const completions=await Promise.all(Array.from({length:8},()=>command('deliver',{pin:customerView.pin})));assert.ok(completions.every(r=>r.ok));
  assert.equal((await db.query("SELECT 1 FROM order_events WHERE order_id=$1 AND kind='DELIVERY_DELIVERED'",[fresh.id])).rowCount,1);
  const reads=trackingReads,closed=await call(tracking,owner).then(r=>r.json());assert.equal(closed.pin,null);assert.equal(closed.tracking,null);assert.equal(trackingReads,reads);
  assert.equal((await command('view').then(r=>r.json())).address,undefined);
  assert.equal((await db.query('SELECT active FROM order_dispatch WHERE order_id=$1',[fresh.id])).rows[0].active,false);
  // A completed driver can receive another assignment; failures need an audited admin resolution.
  for(const state of ['FAILED','DELIVERED']){
   const next=await call('/orders',owner,{...b,key:randomUUID(),review:current()}).then(r=>r.json());
   const payment={...settlement,attempt:randomUUID()};
   for(const action of ['reserve','settle'])assert.equal((await call('/internal/orders/'+next.id+'/payment/'+action,serviceToken,{...payment,status:'SUCCEEDED'})).status,200);
   const kitchenUrl='/orders/kitchen/kitchen/'+next.id;
   for(const action of ['accept','prepare','ready'])assert.equal((await call(kitchenUrl+'/'+action,owner,{minutes:20})).status,200);
   const assign={...winner,offerId:randomUUID()};assert.equal((await call('/internal/dispatch/'+next.id,dispatchToken,assign)).status,200);
   assert.equal((await call('/internal/dispatch/'+next.id+'/delivery',dispatchToken,{...assign,action:'pickup'})).status,200);
   assert.equal((await call('/orders/delivery-admin/'+next.id,owner,{state,reason:'Unauthorized resolution'})).status,403);
   assert.equal((await call('/orders/delivery-admin/'+next.id,'admin',{state,reason:'Verified with customer and restaurant'})).status,200);
   assert.equal((await call('/orders/delivery-admin/'+next.id,'admin',{state,reason:'Retry verified resolution'})).status,200);
   assert.equal((await db.query("SELECT 1 FROM order_events WHERE order_id=$1 AND kind='DELIVERY_ADMIN_EXCEPTION'",[next.id])).rowCount,1);
   if(state==='FAILED')assert.equal((await db.query('SELECT status FROM payment_recovery WHERE order_id=$1',[next.id])).rows[0].status,'REVIEW_REQUIRED');
  }
  console.log('PASS: assigned-driver guards, pickup order, customer-only PIN/tracking, persistent rate limit, concurrent once-only completion, terminal privacy, driver release and audited admin resolutions.');
  console.log('PASS: authenticated dispatch, unpaid exclusion, concurrent assignment has one winner, idempotent acknowledgement and customer state.');
  console.log('PASS: rejection and expiry enqueue one refund review and prevent dispatch.');
  console.log('PASS: kitchen ownership, polling without alerts, concurrent acceptance, preparing and ready.');
  console.log('PASS: concurrent checkout, retained snapshot, stale quote, key conflict, ownership, invalid transitions and outbox processing.');
  const pilotPath='/orders/admin/pilot';
  const change=async(action,settings={},expected=200)=>{
    const {control}=await call(pilotPath,'admin').then(r=>r.json());
    const response=await call(pilotPath,'admin',{action,version:control.version,reason:'Local pilot acceptance check',...settings});
    assert.equal(response.status,expected);
    return response.json();
  };
  const now=Date.now(),iso=offset=>new Date(now+offset).toISOString();
  const settings={opensAt:iso(-60000),closesAt:iso(3600000),cap:1,restaurants:['kitchen']};
  const intent=overrides=>({...b,key:randomUUID(),review:current(),...overrides});
  assert.equal((await call(pilotPath,owner)).status,403);
  assert.equal((await call(pilotPath,owner,{action:'pause',version:0,reason:'Unauthorized pilot change'})).status,403);
  await change('pause');
  await change('configure',{...settings,opensAt:iso(1800000)});
  await change('resume');
  assert.match((await call('/orders',owner,intent()).then(r=>r.json())).message,/staffed hours/);
  await change('pause');
  await change('configure',settings);
  await change('resume');
  assert.match((await call('/orders',owner,intent({restaurantId:'other'})).then(r=>r.json())).message,/outside the local pilot/);
  const pair=[intent(),intent()];
  const raced=await Promise.all(pair.map(input=>call('/orders',owner,input)));
  assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
  const index=raced.findIndex(r=>r.ok);
  const order=await raced[index].json();
  const state=await call(pilotPath,'admin').then(r=>r.json());
  assert.equal(state.control.admitted,1);
  assert.equal(state.orders[0].id,order.id);
  await change('pause');
  await change('resume',{version:state.control.version},409);
  await change('configure',settings,409);
  assert.match((await call('/orders',owner,intent()).then(r=>r.json())).message,/paused/);
  assert.equal((await call('/orders',owner,pair[index]).then(r=>r.json())).id,order.id);
  assert.equal((await call('/orders/'+order.id+'/cancel',owner,{})).status,200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pilot_audit')).rows[0].n,7);
  console.log('PASS: admin-only pilot controls, staffed hours, allowlist, concurrent cap, audited pause and existing orders.');
}finally{
  for(const c of children)c.kill();
  api.close();await db.query('DROP SCHEMA '+schema+' CASCADE');await db.end();
}



