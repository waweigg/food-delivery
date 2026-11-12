import {BadRequestException} from '@nestjs/common';
import type {OpeningPeriod} from './hours.js';
export function object(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)))throw new BadRequestException('Unexpected or missing fields');return value as Record<string,unknown>;
}
export function text(value:unknown,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new BadRequestException(`Invalid ${label}`);return value.trim();}
export function version(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1)throw new BadRequestException('Valid version required');return Number(value);}
export function profile(value:unknown,edit=false){
  const body=object(value,['name','address','latitude','longitude','timezone','hours','active','temporaryClosedUntil',...(edit?['version']:[])]);
  const name=text(body.name,'name',120),address=text(body.address,'address',500),timezone=text(body.timezone,'timezone',100);
  try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format();}catch{throw new BadRequestException('Invalid IANA timezone');}
  if(typeof body.latitude!=='number'||!Number.isFinite(body.latitude)||Math.abs(body.latitude)>90||typeof body.longitude!=='number'||!Number.isFinite(body.longitude)||Math.abs(body.longitude)>180)throw new BadRequestException('Invalid coordinates');
  if(typeof body.active!=='boolean')throw new BadRequestException('Active must be a boolean');
  if(!Array.isArray(body.hours)||body.hours.length>28)throw new BadRequestException('Hours must have at most 28 periods');
  const hours:OpeningPeriod[]=body.hours.map(p=>{
    const period=object(p,['day','open','close']);const {day,open,close}=period;
    if(!Number.isInteger(day)||Number(day)<0||Number(day)>6||!Number.isInteger(open)||Number(open)<0||Number(open)>1439||!Number.isInteger(close)||Number(close)<0||Number(close)>1440||open===close)throw new BadRequestException('Invalid opening period');
    return {day:Number(day),open:Number(open),close:Number(close)};
  });
  // Compare expanded intervals, including the Saturday-to-Sunday boundary.
  const intervals=hours.flatMap(p=>{const start=p.day*1440+p.open,end=p.day*1440+p.close+(p.close<p.open?1440:0);return [[start,end],[start+10080,end+10080]];}).sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<intervals.length;i++)if(intervals[i][0]<intervals[i-1][1])throw new BadRequestException('Opening periods overlap');
  let temporaryClosedUntil:Date|null=null;
  if(body.temporaryClosedUntil!==null && body.temporaryClosedUntil!==undefined){
    if(typeof body.temporaryClosedUntil!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(body.temporaryClosedUntil))throw new BadRequestException('Closure must be a timestamp with timezone');
    temporaryClosedUntil=new Date(body.temporaryClosedUntil);if(!Number.isFinite(temporaryClosedUntil.getTime()))throw new BadRequestException('Invalid closure timestamp');
  }
  return {name,address,timezone,latitude:body.latitude,longitude:body.longitude,hours,active:body.active,temporaryClosedUntil};
}
