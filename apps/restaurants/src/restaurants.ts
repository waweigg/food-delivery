import {BadRequestException,Body,ConflictException,Controller,ForbiddenException,Get,Headers,NotFoundException,Param,Post,Query,Req,UseGuards} from '@nestjs/common';
import {timingSafeEqual} from 'node:crypto';
import {Database} from './database.js';
import {admin,IdentityGuard} from './access.js';
import type {AuthRequest} from './access.js';
import {availability} from './hours.js';
import {object,profile,text,version} from './validation.js';
import {config} from './config.js';
import {coverage} from './coverage.js';

const publicFields={id:true,name:true,address:true,latitude:true,longitude:true,timezone:true,hours:true,active:true,status:true,temporaryClosedUntil:true} as const;
function publicView(row:any){const status=availability(row);return {id:row.id,name:row.name,address:row.address,latitude:row.latitude,longitude:row.longitude,timezone:row.timezone,hours:row.hours,isOpen:status.eligible,availability:status.reason,orderingEnabled:false};}
function offset(raw?:string){if(raw===undefined)return 0;if(!/^\d{1,6}$/.test(raw))throw new BadRequestException('Invalid offset');return Number(raw);}

@Controller()
export class RestaurantController {
  constructor(private readonly database:Database){}
  @Post('catalog/coverage')async coverage(@Body()body:unknown){const result=await coverage(this.database,body);return {restaurants:result.rows.map(row=>({...publicView(row),distanceMetres:Math.round(row.distance)})),hasMore:result.hasMore,radiusMetres:result.radiusMetres};}
  @Get('catalog/restaurants')async catalog(@Query('offset')raw?:string){const rows=await this.database.restaurant.findMany({where:{status:'APPROVED',active:true},select:publicFields,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:offset(raw),take:50});return rows.map(publicView);}
  @Get('catalog/restaurants/:id')async detail(@Param('id')id:string){const row=await this.database.restaurant.findFirst({where:{id,status:'APPROVED',active:true},select:publicFields});if(!row)throw new NotFoundException();return publicView(row);}

  @Get('restaurant-onboarding/mine')@UseGuards(IdentityGuard)
  async mine(@Req()request:AuthRequest){return this.database.restaurant.findMany({where:{members:{some:{userId:request.actor.id}}},orderBy:{createdAt:'desc'},take:50});}

  @Post('restaurant-onboarding')@UseGuards(IdentityGuard)
  async create(@Req()request:AuthRequest,@Body()body:unknown){
    if(!['CUSTOMER','RESTAURANT'].includes(request.actor.role))throw new ForbiddenException();
    const data=profile(body);
    return this.database.restaurant.create({data:{...data,members:{create:{userId:request.actor.id}},approvals:{create:{actorId:request.actor.id,action:'SUBMITTED',reason:'Initial application',version:1}}}});
  }

  @Get('restaurant-onboarding/:id')@UseGuards(IdentityGuard)
  async privateProfile(@Req()request:AuthRequest,@Param('id')id:string){
    const row=await this.database.restaurant.findFirst({where:{id,members:{some:{userId:request.actor.id}}},include:{approvals:{orderBy:{createdAt:'desc'},take:20}}});
    if(!row)throw new NotFoundException();return row;
  }

  @Post('restaurant-onboarding/:id/profile')@UseGuards(IdentityGuard)
  async edit(@Req()request:AuthRequest,@Param('id')id:string,@Body()body:unknown){
    const data=profile(body,true);const expected=version((body as Record<string,unknown>).version);
    return this.database.$transaction(async tx=>{
      const current=await tx.restaurant.findFirst({where:{id,members:{some:{userId:request.actor.id}}}});if(!current)throw new NotFoundException();
      const identityChanged=['name','address','latitude','longitude','timezone'].some(key=>current[key as keyof typeof current]!==data[key as keyof typeof data]);
      const status=current.status==='APPROVED'&&identityChanged?'PENDING':current.status;
      const changed=await tx.restaurant.updateMany({where:{id,version:expected},data:{...data,status,version:{increment:1}}});if(changed.count!==1)throw new ConflictException('Profile changed. Reload before saving.');
      await tx.approvalEvent.create({data:{restaurantId:id,actorId:request.actor.id,action:status!==current.status?'REVIEW_REQUIRED':'PROFILE_UPDATED',reason:status!==current.status?'Location or business identity changed':'Member edit',version:expected+1}});
      return tx.restaurant.findUniqueOrThrow({where:{id}});
    });
  }

  @Get('admin/restaurants')@UseGuards(IdentityGuard)
  async reviewList(@Req()request:AuthRequest,@Query('offset')raw?:string){admin(request.actor);return this.database.restaurant.findMany({orderBy:[{createdAt:'desc'},{id:'asc'}],skip:offset(raw),take:50});}

  @Get('admin/restaurants/:id')@UseGuards(IdentityGuard)
  async reviewDetail(@Req()request:AuthRequest,@Param('id')id:string){admin(request.actor);const row=await this.database.restaurant.findUnique({where:{id},include:{approvals:{orderBy:{createdAt:'desc'},take:50},members:true}});if(!row)throw new NotFoundException();return row;}

  @Post('admin/restaurants/:id/decision')@UseGuards(IdentityGuard)
  async decision(@Req()request:AuthRequest,@Param('id')id:string,@Body()input:unknown){
    admin(request.actor);const body=object(input,['status','reason','version']);
    if(body.status!=='APPROVED'&&body.status!=='SUSPENDED')throw new BadRequestException('Choose APPROVED or SUSPENDED');
    const status=body.status,reason=text(body.reason,'decision reason',1000),expected=version(body.version);
    return this.database.$transaction(async tx=>{
      if(!await tx.restaurant.findUnique({where:{id}}))throw new NotFoundException();
      const changed=await tx.restaurant.updateMany({where:{id,version:expected},data:{status,version:{increment:1}}});if(changed.count!==1)throw new ConflictException('Profile changed. Review it again.');
      await tx.approvalEvent.create({data:{restaurantId:id,actorId:request.actor.id,action:status,reason,version:expected+1}});
      return tx.restaurant.findUniqueOrThrow({where:{id}});
    });
  }

  @Get('internal/restaurants/:id/order-eligibility')
  async eligibility(@Param('id')id:string,@Headers('x-service-token')token?:string){
    const expected=Buffer.from(config().serviceToken),given=Buffer.from(token??'');
    if(given.length!==expected.length||!timingSafeEqual(given,expected))throw new ForbiddenException();
    const row=await this.database.restaurant.findUnique({where:{id}});
    if(!row)return {eligible:false,reason:'NOT_FOUND',orderingEnabled:false};
    return {...availability(row),restaurantId:id,version:row.version,orderingEnabled:false};
  }
}
