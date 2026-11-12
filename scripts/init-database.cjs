// Provision once using environment-specific credentials, after running migrations.
const {Client}=require('../apps/api/node_modules/pg');
const environment=process.env.APP_ENV;
if(!['development','test','staging','production'].includes(environment)) throw Error('Set APP_ENV explicitly');
const client=new Client({connectionString:process.env.DATABASE_URL});
(async()=>{await client.connect();
 await client.query('INSERT INTO "EnvironmentIdentity" (id,name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING',['singleton',environment]);
 const result=await client.query('SELECT name FROM "EnvironmentIdentity" WHERE id=$1',['singleton']);
 if(result.rows[0]?.name!==environment) throw Error('Database already belongs to another environment');
 console.log('Database identity verified');
})().catch(()=>{console.error('Database initialization failed');process.exitCode=1;}).finally(()=>client.end());
