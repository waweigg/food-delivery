import {BadRequestException} from '@nestjs/common';
import {Database} from './database.js';
import {object} from './validation.js';
import {policyNumber} from './quote.js';

export async function coverage(db:Database,input:unknown){
 const b=object(input,['latitude','longitude','offset']);
 if(typeof b.latitude!=='number'||!Number.isFinite(b.latitude)||Math.abs(b.latitude)>90||typeof b.longitude!=='number'||!Number.isFinite(b.longitude)||Math.abs(b.longitude)>180)
  throw new BadRequestException('Select a valid delivery location');
 const offset=b.offset??0;
 if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new BadRequestException('Invalid offset');
 const radius=policyNumber('DELIVERY_RADIUS_METRES',5000);
 // Filter before pagination; a distant first page must never hide nearby restaurants.
 const rows=await db.$queryRaw<any[]>`
  WITH nearby AS (
   SELECT id,name,address,latitude,longitude,timezone,hours,active,status,"temporaryClosedUntil",
    12742000*asin(sqrt(LEAST(1.0,
     power(sin(radians(latitude-${b.latitude})/2),2)+cos(radians(latitude))*cos(radians(${b.latitude}))*power(sin(radians(longitude-${b.longitude})/2),2)
    ))) AS distance
   FROM "Restaurant" WHERE status='APPROVED' AND active=true
  ) SELECT * FROM nearby WHERE distance<=${radius} ORDER BY distance,id LIMIT 51 OFFSET ${offset}`;
 return {rows:rows.slice(0,50),hasMore:rows.length>50,radiusMetres:radius};
}
