import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Database } from './database.js';
import { SessionGuard, requireRole } from './access.js';
import type { AuthRequest } from './access.js';

@Controller()
@UseGuards(SessionGuard)
export class IdentityController {
  constructor(private readonly database:Database) {}
  @Get('me') me(@Req() request:AuthRequest) { return request.identity; }

  @Post('me/profile') async profile(@Req() request:AuthRequest,@Body() body:unknown) {
    const name = body && typeof body === 'object' ? (body as {name?:unknown}).name : undefined;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
        Object.keys(body as object).some(key => key !== 'name') || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new BadRequestException('Enter a display name of 1–100 characters');
    }
    return this.database.user.update({
      where:{id:request.identity.id},
      data:{name:name.trim()},
      select:{id:true,name:true,email:true,role:true},
    });
  }

  @Get('dashboard') async dashboard(@Req() request:AuthRequest) {
    const user=request.identity;
    const restaurants=user.role==='RESTAURANT' ? await this.database.restaurantMembership.findMany({where:{userId:user.id},select:{restaurant:{select:{id:true,name:true}}}}) : [];
    const driver=user.role==='DRIVER' ? await this.database.driverProfile.findUnique({where:{userId:user.id},select:{id:true,approved:true}}) : null;
    return {user,restaurants:restaurants.map(m=>m.restaurant),driver,orderingEnabled:false};
  }

  @Get('restaurants/:id/private') async restaurant(@Req() request:AuthRequest,@Param('id') id:string) {
    requireRole(request.identity,'RESTAURANT');
    const membership=await this.database.restaurantMembership.findUnique({where:{userId_restaurantId:{userId:request.identity.id,restaurantId:id}},select:{restaurant:{select:{id:true,name:true}}}});
    if(!membership) throw new NotFoundException();
    return membership.restaurant;
  }

  @Get('drivers/:id/private') async driver(@Req() request:AuthRequest,@Param('id') id:string) {
    requireRole(request.identity,'DRIVER');
    const driver=await this.database.driverProfile.findFirst({where:{id,userId:request.identity.id,approved:true},select:{id:true,approved:true}});
    if(!driver) throw new NotFoundException();
    return driver;
  }

  @Get('admin/users') async users(@Req() request:AuthRequest) {
    requireRole(request.identity,'ADMIN');
    return this.database.user.findMany({take:100,orderBy:{createdAt:'desc'},select:{id:true,name:true,email:true,role:true,disabled:true}});
  }

  @Get('admin/audit') async audit(@Req() request:AuthRequest) {
    requireRole(request.identity,'ADMIN');
    return this.database.auditEvent.findMany({take:100,orderBy:{createdAt:'desc'}});
  }

  @Post('admin/users/:id/disable') async disable(@Req() request:AuthRequest,@Param('id') id:string,@Body() body:unknown) {
    requireRole(request.identity,'ADMIN');
    if(!body || typeof body!=='object' || Object.keys(body).some(k=>k!=='disabled') || typeof (body as {disabled?:unknown}).disabled!=='boolean') throw new BadRequestException();
    if(id===request.identity.id) throw new ForbiddenException('Cannot disable your own account');
    const disabled=(body as {disabled:boolean}).disabled;
    return this.database.$transaction(async tx=>{
      const target=await tx.user.findUnique({where:{id}});
      if(!target) throw new NotFoundException();
      // Administrator changes use the controlled operator process to avoid locking out all admins.
      if(target.role==='ADMIN') throw new ForbiddenException('Administrator changes require operator access');
      await tx.user.update({where:{id},data:{disabled}});
      await tx.session.deleteMany({where:{userId:id}});
      await tx.auditEvent.create({data:{actorId:request.identity.id,targetId:id,action:disabled?'USER_DISABLED':'USER_ENABLED'}});
      return {id,disabled};
    });
  }
}
