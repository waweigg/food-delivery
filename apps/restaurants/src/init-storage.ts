import 'dotenv/config';
import {MenuStorage} from './menu-storage.js';
if((process.env.APP_ENV??'development')!=='development')throw new Error('Automatic bucket provisioning is development only');
const storage=new MenuStorage();
try{await storage.initialize();console.log('Development menu bucket ready');}finally{storage.onModuleDestroy();}
