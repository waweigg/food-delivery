export async function settlements({req,path,admin,pool,tx,remote,parse,rawBody,fail,env}){
 if(env.APP_ENV!=='development'||env.PAYMENT_PROVIDER!=='local-test')fail(403,'Local simulator only');
 if(req.method==='GET')return {settlements:(await pool.query('SELECT * FROM settlements ORDER BY created_at DESC LIMIT 500')).rows,payouts:(await pool.query('SELECT * FROM test_payouts ORDER BY created_at DESC LIMIT 1000')).rows};
 const m=path.match(/^\/admin\/payments\/settlements\/([a-f0-9-]{36})(\/payout)?$/);
 if(!m||req.method!=='POST')fail(404,'Unknown settlement route');
 const b=parse(await rawBody(req));
 if(typeof b.reason!=='string'||b.reason.trim().length<10||b.reason.length>500)fail(400,'Enter a reason of 10–500 characters');
 return tx(async c=>{
 const a=(await c.query('SELECT * FROM attempts WHERE id=$1 FOR UPDATE',[m[1]])).rows[0];
 if(!a||a.provider!=='local-test'||a.status!=='SUCCEEDED'||!a.synchronized)fail(409,'Confirmed simulator capture required');
 if((await c.query('SELECT 1 FROM refunds WHERE attempt_id=$1',[a.id])).rowCount)fail(409,'Refund exists');
 const old=(await c.query('SELECT * FROM settlements WHERE attempt_id=$1',[a.id])).rows[0];
 if(m[2]){
 if(!old||!['restaurant','driver'].includes(b.beneficiary)||typeof b.reference!=='string'||!/^TEST-[A-Za-z0-9-]{8,100}$/.test(b.reference))fail(400,'Settlement, beneficiary and unique TEST- reference required');
 const prior=(await c.query('SELECT * FROM test_payouts WHERE attempt_id=$1 AND beneficiary=$2',[a.id,b.beneficiary])).rows[0];
 if(prior){if(prior.reference!==b.reference)fail(409,'Payout already recorded');return prior;}
 const amount=old[b.beneficiary+'_minor'];if(Number(amount)<=0)fail(409,'No amount due');
 if((await c.query('SELECT 1 FROM test_payouts WHERE reference=$1',[b.reference])).rowCount)fail(409,'Reference already used');
 return (await c.query('INSERT INTO test_payouts(attempt_id,beneficiary,reference,actor,reason,amount) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[a.id,b.beneficiary,b.reference,admin.id,b.reason.trim(),amount])).rows[0];
 }
 const values=[b.restaurantMinor,b.driverMinor,b.platformMinor];
 if(values.some(n=>!Number.isSafeInteger(n)||n<0)||values.reduce((s,n)=>s+n,0)!==Number(a.amount))fail(400,'Integer paise allocations must equal the capture');
 if(old){if(values.some((n,i)=>n!==Number(old[['restaurant_minor','driver_minor','platform_minor'][i]])))fail(409,'Allocation already finalized');return old;}
 const order=await remote(env.ORDERS_URL+'/orders/admin/'+a.order_id,req.headers.authorization);
 if(order.delivery_state!=='DELIVERED'||order.payment_state!=='PAID'||!order.driver_id)fail(409,'Paid, completed delivery required');
 return (await c.query('INSERT INTO settlements(attempt_id,restaurant_id,driver_id,restaurant_minor,driver_minor,platform_minor,actor,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[a.id,order.restaurant_id,order.driver_id,...values,admin.id,b.reason.trim()])).rows[0];
 });
}
