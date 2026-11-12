import {Controller,Get,Module,ServiceUnavailableException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {json,raw} from 'express';
import {MenuController} from './menus.js';
import {MenuStorage,MAX_PHOTO_BYTES} from './menu-storage.js';
import {Database} from './database.js';
import {IdentityGuard} from './access.js';
import {RestaurantController} from './restaurants.js';
@Controller('restaurants-health')
class HealthController{
  constructor(private readonly database:Database){}
  @Get('live')live(){return {status:'ok'};}
  @Get('ready')async ready(){try{await this.database.ready();return {status:'ok'};}catch{throw new ServiceUnavailableException();}}
}
@Module({controllers:[HealthController,RestaurantController,MenuController],providers:[Database,IdentityGuard,MenuStorage]})
class RestaurantModule{}
export async function createApplication(){
  const app=await NestFactory.create(RestaurantModule,{bodyParser:false,logger:process.env.APP_ENV==='test'?false:undefined});
  const express=app.getHttpAdapter().getInstance();express.disable('x-powered-by');
  express.use(/^\/restaurant-onboarding\/[^/]+\/menu\/photos\/?$/,raw({type:'application/octet-stream',limit:MAX_PHOTO_BYTES,inflate:false}));
  express.use(json({limit:'32kb'}));
  express.use((_req:any,res:any,next:()=>void)=>{res.setHeader('Cache-Control','no-store');next();});
  app.enableShutdownHooks();return app;
}
