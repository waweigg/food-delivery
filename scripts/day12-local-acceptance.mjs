import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const base=process.env.GATEWAY_URL??'http://localhost:8088';
const credentials=JSON.parse(await readFile(new URL('../.local/demo-credentials.json',import.meta.url),'utf8'));
async function request(path,body,token){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',Origin:base,...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const type=response.headers.get('content-type')??'';assert.ok(type.includes('application/json'),`${path}: expected JSON but received ${response.status} ${type}`);
 const data=await response.json();assert.ok(response.ok,`${path}: ${data.message??response.status}`);return data;
}
async function login(who){
 const r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json',Origin:base},body:JSON.stringify({email:credentials[who].email,password:credentials[who].password}),signal:AbortSignal.timeout(15000)});
 assert.ok(r.ok,'Local demo sign-in failed');const token=r.headers.get('set-auth-token');assert.ok(token,'Expected bearer session token');return token;
}
const customer=await login('customer'),restaurant=await login('restaurant'),admin=await login('admin');
const restaurantId='mlp-demo-malabar';
const menu=await request(`/catalog/restaurants/${restaurantId}/menu`);
const basket={address:{street:'Day 12 local test · Malappuram',phone:'0500000000',latitude:11.0735,longitude:76.074},currency:'INR',items:[{itemId:menu.categories[0].items[0].id,quantity:1}]};
const review=await request(`/catalog/restaurants/${restaurantId}/quote`,basket);
const order=await request('/orders',{key:randomUUID(),restaurantId,basket,review},customer);
const attempt=await request('/payments',{orderId:order.id},customer);
const paid=await request(`/payments/${attempt.id}/confirm`,{methodToken:'test_approve'},customer);
assert.equal(paid.status,'SUCCEEDED');
await request(`/orders/kitchen/${restaurantId}/${order.id}/reject`,{reason:'Restaurant unavailable for local refund verification'},restaurant);
const refund=await request(`/admin/payments/${attempt.id}/refund`,{reason:'Development refund acceptance check'},admin);
const repeat=await request(`/admin/payments/${attempt.id}/refund`,{reason:'Repeat idempotency acceptance request'},admin);
assert.equal(repeat.id,refund.id,'Repeated full-refund request must reuse the same refund');
let result;
for(let i=0;i<18;i++){
 result=(await request('/admin/payments',undefined,admin)).find(x=>x.id===attempt.id);
 if(result?.refund_status==='SUCCEEDED')break;
 await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.equal(result?.refund_status,'SUCCEEDED','Asynchronous refund should reach provider-confirmed success');
assert.equal((await request(`/orders/${order.id}`,undefined,customer)).payment_state,'REFUNDED');
const matches=await request('/orders/admin?q='+encodeURIComponent(order.id),undefined,admin);
assert.ok(matches.some(row=>row.id===order.id),'Admin order search returns the target order');
const details=await request('/orders/admin/'+order.id,undefined,admin);
assert.ok(details.events.some(event=>event.kind==='PAYMENT_REFUNDED'),'Admin order detail includes the refund audit event');
await request('/orders/admin/'+order.id+'/cancel',{reason:'Local refund check is complete'},admin);
assert.equal((await request('/orders/admin/'+order.id,undefined,admin)).order_state,'CANCELLED','Admin cancellation is audited after refund');
const ledger=await request('/admin/ledger',undefined,admin);
const entries=ledger.entries.filter(e=>e.attempt_id===attempt.id);
assert.equal(entries.length,4,'Capture and refund each create a balanced pair');
assert.equal(entries.reduce((sum,e)=>sum+Number(e.amount),0),0,'Capture and reversal net to zero');
assert.equal(ledger.balanced,true,'The complete append-only ledger remains balanced');
const day=new Date().toISOString().slice(0,10),reconciliation=await request('/admin/reconciliation?day='+day,undefined,admin);
assert.ok(Object.values(reconciliation.differences).every(value=>value===0),'Payment, provider and ledger totals reconcile for UTC day');
console.log('PASS: admin full refund, repeated request idempotency, order state, balanced reversal ledger, and UTC simulator reconciliation.');
