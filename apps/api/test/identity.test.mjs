import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import nodemailer from 'nodemailer';
import {createApplication} from '../dist/bootstrap.js';
import {Database} from '../dist/database.js';
import {provision} from '../dist/provision.js';

test('Day 2: real SQL migrations, authentication, tenant boundaries, revocation and recovery', {timeout:120000}, async t=>{
  const pg=await PGlite.create();
  for(const folder of (await readdir(new URL('../prisma/migrations/',import.meta.url))).filter(n=>/^\d/.test(n)).sort()) {
    await pg.exec(await readFile(new URL(`../prisma/migrations/${folder}/migration.sql`,import.meta.url),'utf8'));
  }
  await pg.query('INSERT INTO "EnvironmentIdentity" (id,name) VALUES ($1,$2)',['singleton','test']);
  const server=new PGLiteSocketServer({db:pg,port:0,host:'127.0.0.1',maxConnections:10});
  await server.start();
  process.env.APP_ENV='test';
  process.env.DATABASE_URL=`postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
  process.env.BETTER_AUTH_SECRET=randomBytes(48).toString('hex');
  process.env.BETTER_AUTH_URL='http://127.0.0.1:3000';
  process.env.SMTP_URL='smtp://localhost:2525';
  process.env.MAIL_FROM='test@example.test';
  const messages=[];
  t.mock.method(nodemailer,'createTransport',()=>({sendMail:async mail=>{messages.push(mail);}}));
  let app;
  try {
    app=await createApplication();await app.listen(0,'127.0.0.1');
    const url=await app.getUrl();const database=app.get(Database);
    const request=async(path,body,token,extra={})=>{
      const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:process.env.BETTER_AUTH_URL,...(token?{Authorization:`Bearer ${token}`} : {}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
      const text=await response.text();return {status:response.status,data:text?JSON.parse(text):null,token:response.headers.get('set-auth-token'),headers:response.headers};
    };
    const password='Correct-horse-42-battery!';
    const register=async(name,extra={})=>{
      // Rate limits remain enabled; clear between fixtures only.
      await database.rateLimit.deleteMany();
      const r=await request('/api/auth/sign-up/email',{name,email:`${name}@example.test`,password,...extra});
      assert.equal(r.status,200,JSON.stringify(r.data));return r;
    };
    const login=async name=>{await database.rateLimit.deleteMany();const r=await request('/api/auth/sign-in/email',{email:`${name}@example.test`,password});assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.token);return r;};
    await t.test('migrations and environment identity',async()=>{
      assert.equal((await request('/health/ready')).status,200);
      await database.environmentIdentity.update({where:{id:'singleton'},data:{name:'production'}});
      assert.equal((await request('/health/ready')).status,503);
      await database.environmentIdentity.update({where:{id:'singleton'},data:{name:'test'}});
    });
    const customer=await register('customer',{role:'ADMIN',disabled:false});
    const memberA=await register('membera');const memberB=await register('memberb');
    const driver=await register('driver');const admin=await register('admin');
    const otherDriver=await register('otherdriver');
    const restaurantA=await database.restaurant.create({data:{name:'Restaurant A'}});
    const restaurantB=await database.restaurant.create({data:{name:'Restaurant B'}});
    await provision(database,'membera@example.test','RESTAURANT',restaurantA.id);
    await provision(database,'memberb@example.test','RESTAURANT',restaurantB.id);
    await provision(database,'driver@example.test','DRIVER');
    await provision(database,'otherdriver@example.test','DRIVER');
    await provision(database,'admin@example.test','ADMIN');
    await assert.rejects(provision(database,'customer@example.test','ADMIN'));
    const a=await login('membera'),b=await login('memberb'),d=await login('driver'),ad=await login('admin');
    const driverProfile=await database.driverProfile.findUnique({where:{userId:driver.data.user.id}});
    const otherDriverProfile=await database.driverProfile.findUnique({where:{userId:otherDriver.data.user.id}});
    await t.test('all four roles sign in; clients cannot elevate roles',async()=>{
      for(const [account,role] of [[customer,'CUSTOMER'],[a,'RESTAURANT'],[d,'DRIVER'],[ad,'ADMIN']]) {
        const result=await request('/dashboard',undefined,account.token);assert.equal(result.status,200);assert.equal(result.data.user.role,role);
      }
      assert.equal((await request('/admin/users',undefined,customer.token)).status,403);
      assert.equal((await request(`/restaurants/${restaurantA.id}/private`,undefined,customer.token)).status,403);
      assert.equal((await request('/admin/users')).status,401);
      assert.equal((await request('/admin/users',undefined,'invalid-token')).status,401);
    });
    await t.test('restaurant membership and driver ownership are enforced',async()=>{
      assert.equal((await request(`/restaurants/${restaurantA.id}/private`,undefined,a.token)).status,200);
      assert.equal((await request(`/restaurants/${restaurantB.id}/private`,undefined,a.token)).status,404);
      assert.equal((await request(`/restaurants/${restaurantA.id}/private`,undefined,b.token)).status,404);
      assert.equal((await request(`/drivers/${driverProfile.id}/private`,undefined,d.token)).status,200);
      assert.equal((await request('/drivers/not-owned/private',undefined,d.token)).status,404);
      assert.equal((await request(`/drivers/${otherDriverProfile.id}/private`,undefined,d.token)).status,404);
      await database.driverProfile.update({where:{id:driverProfile.id},data:{approved:false}});
      assert.equal((await request(`/drivers/${driverProfile.id}/private`,undefined,d.token)).status,404);
    });
    await t.test('logout and session expiry immediately reject credentials',async()=>{
      assert.equal((await request('/api/auth/sign-out',{},a.token)).status,200);
      assert.equal((await request('/me',undefined,a.token)).status,401);
      await database.session.updateMany({where:{userId:memberB.data.user.id},data:{expiresAt:new Date(0)}});
      assert.equal((await request('/me',undefined,b.token)).status,401);
    });
    await t.test('administrator changes are audited and revoke access',async()=>{
      assert.equal((await request(`/admin/users/${customer.data.user.id}/disable`,{disabled:true},ad.token)).status,201);
      assert.equal((await request('/me',undefined,customer.token)).status,401);
      await database.rateLimit.deleteMany();
      assert.notEqual((await request('/api/auth/sign-in/email',{email:'customer@example.test',password})).status,200);
      const events=await request('/admin/audit',undefined,ad.token);
      assert.ok(events.data.some(e=>e.action==='USER_DISABLED' && e.actorId===admin.data.user.id));
      assert.equal((await request(`/admin/users/${customer.data.user.id}/disable`,{disabled:false},ad.token)).status,201);
      assert.equal((await request('/api/auth/update-user',{role:'ADMIN'},d.token)).status,400);
      assert.equal((await request('/me',undefined,d.token)).data.role,'DRIVER');
    });
    await t.test('recovery uses a one-time token and revokes existing sessions',async()=>{
      const c=await login('customer');await database.rateLimit.deleteMany();
      const known=await request('/api/auth/request-password-reset',{email:'customer@example.test'});
      const unknown=await request('/api/auth/request-password-reset',{email:'missing@example.test'});
      assert.equal(known.status,200);assert.deepEqual(known.data,unknown.data);assert.equal(messages.length,1);
      const token=messages[0].text.match(/code in the app: (\S+)/)[1];
      const newPassword='New-strong-password-2026!';
      const reset=await request('/api/auth/reset-password',{token,newPassword});assert.equal(reset.status,200,JSON.stringify(reset.data));
      assert.equal((await request('/me',undefined,c.token)).status,401);
      assert.notEqual((await request('/api/auth/reset-password',{token,newPassword})).status,200);
      await database.rateLimit.deleteMany();
      assert.notEqual((await request('/api/auth/sign-in/email',{email:'customer@example.test',password})).status,200);
      assert.equal((await request('/api/auth/sign-in/email',{email:'customer@example.test',password:newPassword})).status,200);
      await database.rateLimit.deleteMany();
      await request('/api/auth/request-password-reset',{email:'customer@example.test'});
      const expiredToken=messages.at(-1).text.match(/code in the app: (\S+)/)[1];
      await database.verification.updateMany({data:{expiresAt:new Date(0)}});
      assert.notEqual((await request('/api/auth/reset-password',{token:expiredToken,newPassword:password})).status,200);
    });
    await t.test('login rate limits ignore spoofed forwarded addresses',async()=>{
      await database.rateLimit.deleteMany();let result;
      for(let i=0;i<6;i++) result=await request('/api/auth/sign-in/email',{email:'missing@example.test',password},undefined, {'X-Forwarded-For':`10.0.0.${i+1}`});
      assert.equal(result.status,429);
    });
    await t.test('untrusted cookie origins are rejected',async()=>{
      await database.rateLimit.deleteMany();
      const r=await request('/api/auth/sign-out',{},undefined,{Origin:'https://evil.example',Cookie:'better-auth.session_token=untrusted'});
      assert.equal(r.status,403);
    });
  } finally { if(app) await app.close();await server.stop();await pg.close(); }
});
