import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createApplication as identityApp} from '../../api/dist/bootstrap.js';
import {Database as IdentityDatabase} from '../../api/dist/database.js';
import {createApplication} from '../dist/bootstrap.js';
import {Database} from '../dist/database.js';

async function databaseFor(path){
  const db=await PGlite.create();
  for(const name of (await readdir(path)).filter(n=>/^\d/.test(n)).sort())await db.exec(await readFile(new URL(`${name}/migration.sql`,path),'utf8'));
  const socket=new PGLiteSocketServer({db,port:0,host:'127.0.0.1',maxConnections:10});await socket.start();
  return {db,socket,url:`postgresql://postgres:postgres@${socket.getServerConn()}/postgres`};
}
test('Day 3 integrates two services with separate SQL databases and real authentication',{timeout:120000},async t=>{
  const identityStore=await databaseFor(new URL('../../api/prisma/migrations/',import.meta.url));
  const restaurantStore=await databaseFor(new URL('../prisma/migrations/',import.meta.url));
  process.env.APP_ENV='test';process.env.DATABASE_URL=identityStore.url;
  process.env.BETTER_AUTH_SECRET=randomBytes(48).toString('hex');process.env.BETTER_AUTH_URL='http://localhost:3000';
  process.env.RESTAURANT_DATABASE_URL=restaurantStore.url;process.env.RESTAURANT_SERVICE_TOKEN=randomBytes(48).toString('hex');
  await identityStore.db.query('INSERT INTO "EnvironmentIdentity" (id,name) VALUES ($1,$2)',['singleton','test']);
  await restaurantStore.db.query('INSERT INTO "ServiceIdentity" (id,environment,service) VALUES ($1,$2,$3)',['singleton','test','restaurants']);
  let identity,restaurants;
  try{
    identity=await identityApp();await identity.listen(0,'127.0.0.1');process.env.IDENTITY_URL=await identity.getUrl();
    restaurants=await createApplication();await restaurants.listen(0,'127.0.0.1');const base=await restaurants.getUrl();
    const identityDb=identity.get(IdentityDatabase),db=restaurants.get(Database);
    const call=async(path,body,token,headers={})=>{
      const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status,data:await response.json()};
    };
    const account=async(name,role='CUSTOMER')=>{
      await identityDb.rateLimit.deleteMany();
      const response=await fetch(`${process.env.IDENTITY_URL}/api/auth/sign-up/email`,{method:'POST',headers:{Origin:process.env.BETTER_AUTH_URL,'Content-Type':'application/json'},body:JSON.stringify({name,email:`${name}@example.test`,password:'Day-three-test-password-123!'})});
      assert.equal(response.status,200);const data=await response.json();
      if(role!=='CUSTOMER')await identityDb.user.update({where:{id:data.user.id},data:{role}});
      return {id:data.user.id,token:response.headers.get('set-auth-token')};
    };
    const alice=await account('alice'),bob=await account('bob'),admin=await account('reviewer','ADMIN');
    const input={name:'Fixture Restaurant',address:'Test pickup address',latitude:25,longitude:51,timezone:'UTC',hours:Array.from({length:7},(_,day)=>({day,open:0,close:1440})),active:true,temporaryClosedUntil:null};
    let record;
    const eligible=()=>call(`/internal/restaurants/${record.id}/order-eligibility`,undefined,undefined,{'x-service-token':process.env.RESTAURANT_SERVICE_TOKEN});
    await t.test('submission atomically creates local membership and remains private',async()=>{
      assert.equal((await call('/restaurants-health/ready')).status,200);
      assert.equal((await call('/restaurant-onboarding',input)).status,401);
      const result=await call('/restaurant-onboarding',input,alice.token);assert.equal(result.status,201);record=result.data;
      assert.equal(record.status,'PENDING');assert.equal((await call('/catalog/restaurants')).data.length,0);
      assert.equal((await eligible()).data.eligible,false);
      assert.equal((await call('/restaurant-onboarding/mine',undefined,alice.token)).data.length,1);
      assert.equal((await call('/restaurant-onboarding/mine',undefined,bob.token)).data.length,0);
      assert.equal(await identityDb.restaurant.count(),0,'Restaurant service never writes identity tables');
      assert.equal(await db.restaurantMember.count({where:{restaurantId:record.id,userId:alice.id}}),1);
      assert.equal((await identityDb.user.findUnique({where:{id:alice.id}})).role,'CUSTOMER');
    });
    await t.test('non-members cannot view/edit; clients cannot approve themselves',async()=>{
      assert.equal((await call(`/restaurant-onboarding/${record.id}`,undefined,bob.token)).status,404);
      assert.equal((await call(`/restaurant-onboarding/${record.id}/profile`,{...input,version:record.version},bob.token)).status,404);
      assert.equal((await call(`/restaurant-onboarding/${record.id}/profile`,{...input,version:record.version,status:'APPROVED'},alice.token)).status,400);
      assert.equal((await call(`/admin/restaurants/${record.id}/decision`,{status:'APPROVED',reason:'Fake',version:record.version},alice.token)).status,403);
      assert.equal((await call(`/internal/restaurants/${record.id}/order-eligibility`)).status,403);
    });
    await t.test('approval publishes only public fields and permits restaurant eligibility',async()=>{
      const result=await call(`/admin/restaurants/${record.id}/decision`,{status:'APPROVED',reason:'Fixture pickup verified',version:record.version},admin.token);assert.equal(result.status,201);record=result.data;
      const catalog=(await call('/catalog/restaurants')).data;assert.equal(catalog.length,1);assert.equal(catalog[0].isOpen,true);
      for(const field of ['members','approvals','actorId','createdAt','updatedAt','version','status'])assert.equal(field in catalog[0],false);
      assert.equal(catalog[0].orderingEnabled,false);assert.equal((await eligible()).data.eligible,true);
      assert.equal((await call(`/admin/restaurants/${record.id}`,undefined,admin.token)).data.approvals.length,2);
    });
    await t.test('hours/temporary closure and inactive status immediately gate eligibility',async()=>{
      record=(await call(`/restaurant-onboarding/${record.id}/profile`,{...input,version:record.version,temporaryClosedUntil:'2099-01-01T00:00:00Z'},alice.token)).data;
      assert.equal(record.status,'APPROVED');assert.equal((await eligible()).data.reason,'TEMPORARILY_CLOSED');
      assert.equal((await call('/catalog/restaurants')).data[0].isOpen,false);
      record=(await call(`/restaurant-onboarding/${record.id}/profile`,{...input,version:record.version,active:false},alice.token)).data;
      assert.equal((await call('/catalog/restaurants')).data.length,0);assert.equal((await eligible()).data.reason,'INACTIVE');
      record=(await call(`/restaurant-onboarding/${record.id}/profile`,{...input,version:record.version,hours:[]},alice.token)).data;
      assert.equal((await eligible()).data.reason,'OUTSIDE_HOURS');
    });
    await t.test('location edits require reapproval and stale decisions are rejected',async()=>{
      const oldVersion=record.version;
      record=(await call(`/restaurant-onboarding/${record.id}/profile`,{...input,address:'Changed pickup address',version:record.version},alice.token)).data;
      assert.equal(record.status,'PENDING');assert.equal((await eligible()).data.eligible,false);
      assert.equal((await call(`/admin/restaurants/${record.id}/decision`,{status:'APPROVED',reason:'Stale review',version:oldVersion},admin.token)).status,409);
      assert.equal((await call(`/restaurant-onboarding/${record.id}/profile`,{...input,version:oldVersion},alice.token)).status,409);
      record=(await call(`/admin/restaurants/${record.id}/decision`,{status:'APPROVED',reason:'Updated pickup reviewed',version:record.version},admin.token)).data;
    });
    await t.test('suspension is audited, hides listing and cannot be undone by a member',async()=>{
      record=(await call(`/admin/restaurants/${record.id}/decision`,{status:'SUSPENDED',reason:'Fixture review hold',version:record.version},admin.token)).data;
      assert.equal((await call('/catalog/restaurants')).data.length,0);assert.equal((await call(`/catalog/restaurants/${record.id}`)).status,404);
      assert.equal((await eligible()).data.eligible,false);
      record=(await call(`/restaurant-onboarding/${record.id}/profile`,{...input,version:record.version},alice.token)).data;
      assert.equal(record.status,'SUSPENDED');
      const events=await db.approvalEvent.findMany({where:{restaurantId:record.id,action:'SUSPENDED'}});assert.equal(events.length,1);assert.equal(events[0].actorId,admin.id);
    });
    await t.test('competing reviews and edits cannot overwrite each other',async()=>{
      const before=await db.approvalEvent.count({where:{restaurantId:record.id}});
      const results=await Promise.all([
        call(`/restaurant-onboarding/${record.id}/profile`,{...input,name:'Competing edit',version:record.version},alice.token),
        call(`/admin/restaurants/${record.id}/decision`,{status:'APPROVED',reason:'Concurrent review',version:record.version},admin.token),
      ]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      assert.equal(await db.approvalEvent.count({where:{restaurantId:record.id}}),before+1);
      record=(await db.restaurant.findUnique({where:{id:record.id}}));
    });
    await t.test('revoked identities and unavailable identity service fail closed',async()=>{
      await identityDb.session.deleteMany({where:{userId:bob.id}});
      assert.equal((await call('/restaurant-onboarding/mine',undefined,bob.token)).status,401);
      const original=process.env.IDENTITY_URL;process.env.IDENTITY_URL='http://127.0.0.1:1';
      try{assert.equal((await call('/restaurant-onboarding/mine',undefined,alice.token)).status,503);}finally{process.env.IDENTITY_URL=original;}
      assert.equal((await call('/restaurant-onboarding/mine',undefined,undefined,{'x-user-id':alice.id,'x-role':'ADMIN'})).status,401);
    });
  }finally{if(restaurants)await restaurants.close();if(identity)await identity.close();await restaurantStore.socket.stop();await identityStore.socket.stop();await restaurantStore.db.close();await identityStore.db.close();}
});
