import 'dotenv/config';
import {Database} from './database.js';
import {config} from './config.js';
const db=new Database();
try{await db.serviceIdentity.upsert({where:{id:'singleton'},create:{id:'singleton',environment:config().environment,service:'restaurants'},update:{}});await db.ready();console.log('Restaurant database initialized');}catch{console.error('Restaurant database initialization refused');process.exitCode=1;}finally{await db.$disconnect();}
