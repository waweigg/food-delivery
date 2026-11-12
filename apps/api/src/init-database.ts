import 'dotenv/config';
import { Database } from './database.js';
const database=new Database();
try {
  const name=process.env.APP_ENV;
  if(!name || !['development','test','staging','production'].includes(name)) throw new Error('Set APP_ENV explicitly');
  await database.environmentIdentity.upsert({where:{id:'singleton'},create:{id:'singleton',name},update:{}});
  await database.ready();
  console.log('Database environment identity verified');
} catch { console.error('Database initialization refused');process.exitCode=1; }
finally { await database.$disconnect(); }
