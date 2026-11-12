import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';

if(process.env.PAYMENT_PROVIDER!=='local-test'||process.env.APP_ENV!=='development')throw Error('Development simulator only');
const db=new pg.Pool({connectionString:process.env.PAYMENTS_DATABASE_URL});
const base='http://gateway:8080';
async function send(path,body,token,extra={}){
  return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',Origin:process.env.TEST_ORIGIN||'http://localhost:8088',...(token?{authorization:'Bearer '+token}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
}
async function asJson(r){const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
async function account(){
  const r=await send('/api/auth/sign-up/email',{name:'Local payment test',email:randomUUID()+'@example.test',password:randomUUID()+'9a'});
  assert.ok(r.ok);return r.headers.get('set-auth-token');
}
const owner=await account(),other=await account();
async function order(){
  const restaurantId='day5-demo-kitchen';
  const basket={address:{street:'Test road',phone:'9876543210',latitude:12.9716,longitude:77.5946},currency:'INR',items:[{itemId:'day5-demo-paneer',quantity:1}]};
  const review=await asJson(await send('/catalog/restaurants/'+restaurantId+'/quote',basket));
  return asJson(await send('/orders',{key:randomUUID(),restaurantId,basket,review},owner));
}
try{
  const o=await order();
  const start=()=>send('/payments',{orderId:o.id},owner).then(asJson);
  const attempts=await Promise.all(Array.from({length:6},start));
  assert.equal(new Set(attempts.map(a=>a.id)).size,1);
  const a=attempts[0],confirm=(id,methodToken)=>send('/payments/'+id+'/confirm',{methodToken},owner).then(asJson);
  assert.equal((await send('/payments/'+a.id,undefined,other)).status,404);
  assert.equal((await send('/orders/'+o.id+'/cancel',{},owner)).status,409);
  assert.equal((await confirm(a.id,'test_decline')).status,'FAILED');
  const b=await start();assert.notEqual(a.id,b.id);
  assert.equal((await confirm(b.id,'test_abandon')).status,'ABANDONED');
  const c=await start();
  const raw={eventId:randomUUID(),reference:c.reference};
  const time=String(Math.floor(Date.now()/1000));
  const sig=createHmac('sha256',process.env.PAYMENTS_WEBHOOK_SECRET).update(time+'.'+JSON.stringify(raw)).digest('hex');
  assert.equal((await send('/payments/webhook',raw,null,{'x-event-time':time,'x-event-signature':'0'.repeat(64)})).status,403);
  // Simulate capture at the provider while its delivery to the application is lost.
  await db.query("UPDATE sandbox_ledger SET state='SUCCEEDED' WHERE reference=$1",[c.reference]);
  for(let i=0;i<2;i++)assert.equal((await send('/payments/webhook',raw,null,{'x-event-time':time,'x-event-signature':sig})).status,200);
  assert.equal((await db.query('SELECT * FROM provider_events WHERE event_id=$1',[raw.eventId])).rowCount,1);
  assert.equal((await confirm(c.id,'test_decline')).status,'SUCCEEDED');
  assert.equal((await start()).id,c.id);
  assert.equal((await asJson(await send('/orders/'+o.id,undefined,owner))).payment_state,'PAID');
  const recovery=await order();
  const d=await asJson(await send('/payments',{orderId:recovery.id},owner));
  await db.query("UPDATE sandbox_ledger SET state='SUCCEEDED' WHERE reference=$1",[d.reference]);
  for(let i=0;i<30;i++){
    if((await asJson(await send('/orders/'+recovery.id,undefined,owner))).payment_state==='PAID')break;
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal((await asJson(await send('/orders/'+recovery.id,undefined,owner))).payment_state,'PAID');
  console.log('PASS: concurrent initiation, decline, abandonment, retry, capture, forged and repeated webhooks, ownership, cancellation race, and reconciliation after lost notification.');
}finally{await db.end();}
