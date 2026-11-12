import { Injectable } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer } from 'better-auth/plugins';
import nodemailer from 'nodemailer';
import { Database } from './database.js';

export type RecoverySender = (email:string, token:string) => Promise<void>;
export function createAuth(database:Database, sendRecovery?:RecoverySender) {
  const secret=process.env.BETTER_AUTH_SECRET;
  const baseURL=process.env.BETTER_AUTH_URL;
  if(!secret || secret.length<32 || !baseURL) throw new Error('Set BETTER_AUTH_SECRET (32+ characters) and BETTER_AUTH_URL');
  const deployed=['staging','production'].includes(process.env.APP_ENV ?? '');
  if(deployed && (!baseURL.startsWith('https://') || !process.env.SMTP_URL || !process.env.MAIL_FROM)) throw new Error('Deployed auth requires HTTPS and recovery mail settings');
  return betterAuth({
    appName:'Food Delivery',baseURL,secret,
    database:prismaAdapter(database,{provider:'postgresql',transaction:true}),
    trustedOrigins:[new URL(baseURL).origin],
    user:{additionalFields:{
      role:{type:'string',defaultValue:'CUSTOMER',input:false},
      disabled:{type:'boolean',defaultValue:false,input:false},
    }},
    emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,
      revokeSessionsOnPasswordReset:true,resetPasswordTokenExpiresIn:3600,
      sendResetPassword:async ({user,token})=>{
        if(sendRecovery) return sendRecovery(user.email,token);
        if(!process.env.SMTP_URL || !process.env.MAIL_FROM) throw new Error('Recovery sender unavailable');
        const transport=nodemailer.createTransport(process.env.SMTP_URL);
        await transport.sendMail({from:process.env.MAIL_FROM,to:user.email,subject:'Reset your Food Delivery password',
          text:`Enter this recovery code in the app: ${token}\nIt expires in one hour. If you did not request this, ignore this email.`});
      },
    },
    session:{expiresIn:60*60*24,updateAge:60*60,cookieCache:{enabled:false}},
    databaseHooks:{session:{create:{before:async (session,context)=>{
      const user=await context?.context.internalAdapter.findUserById(session.userId);
      if(!user || (user as typeof user & {disabled?:boolean}).disabled) return false;
      return {data:session};
    }}}},
    rateLimit:{enabled:true,storage:'database',window:60,max:100,
      customRules:{'/sign-in/email':{window:60,max:5},'/sign-up/email':{window:60,max:5},'/request-password-reset':{window:60,max:3},'/reset-password':{window:60,max:5}}},
    advanced:{useSecureCookies:deployed},
    plugins:[bearer({requireSignature:true})],
  });
}

@Injectable()
export class AuthService {
  readonly auth:ReturnType<typeof createAuth>;
  constructor(database:Database) { this.auth=createAuth(database); }
}
