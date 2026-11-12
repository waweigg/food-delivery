require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused';
process.env.APP_ENV='test';
process.env.BETTER_AUTH_SECRET='test-only-secret-at-least-thirty-two-characters';
process.env.BETTER_AUTH_URL='http://localhost:3000';
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('../dist/app.module.js');
test('HTTP liveness works, missing database fails readiness safely, ordering is disabled',async()=>{
 const app=await NestFactory.create(AppModule,{logger:false});
 try {
  await app.listen(0,'127.0.0.1');
  const url=await app.getUrl();
  assert.deepEqual(await (await fetch(url+'/health/live')).json(),{status:'ok'});
  const ready=await fetch(url+'/health/ready');
  assert.equal(ready.status,503);
  assert.ok(!(await ready.text()).includes('postgresql'));
  assert.deepEqual(await (await fetch(url+'/config')).json(),{orderingEnabled:false,maintenance:true});
  assert.equal((await fetch(url+'/orders',{method:'POST'})).status,404);
 } finally { await app.close(); }
});
