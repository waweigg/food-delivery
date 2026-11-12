import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
// A development-only provider simulator with an independent source of truth.
// Only synthetic method tokens are accepted. There is no processor or card network.
const outcomes=new Map([['test_approve','SUCCEEDED'],['test_decline','FAILED'],['test_abandon','ABANDONED']]);
export class LocalProvider {
  name='local-test';
  constructor(pool,key){this.pool=pool;this.key=key;}
  async initialize(){
    await this.pool.query(`CREATE TABLE IF NOT EXISTS sandbox_ledger(
      reference uuid PRIMARY KEY, attempt uuid NOT NULL UNIQUE, amount bigint NOT NULL, currency text NOT NULL,
      state text NOT NULL DEFAULT 'PENDING', expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes')`);
  }
  async create(a){
    const r=await this.pool.query('INSERT INTO sandbox_ledger(reference,attempt,amount,currency) VALUES($1,$2,$3,$4) ON CONFLICT(attempt) DO UPDATE SET attempt=excluded.attempt RETURNING reference',[randomUUID(),a.id,a.amount,a.currency]);
    return r.rows[0].reference;
  }
  async retrieve(ref){
    await this.pool.query("UPDATE sandbox_ledger SET state='ABANDONED' WHERE reference=$1 AND state='PENDING' AND expires_at<=now()",[ref]);
    return (await this.pool.query('SELECT * FROM sandbox_ledger WHERE reference=$1',[ref])).rows[0];
  }
  async confirm(ref,token){
    if(!outcomes.has(token))throw Object.assign(new Error('Unknown test method'),{status:400});
    await this.retrieve(ref);
    await this.pool.query("UPDATE sandbox_ledger SET state=$2 WHERE reference=$1 AND state='PENDING'",[ref,outcomes.get(token)]);
    return {eventId:randomUUID(),reference:ref};
  }
  signature(time,raw){return createHmac('sha256',this.key).update(time+'.').update(raw).digest('hex');}
  verify(time,raw,sig){
    if(!/^\d{10}$/.test(time??'')||Math.abs(Date.now()/1000-Number(time))>300||!/^[0-9a-f]{64}$/.test(sig??''))return false;
    return timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(this.signature(time,raw),'hex'));
  }
}

export class StripeTestProvider {
  name='stripe-test';
  constructor(secret,webhookSecret,returnUrl){
    if(!secret?.startsWith('sk_test_')||!webhookSecret?.startsWith('whsec_')||new URL(returnUrl).protocol!=='https:')throw new Error('Stripe test credentials and HTTPS return URL required.');
    this.secret=secret;this.key=webhookSecret;this.returnUrl=returnUrl;
  }
  async initialize(){}
  async api(path,params,key){
    const r=await fetch('https://api.stripe.com/v1/checkout/sessions'+path,{
      method:params?'POST':'GET',headers:{authorization:'Bearer '+this.secret,...(key?{'Idempotency-Key':key}:{})},
      body:params,redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error('Stripe test provider unavailable');
    const session=await r.json();
    if(session.livemode!==false)throw new Error('Expected Stripe test session');
    return session;
  }
  async create(a){
    if(Date.now()-new Date(a.created_at).getTime()>23*3600000)throw new Error('Manual provider lookup required before retry');
    const p=new URLSearchParams({mode:'payment',success_url:this.returnUrl,cancel_url:this.returnUrl,'payment_method_types[0]':'card',
      'line_items[0][price_data][currency]':'inr','line_items[0][price_data][product_data][name]':'waweigg test order',
      'line_items[0][price_data][unit_amount]':String(a.amount),'line_items[0][quantity]':'1',
      'metadata[attempt]':a.id,client_reference_id:a.order_id});
    return (await this.api('',p,a.id)).id;
  }
  async retrieve(ref){
    if(!/^cs_test_[A-Za-z0-9]+$/.test(ref))throw new Error('Invalid Stripe test session');
    const s=await this.api('/'+ref);
    return {attempt:s.metadata?.attempt,amount:String(s.amount_total),currency:s.currency?.toUpperCase(),
      state:s.payment_status==='paid'?'SUCCEEDED':s.status==='expired'?'ABANDONED':'PENDING',url:s.url};
  }
  verifyEvent(headers,raw){
    const parts=(headers['stripe-signature']??'').split(',');
    const time=parts.find(x=>x.startsWith('t='))?.slice(2);
    if(!/^\d{10}$/.test(time??'')||Math.abs(Date.now()/1000-Number(time))>300)return null;
    const expected=createHmac('sha256',this.key).update(time+'.').update(raw).digest();
    if(!parts.some(p=>/^v1=[a-f0-9]{64}$/.test(p)&&timingSafeEqual(expected,Buffer.from(p.slice(3),'hex'))))return null;
    const event=JSON.parse(raw);
    if(event.livemode!==false||!['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(event.type))return {ignored:true};
    return {eventId:event.id,reference:event.data.object.id};
  }
}
