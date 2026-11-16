import {settlements} from './settlements.mjs';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {LocalProvider,StripeTestProvider} from './provider.mjs';

const env=process.env;
if(env.APP_ENV!=='development'||!['local-test','stripe-test'].includes(env.PAYMENT_PROVIDER)||!env.PAYMENTS_DATABASE_URL||[env.PAYMENTS_ORDER_TOKEN,env.PAYMENTS_WEBHOOK_SECRET].some(v=>!v||v.length<32))throw new Error('Configure a development payment provider and service secrets.');
const pool=new pg.Pool({connectionString:env.PAYMENTS_DATABASE_URL,connectionTimeoutMillis:4000});
const provider=env.PAYMENT_PROVIDER==='local-test'
  ? new LocalProvider(new pg.Pool({connectionString:env.PAYMENTS_DATABASE_URL}),env.PAYMENTS_WEBHOOK_SECRET)
  : new StripeTestProvider(env.STRIPE_TEST_SECRET_KEY,env.STRIPE_TEST_WEBHOOK_SECRET,env.PAYMENT_RETURN_URL);
const validId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function fail(status,msg){throw Object.assign(new Error(msg),{status});}
async function rawBody(req){let length=0;const parts=[];for await(const p of req){length+=p.length;if(length>8192)fail(413,'Request too large');parts.push(p);}return Buffer.concat(parts);}
function parse(raw){try{return JSON.parse(raw);}catch{fail(400,'Invalid JSON');}}
async function remote(url,authorization,data){
  const r=await fetch(url,{method:data?'POST':'GET',headers:{authorization,'content-type':'application/json'},body:data?JSON.stringify(data):undefined,redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok)fail([401,403,404,409].includes(r.status)?r.status:503,'Order or identity service unavailable for this payment');
  return r.json();
}
async function updateOrder(a,action){
  return remote(env.ORDERS_URL+'/internal/orders/'+a.order_id+'/payment/'+action,'Bearer '+env.PAYMENTS_ORDER_TOKEN,
    {attempt:a.id,owner:a.owner_id,amount:Number(a.amount),currency:a.currency,status:a.status});
}
async function tx(fn){
  const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
function view(a){return {id:a.id,orderId:a.order_id,provider:a.provider,reference:a.reference,amountMinor:Number(a.amount),currency:a.currency,status:a.status,synchronized:a.synchronized};}
async function ledgerCapture(c,a){
  const journal=a.id;
  await c.query("INSERT INTO ledger_entries(id,journal_id,order_id,attempt_id,account,amount,currency) VALUES($1,$2,$3,$4,'PROCESSOR_CLEARING',$5,$6),($7,$2,$3,$4,'CUSTOMER_FUNDS_HELD',$8,$6) ON CONFLICT DO NOTHING",
    [randomUUID(),journal,a.order_id,a.id,a.amount,a.currency,randomUUID(),-Number(a.amount)]);
}
async function ledgerRefund(c,r,a){
  await c.query("INSERT INTO ledger_entries(id,journal_id,order_id,attempt_id,refund_id,account,amount,currency) VALUES($1,$2,$3,$4,$5,'PROCESSOR_CLEARING',$6,$7),($8,$2,$3,$4,$5,'CUSTOMER_FUNDS_HELD',$9,$7) ON CONFLICT DO NOTHING",
    [randomUUID(),r.journal_id,a.order_id,a.id,r.id,-Number(r.amount),a.currency,randomUUID(),Number(r.amount)]);
}
// Persist each cross-service checkpoint. Both remote operations are idempotent,
// including recovery after a successful remote commit but a lost local response.
async function reconcile(id){
  return tx(async c=>{
    let a=(await c.query('SELECT * FROM attempts WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!a)fail(404,'Payment attempt not found');
    if(a.synchronized)return view(a);
    if(a.provider!==provider.name)fail(409,'Restore the original provider to finish this payment');
    if(!a.reserved){
      try{await updateOrder(a,'reserve');}
      catch(e){if(e.status!==409&&e.status!==404)throw e;
        a=(await c.query("UPDATE attempts SET status='FAILED', synchronized=true WHERE id=$1 RETURNING *",[id])).rows[0];return view(a);}
      await c.query('UPDATE attempts SET reserved=true WHERE id=$1',[id]);a.reserved=true;
    }
    if(!a.reference){
      a.reference=await provider.create(a);
      await c.query('UPDATE attempts SET reference=$2 WHERE id=$1',[id,a.reference]);
    }
    const record=await provider.retrieve(a.reference);
    if(!record||record.attempt!==a.id||record.amount!==a.amount||record.currency!==a.currency)fail(503,'Provider record mismatch');
    if(record.state!=='PENDING'){
      a.status=record.state;
      await updateOrder(a,'settle');
      a=(await c.query('UPDATE attempts SET status=$2,synchronized=true WHERE id=$1 RETURNING *',[id,a.status])).rows[0];
      if(a.status==='SUCCEEDED')await ledgerCapture(c,a);
    }
    return {...view(a),checkoutUrl:record.state==='PENDING'?record.url:null};
  });
}
async function administrator(req){
  const auth=req.headers.authorization;if(!auth?.startsWith('Bearer '))fail(401,'Sign in required');
  const person=await remote(env.IDENTITY_URL+'/me',auth);
  if(person.role!=='ADMIN')fail(403,'Admin required');return person;
}
async function refundAttempt(id,adminId,reason){
  const prior=(await pool.query('SELECT * FROM refunds WHERE attempt_id=$1',[id])).rows[0];if(prior)return prior;
  const a=(await pool.query('SELECT * FROM attempts WHERE id=$1',[id])).rows[0];
  if(!a||a.status!=='SUCCEEDED'||!a.synchronized)fail(409,'Only a captured payment can be refunded');
  if(a.provider!==provider.name)fail(409,'Restore the original payment provider before refunding');
  const refundId=a.id;
  await remote(env.ORDERS_URL+'/internal/orders/'+a.order_id+'/payment/refund/reserve','Bearer '+env.PAYMENTS_ORDER_TOKEN,
    {attempt:a.id,refundId,amount:Number(a.amount),currency:a.currency});
  try{
    return (await pool.query("INSERT INTO refunds(id,attempt_id,amount,reason,admin_id,status) VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT(attempt_id) DO UPDATE SET attempt_id=excluded.attempt_id RETURNING *",
      [refundId,a.id,a.amount,reason,adminId])).rows[0];
  }catch(e){throw e;}
}
async function processRefund(r){
  const a=(await pool.query('SELECT * FROM attempts WHERE id=$1',[r.attempt_id])).rows[0];if(!a)throw Error('Payment unavailable');
  const providerRefund=await provider.refund(a.reference,Number(r.amount),r.id);
  if(providerRefund.status&&providerRefund.status.toUpperCase()!=='SUCCEEDED')throw Object.assign(new Error('Provider refund is not confirmed'),{status:503});
  await remote(env.ORDERS_URL+'/internal/orders/'+a.order_id+'/payment/refund/settle','Bearer '+env.PAYMENTS_ORDER_TOKEN,
    {attempt:a.id,refundId:r.id,amount:Number(r.amount),currency:a.currency});
  await tx(async c=>{
    const current=(await c.query('SELECT * FROM refunds WHERE id=$1 FOR UPDATE',[r.id])).rows[0];
    if(current.status==='SUCCEEDED')return;
    const done=(await c.query("UPDATE refunds SET status='SUCCEEDED',provider_reference=$2,last_error=NULL,updated_at=now() WHERE id=$1 RETURNING *",[r.id,providerRefund.id??null])).rows[0];
    await ledgerRefund(c,done,a);
  });
}
async function adminRoute(req,path){
  const admin=await administrator(req);
  if(path.startsWith('/admin/payments/settlements'))return settlements({req,path,admin,pool,tx,remote,parse,rawBody,fail,env});
  if(path==='/admin/payments'&&req.method==='GET'){
    const q=(new URL(req.url,'http://local').searchParams.get('q')??'').trim().slice(0,100);
    return (await pool.query(`SELECT a.id,a.order_id,a.provider,a.reference,a.amount,a.currency,a.status,a.created_at,
      r.id AS refund_id,r.status AS refund_status,r.reason AS refund_reason,r.last_error AS refund_error,r.created_at AS refund_created_at
      FROM attempts a LEFT JOIN refunds r ON r.attempt_id=a.id
      WHERE $1='' OR a.id::text ILIKE $2 OR a.order_id::text ILIKE $2 ORDER BY a.created_at DESC LIMIT 200`,[q,'%'+q+'%'])).rows;
  }
  if(path==='/admin/ledger'&&req.method==='GET'){
    const rows=(await pool.query('SELECT id,journal_id,order_id,attempt_id,refund_id,account,amount,currency,created_at FROM ledger_entries ORDER BY created_at DESC,id DESC LIMIT 2000')).rows;
    const total=Number((await pool.query('SELECT COALESCE(sum(amount),0) AS total FROM ledger_entries')).rows[0].total);
    return {entries:rows,balanced:total===0,settlementReady:false,settlementNote:'Use Settlements to allocate completed local test orders and record simulated payouts. Production payout rules remain unconfigured.'};
  }
  if(path==='/admin/reconciliation'&&req.method==='GET'){
    if(provider.name!=='local-test')fail(409,'Automated provider comparison is available only for the local simulator');
    const day=(new URL(req.url,'http://local').searchParams.get('day')??new Date().toISOString().slice(0,10));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||Number.isNaN(Date.parse(day+'T00:00:00Z')))fail(400,'Use a UTC date in YYYY-MM-DD format');
    const start=day+'T00:00:00Z',end=new Date(Date.parse(start)+86400000).toISOString();
    const sum=async(sql,p)=>Number((await pool.query(sql,p)).rows[0]?.amount??0);
    const [captured,refunded,ledgerCaptureTotal,ledgerRefundTotal,providerCapture,providerRefund]=await Promise.all([
      sum("SELECT COALESCE(sum(amount),0) amount FROM attempts WHERE status='SUCCEEDED' AND created_at>=$1 AND created_at<$2",[start,end]),
      sum("SELECT COALESCE(sum(amount),0) amount FROM refunds WHERE status='SUCCEEDED' AND updated_at>=$1 AND updated_at<$2",[start,end]),
      sum("SELECT COALESCE(sum(amount),0) amount FROM ledger_entries WHERE refund_id IS NULL AND account='PROCESSOR_CLEARING' AND amount>0 AND created_at>=$1 AND created_at<$2",[start,end]),
      sum("SELECT COALESCE(-sum(amount),0) amount FROM ledger_entries WHERE refund_id IS NOT NULL AND account='PROCESSOR_CLEARING' AND amount<0 AND created_at>=$1 AND created_at<$2",[start,end]),
      sum("SELECT COALESCE(sum(amount),0) amount FROM sandbox_ledger WHERE state IN ('SUCCEEDED','REFUNDED') AND created_at>=$1 AND created_at<$2",[start,end]),
      sum("SELECT COALESCE(sum(amount),0) amount FROM sandbox_refunds WHERE state='SUCCEEDED' AND created_at>=$1 AND created_at<$2",[start,end])
    ]);
    return {day,currency:'INR',provider:'local-test',captured,refunded,ledgerCaptured:ledgerCaptureTotal,ledgerRefunded:ledgerRefundTotal,providerCaptured:providerCapture,providerRefunded:providerRefund,
      differences:{paymentsVsLedgerCapture:captured-ledgerCaptureTotal,paymentsVsProviderCapture:captured-providerCapture,refundsVsLedger:refunded-ledgerRefundTotal,refundsVsProvider:refunded-providerRefund},settlementReady:false};
  }
  const match=path.match(/^\/admin\/payments\/([a-f0-9-]{36})\/refund$/);
  if(match&&req.method==='POST'){
    const b=parse(await rawBody(req));if(typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>500)fail(400,'A support reason (10–500 characters) is required');
    const r=await refundAttempt(match[1],admin.id,b.reason.trim());return {id:r.id,attemptId:r.attempt_id,amountMinor:Number(r.amount),currency:'INR',status:r.status,reason:r.reason};
  }
  fail(404,'Unknown admin payment route');
}
async function webhook(raw,headers){
  let event;
  if(provider.name==='stripe-test'){
    event=provider.verifyEvent(headers,raw);
    if(!event)fail(403,'Invalid webhook signature');
    if(event.ignored)return {ok:true};
  }else{
    const time=headers['x-event-time'],sig=headers['x-event-signature'];
  if(!provider.verify(time,raw,sig))fail(403,'Invalid webhook signature');
  event=parse(raw);
  if(!validId(event.eventId)||!validId(event.reference))fail(400,'Invalid webhook');
  }
  const a=(await pool.query('SELECT id FROM attempts WHERE reference=$1',[event.reference])).rows[0];
  if(!a)fail(404,'Unknown reference');
  // An event is a notification; only the authoritative provider record supplies state.
  if(!(await pool.query('SELECT 1 FROM provider_events WHERE provider=$1 AND event_id=$2',[provider.name,event.eventId])).rowCount){
    await reconcile(a.id);
    await pool.query('INSERT INTO provider_events(provider,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[provider.name,event.eventId]);
  }
  return {ok:true};
}
async function route(req){
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health'){await pool.query('SELECT 1');return {ok:true};}
  if(path==='/payments/webhook'&&req.method==='POST')return webhook(await rawBody(req),req.headers);
  if(path.startsWith('/admin/'))return adminRoute(req,path);
  const auth=req.headers.authorization;
  if(!auth?.startsWith('Bearer '))fail(401,'Sign in first');
  const owner=await remote(env.IDENTITY_URL+'/me',auth);
  if(owner.role!=='CUSTOMER')fail(403,'Customer account required');
  if(path==='/payments'&&req.method==='POST'){
    const b=parse(await rawBody(req));
    if(!validId(b?.orderId)||Object.keys(b).length!==1)fail(400,'An order reference is required');
    const order=await remote(env.ORDERS_URL+'/orders/'+b.orderId,auth);
    const id=await tx(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[b.orderId]);
      const prior=(await c.query("SELECT id FROM attempts WHERE order_id=$1 AND (status IN ('PENDING','SUCCEEDED') OR NOT synchronized)",[b.orderId])).rows[0];
      if(prior)return prior.id;
      if(order.order_state!=='PLACED'||order.payment_state!=='UNPAID')fail(409,'Order is not payable');
      const id=randomUUID();
      await c.query('INSERT INTO attempts(id,order_id,owner_id,amount,currency,provider) VALUES($1,$2,$3,$4,$5,$6)',[id,b.orderId,owner.id,order.quote.totalMinor,order.quote.currency,provider.name]);
      return id;
    });
    return reconcile(id);
  }
  const m=path.match(/^\/payments\/([^/]+)(\/confirm)?$/);
  if(!m||!validId(m[1]))fail(404,'Not found');
  const a=(await pool.query('SELECT * FROM attempts WHERE id=$1 AND owner_id=$2',[m[1],owner.id])).rows[0];
  if(!a)fail(404,'Payment not found');
  if(!m[2]&&req.method==='GET')return reconcile(a.id);
  if(!m[2]||req.method!=='POST')fail(405,'Method unavailable');
  const b=parse(await rawBody(req));
  if(!a.reference)fail(409,'Payment is being prepared');
  if(provider.name!=='local-test'||a.provider!==provider.name)fail(405,'Use hosted checkout');
  const event=await provider.confirm(a.reference,b?.methodToken);
  const raw=Buffer.from(JSON.stringify(event)),time=String(Math.floor(Date.now()/1000));
  // Local provider posts through the same HTTP boundary as a hosted provider.
  const response=await fetch('http://127.0.0.1:3003/payments/webhook',{method:'POST',headers:{'x-event-time':time,'x-event-signature':provider.signature(time,raw)},body:raw,signal:AbortSignal.timeout(5000)});
  if(!response.ok)fail(503,'Checking the payment outcome');
  return reconcile(a.id);
}
await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
await provider.initialize();
http.createServer(async(req,res)=>{
  try{const value=await route(req);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
  catch(e){res.writeHead(e.status??503,{'content-type':'application/json'});res.end(JSON.stringify({message:e.status?e.message:'Checking payment status. Please retry.'}));}
}).listen(3003,'0.0.0.0');
async function sweep(){
  try{const rows=await pool.query('SELECT id FROM attempts WHERE NOT synchronized ORDER BY last_checked NULLS FIRST LIMIT 50');
    for(const a of rows.rows){try{await reconcile(a.id);}catch{console.error('Payment reconciliation deferred');}finally{await pool.query('UPDATE attempts SET last_checked=now() WHERE id=$1',[a.id]);}}
    const refunds=await pool.query("SELECT * FROM refunds WHERE status='PENDING' ORDER BY created_at LIMIT 20");
    for(const r of refunds.rows){try{await processRefund(r);}catch(e){await pool.query("UPDATE refunds SET last_error=$2,updated_at=now() WHERE id=$1 AND status='PENDING'",[r.id,e.status===409?'Provider or order is not eligible for this refund':'Refund processing deferred; automatic retry is scheduled']);}}
  }catch{console.error('Payment sweep deferred');}
  setTimeout(sweep,10000).unref();
}
sweep();

