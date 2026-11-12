import 'reflect-metadata';
import 'dotenv/config';
import { createApplication } from './bootstrap.js';
import { readConfig } from './config.js';
async function bootstrap() {
  const config=readConfig();
  const app=await createApplication();
  await app.listen(config.port,'0.0.0.0');
}
bootstrap().catch(()=>{console.error('API startup failed; check configuration.');process.exitCode=1;});
