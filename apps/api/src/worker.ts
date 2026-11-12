import 'reflect-metadata';
import 'dotenv/config';
import { Database } from './database.js';
const database=new Database();
// Day 1 checks connectivity only. Never mark events processed without a handler.
async function tick() { try { await database.ready(); console.log('Worker database ready'); } catch { console.error('Worker database unavailable'); } }
void tick();
const timer=setInterval(()=>void tick(),30000);
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>{clearInterval(timer);void database.$disconnect().then(()=>process.exit(0));});
