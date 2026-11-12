import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import S3rver from 's3rver';
import sharp from 'sharp';
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
test('Day 4 menu isolation, archival and S3 photo integration',{timeout:120000},async t=>{
  const identityStore=await databaseFor(new URL('../../api/prisma/migrations/',import.meta.url));
  const restaurantStore=await databaseFor(new URL('../prisma/migrations/',import.meta.url));
  const directory=await mkdtemp(join(tmpdir(),'menu-s3-test-'));
  const s3=new S3rver({port:0,address:'127.0.0.1',silent:true,directory,configureBuckets:[{name:'menus'}]});
  const address=await s3.run();
  Object.assign(process.env,{APP_ENV:'test',DATABASE_URL:identityStore.url,BETTER_AUTH_SECRET:randomBytes(48).toString('hex'),BETTER_AUTH_URL:'http://localhost:3000',RESTAURANT_DATABASE_URL:restaurantStore.url,RESTAURANT_SERVICE_TOKEN:randomBytes(48).toString('hex'),MENU_CURRENCY:'INR',MENU_S3_ENDPOINT:`http://127.0.0.1:${address.port}`,MENU_S3_BUCKET:'menus',MENU_S3_ACCESS_KEY:'S3RVER',MENU_S3_SECRET_KEY:'S3RVER'});
  await identityStore.db.query('INSERT INTO "EnvironmentIdentity" (id,name) VALUES ($1,$2)',['singleton','test']);
  await restaurantStore.db.query('INSERT INTO "ServiceIdentity" (id,environment,service) VALUES ($1,$2,$3)',['singleton','test','restaurants']);
  let identity,restaurants;
  try{
    identity=await identityApp();await identity.listen(0,'127.0.0.1');process.env.IDENTITY_URL=await identity.getUrl();
    restaurants=await createApplication();await restaurants.listen(0,'127.0.0.1');const base=await restaurants.getUrl();
    const identityDb=identity.get(IdentityDatabase),db=restaurants.get(Database);
    const call=async(path,body,token)=>{
      const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
      return {status:response.status,data:response.headers.get('content-type')?.includes('image/')?Buffer.from(await response.arrayBuffer()):await response.json()};
    };
    const account=async name=>{
      await identityDb.rateLimit.deleteMany();
      const response=await fetch(`${process.env.IDENTITY_URL}/api/auth/sign-up/email`,{method:'POST',headers:{Origin:process.env.BETTER_AUTH_URL,'Content-Type':'application/json'},body:JSON.stringify({name,email:`${name}@example.test`,password:'Day-four-test-password-123!'})});assert.equal(response.status,200);
      return {id:(await response.json()).user.id,token:response.headers.get('set-auth-token')};
    };
    const alice=await account('alice'),bob=await account('bob');
    const profile={name:'Test only',address:'Fixture address',latitude:0,longitude:0,timezone:'UTC',hours:[],active:true,temporaryClosedUntil:null};
    const a=(await call('/restaurant-onboarding',profile,alice.token)).data;
    const b=(await call('/restaurant-onboarding',profile,bob.token)).data;
    const path=`/restaurant-onboarding/${a.id}/menu`,publicPath=`/catalog/restaurants/${a.id}/menu`;
    let menu,category,second,item,photo;
    const refresh=async()=>menu=(await call(path,undefined,alice.token)).data;
    const write=(suffix,body={})=>call(path+suffix,{menuVersion:menu.menuVersion,...body},alice.token);
    await t.test('owners create and order categories; foreign callers and stale saves fail',async()=>{
      assert.equal((await call(path)).status,401);assert.equal((await call(path,undefined,bob.token)).status,404);
      await refresh();assert.equal((await write('/categories',{name:'Mains'})).status,201);await refresh();category=menu.categories[0].id;
      assert.equal((await write('/categories',{name:'Drinks'})).status,201);await refresh();second=menu.categories[1].id;
      const v=menu.menuVersion;
      assert.equal((await write('/categories/reorder',{ids:[second,category]})).status,201);
      assert.equal((await call(path+'/categories',{name:'Stale',menuVersion:v},alice.token)).status,409);
      await refresh();assert.equal(menu.categories[0].id,second);
      assert.equal((await write('/categories/reorder',{ids:[category,category]})).status,400);
      assert.equal((await write('/categories/reorder',{ids:[category]})).status,400);
      assert.equal((await call(path+'/categories',{name:'Intruder',menuVersion:menu.menuVersion},bob.token)).status,404);
    });
    await t.test('integer INR prices and restaurant-scoped category references are enforced',async()=>{
      const data={categoryId:category,name:'Fixture meal',description:'Test description',priceMinor:12345,currency:'INR',available:true,photoId:null};
      for(const priceMinor of [-1,0,1.25,2147483648,'100'])assert.equal((await write('/items',{...data,priceMinor})).status,400);
      assert.equal((await write('/items',{...data,currency:'USD'})).status,400);
      assert.equal((await write('/items',{...data,categoryId:'foreign'})).status,400);
      assert.equal((await write('/items',data)).status,201);await refresh();item=menu.categories.find(c=>c.id===category).items[0];assert.equal(item.priceMinor,12345);
      assert.equal((await call(publicPath)).status,404);
      await db.restaurant.update({where:{id:a.id},data:{status:'APPROVED'}});
      assert.equal((await call(publicPath)).data.categories.find(c=>c.id===category).items.length,1);
    });
    await t.test('delivery quote uses current menu prices, opening hours and radius',async()=>{
      const quotePath='/catalog/restaurants/'+a.id+'/quote';
      const address={street:'12 Test Road',phone:'+91 9876543210',latitude:0,longitude:0,instructions:''};
      const basket={address,currency:'INR',items:[{itemId:item.id,quantity:2}]};
      assert.equal((await call(quotePath,basket)).status,422);
      await db.restaurant.update({where:{id:a.id},data:{hours:Array.from({length:7},(_,day)=>({day,open:0,close:1440}))}});
      const response=await call(quotePath,basket);
      assert.equal(response.status,201);
      assert.deepEqual([response.data.subtotalMinor,response.data.deliveryMinor,response.data.otherMinor,response.data.totalMinor],[24690,3000,0,27690]);
      for(const [patch,status] of [
        [{items:[{itemId:item.id,quantity:2,priceMinor:1}]},400],
        [{items:[{itemId:item.id,quantity:100}]},400],
        [{items:[...basket.items,...basket.items]},400],
        [{currency:'USD'},422],[{items:[{itemId:'unknown',quantity:1}]},422],
        [{address:{...address,latitude:.05}},422],[{address:{...address,longitude:181}},400],
      ])assert.equal((await call(quotePath,{...basket,...patch})).status,status);
      await db.menuItem.update({where:{id:item.id},data:{available:false}});
      assert.equal((await call(quotePath,basket)).status,422);
      await db.menuItem.update({where:{id:item.id},data:{available:true}});
    });
    await t.test('uploads validate decoded content, size and ownership; private photos remain private',async()=>{
      const valid=await sharp({create:{width:40,height:30,channels:3,background:'#2484cc'}}).png().toBuffer();
      assert.equal((await call(path+'/photos',valid,bob.token)).status,404);
      for(const invalid of [Buffer.from('<svg></svg>'),Buffer.from([137,80,78,71,13,10,26,10])])assert.equal((await call(path+'/photos',invalid,alice.token)).status,400);
      assert.equal((await call(path+'/photos',Buffer.alloc(5*1024*1024+1),alice.token)).status,413);
      const result=await call(path+'/photos',valid,alice.token);assert.equal(result.status,201);photo=result.data;
      const saved=await call(photo.photoUrl,undefined,alice.token);assert.equal(saved.status,200);assert.equal((await sharp(saved.data).metadata()).format,'jpeg');
      assert.equal((await call(photo.photoUrl,undefined,bob.token)).status,404);
      assert.equal((await call(publicPath+'/photos/'+photo.id)).status,404);
      const otherPath=`/restaurant-onboarding/${b.id}/menu`;
      await call(otherPath+'/categories',{name:'Other',menuVersion:1},bob.token);
      const other=(await call(otherPath,undefined,bob.token)).data;
      const {id,photoUrl,...data}=item;
      assert.equal((await call(otherPath+'/items',{...data,menuVersion:other.menuVersion},bob.token)).status,400);
      assert.equal((await call(path+'/items/'+id,{...data,menuVersion:menu.menuVersion},bob.token)).status,404);
      assert.equal((await call(path+'/items/'+id+'/archive',{menuVersion:menu.menuVersion},bob.token)).status,404);
      assert.equal((await call(otherPath+'/items',{...data,categoryId:other.categories[0].id,photoId:photo.id,menuVersion:other.menuVersion},bob.token)).status,400);
      assert.equal((await write('/items/'+item.id,{...data,photoId:photo.id})).status,201);await refresh();
      assert.equal((await call(publicPath+'/photos/'+photo.id)).status,200);
    });
    await t.test('hide, competing writes, and category archival preserve records and gate photos',async()=>{
      const {id,photoUrl,...data}=item;
      const results=await Promise.all([write('/items/'+id,{...data,photoId:photo.id,available:false}),write('/items/'+id,{...data,photoId:photo.id,available:false})]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);await refresh();
      assert.equal((await call(publicPath)).data.categories.find(c=>c.id===category).items.length,0);
      assert.equal((await call(publicPath+'/photos/'+photo.id)).status,404);
      assert.equal((await write('/items/'+id,{...data,photoId:photo.id,available:true})).status,201);await refresh();
      await db.restaurant.update({where:{id:a.id},data:{status:'SUSPENDED'}});assert.equal((await call(publicPath+'/photos/'+photo.id)).status,404);
      await db.restaurant.update({where:{id:a.id},data:{status:'APPROVED'}});
      assert.equal((await write('/categories/'+category+'/archive')).status,201);await refresh();assert.equal(menu.categories.length,1);
      assert.ok((await db.menuItem.findUnique({where:{id}})).archivedAt);assert.equal(await db.menuPhoto.count(),1);
      assert.equal((await call(publicPath+'/photos/'+photo.id)).status,404);
      assert.equal((await write('/items/'+id,{...data,categoryId:second,photoId:photo.id})).status,404);
    });
    await t.test('item archive keeps its ID and prevents later updates',async()=>{
      const data={categoryId:second,name:'Archive fixture',description:'',priceMinor:100,currency:'INR',available:true,photoId:null};
      assert.equal((await write('/items',data)).status,201);await refresh();
      const id=menu.categories[0].items[0].id;
      assert.equal((await write('/items/'+id+'/archive')).status,201);await refresh();
      assert.equal(menu.categories[0].items.length,0);
      assert.ok((await db.menuItem.findUnique({where:{id}})).archivedAt);
      assert.equal((await write('/items/'+id,data)).status,404);
    });
  }finally{
    if(restaurants)await restaurants.close();if(identity)await identity.close();
    await restaurantStore.socket.stop();await identityStore.socket.stop();await restaurantStore.db.close();await identityStore.db.close();
    await s3.close();await rm(directory,{recursive:true,force:true});
  }
});

