import {CanActivate,ExecutionContext,Injectable,ServiceUnavailableException,UnauthorizedException,ForbiddenException} from '@nestjs/common';
import type {Request} from 'express';
import {config} from './config.js';
export type Actor={id:string;role:string};
export type AuthRequest=Request & {actor:Actor};
@Injectable()
export class IdentityGuard implements CanActivate {
  async canActivate(context:ExecutionContext){
    const request=context.switchToHttp().getRequest<AuthRequest>();
    const authorization=request.headers.authorization;
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException();
    let response:Response;
    try{response=await fetch(`${config().identityUrl}/me`,{headers:{authorization},redirect:'error',signal:AbortSignal.timeout(4000)});}catch{throw new ServiceUnavailableException('Identity service unavailable');}
    if(response.status===401 || response.status===403) throw new UnauthorizedException();
    if(!response.ok) throw new ServiceUnavailableException('Identity service unavailable');
    const user=await response.json() as Actor;
    if(typeof user.id!=='string' || !['CUSTOMER','RESTAURANT','DRIVER','ADMIN'].includes(user.role)) throw new ServiceUnavailableException('Invalid identity response');
    request.actor={id:user.id,role:user.role};return true;
  }
}
export function admin(actor:Actor){if(actor.role!=='ADMIN')throw new ForbiddenException();}
