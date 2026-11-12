import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.js';
import { Database } from './database.js';
import type { Request } from 'express';

export type Identity={id:string;name:string;email:string;role:string};
export type AuthRequest=Request & {identity:Identity};
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth:AuthService, private readonly database:Database) {}
  async canActivate(context:ExecutionContext) {
    const request=context.switchToHttp().getRequest<AuthRequest>();
    // Mobile API accepts only explicitly attached bearer credentials, never ambient cookies.
    const authorization=request.headers.authorization;
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException();
    const session=await this.auth.auth.api.getSession({headers:new Headers({authorization})});
    if(!session) throw new UnauthorizedException();
    const user=await this.database.user.findUnique({where:{id:session.user.id}});
    if(!user || user.disabled) throw new UnauthorizedException();
    request.identity={id:user.id,name:user.name,email:user.email,role:user.role};
    return true;
  }
}
export function requireRole(user:Identity,role:string) { if(user.role!==role) throw new ForbiddenException(); }
