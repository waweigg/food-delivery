import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {coverage} from '../dist/coverage.js';

test('coverage validates coordinates and filters before pagination with the checkout radius',async()=>{
 const db=await PGlite.create();
 try{
  await db.exec('CREATE TABLE "Restaurant" (id text,name text,address text,latitude float8,longitude float8,timezone text,hours jsonb,active boolean,status text,"temporaryClosedUntil" timestamptz)');
  const insert=async(id,lat,lon,status='APPROVED',active=true)=>db.query('INSERT INTO "Restaurant" VALUES($1,$1,$1,$2,$3,\'UTC\',\'[]\',$4,$5,NULL)',[id,lat,lon,active,status]);
  for(let i=0;i<60;i++)await insert('far-'+i,40,40);
  await insert('near',0,0);await insert('within',0,0.0449);await insert('outside',0,0.0451);
  await insert('pending',0,0,'PENDING');await insert('suspended',0,0,'SUSPENDED');await insert('inactive',0,0,'APPROVED',false);
  const client={$queryRaw:async(strings,...values)=>{let sql=strings[0];values.forEach((_,i)=>sql+='$'+(i+1)+strings[i+1]);return(await db.query(sql,values)).rows;}};
  const result=await coverage(client,{latitude:0,longitude:0});
  assert.deepEqual(result.rows.map(r=>r.id),['near','within']);assert.equal(result.radiusMetres,5000);assert.equal(result.hasMore,false);
  assert.equal((await coverage(client,{latitude:-40,longitude:-40})).rows.length,0);
  for(const input of [{},{latitude:null,longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:'0',longitude:0},{latitude:0,longitude:0,offset:-1}])await assert.rejects(()=>coverage(client,input));
  for(let i=0;i<55;i++)await insert('local-'+String(i).padStart(2,'0'),0,0);
  const first=await coverage(client,{latitude:0,longitude:0}),next=await coverage(client,{latitude:0,longitude:0,offset:50});
  assert.equal(first.rows.length,50);assert.equal(first.hasMore,true);assert.equal(next.rows.length,7);assert.equal(next.hasMore,false);
  assert.equal(new Set([...first.rows,...next.rows].map(r=>r.id)).size,57);
 }finally{await db.close();}
});
