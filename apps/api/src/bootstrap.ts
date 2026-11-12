import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module.js';
import { AuthService } from './auth.js';
import type { Request,Response,NextFunction } from 'express';

export async function createApplication() {
  const app=await NestFactory.create(AppModule,{bodyParser:false,logger:process.env.APP_ENV==='test'?false:undefined});
  const express=app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  if(process.env.TRUST_GATEWAY==='true') express.set('trust proxy',1);
  // Forwarded addresses are ignored until a specific trusted gateway is configured.
  express.use((req:Request,res:Response,next:NextFunction)=>{
    const clientAddress=req.ip ?? req.socket.remoteAddress ?? '127.0.0.1';
    delete req.headers['x-forwarded-for'];
    delete req.headers['x-real-ip'];
    req.headers['x-forwarded-for']=clientAddress;
    res.setHeader('Cache-Control','no-store');
    next();
  });
  express.post('/api/auth/request-password-reset',(req:Request,res:Response,next:NextFunction)=>{
    if(!process.env.SMTP_URL || !process.env.MAIL_FROM) { res.status(503).json({message:'Recovery email is not configured'});return; }
    next();
  });
  express.all('/api/auth/*splat',toNodeHandler(app.get(AuthService).auth));
  express.use(json({limit:'32kb'}));
  app.enableShutdownHooks();
  return app;
}
