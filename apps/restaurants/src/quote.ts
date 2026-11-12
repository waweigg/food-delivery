import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Database } from './database.js';
import { availability } from './hours.js';
import { object, text } from './validation.js';

function coordinate(value: unknown, limit: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit)
    throw new BadRequestException('Invalid delivery coordinates');
  return value;
}
export function policyNumber(key: string, fallback: number) {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) throw new Error('Invalid delivery policy');
  return value;
}
function distanceMetres(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180;
  const h = Math.sin((c-a)*rad/2)**2 + Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1,h)));
}

export async function quoteCart(db: Database, restaurantId: string, input: unknown) {
  const body = object(input, ['address','currency','items']);
  const address = object(body.address, ['street','latitude','longitude','phone','instructions']);
  text(address.street,'address',500);
  const phone = text(address.phone,'contact number',32);
  if (!/^\+?[0-9 ()-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g,''))) throw new BadRequestException('Invalid contact number');
  if (address.instructions !== undefined && (typeof address.instructions !== 'string' || address.instructions.length > 500)) throw new BadRequestException('Invalid delivery instructions');
  const lat = coordinate(address.latitude,90), lon = coordinate(address.longitude,180);
  if (body.currency !== 'INR') throw new UnprocessableEntityException('Only INR is supported.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw new BadRequestException('Invalid basket size');
  const quantities = new Map<string,number>();
  for (const raw of body.items) {
    const line = object(raw,['itemId','quantity']);
    const id = text(line.itemId,'item',100);
    if (quantities.has(id) || typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99)
      throw new BadRequestException('Invalid basket quantity or duplicate item');
    quantities.set(id,line.quantity);
  }
  return db.$transaction(async tx => {
    const restaurant = await tx.restaurant.findFirst({where:{id:restaurantId,status:'APPROVED',active:true}});
    if (!restaurant) throw new NotFoundException();
    if (!availability(restaurant).eligible) throw new UnprocessableEntityException('This restaurant is closed.');
    if (distanceMetres(restaurant.latitude,restaurant.longitude,lat,lon) > policyNumber('DELIVERY_RADIUS_METRES',5000))
      throw new UnprocessableEntityException('This address is outside the delivery area.');
    const rows = await tx.menuItem.findMany({where:{id:{in:[...quantities.keys()]},restaurantId,available:true,archivedAt:null,category:{archivedAt:null}}});
    if (rows.length !== quantities.size) throw new UnprocessableEntityException('A dish is unavailable. Update your basket.');
    if (rows.some(row => row.currency !== 'INR')) throw new UnprocessableEntityException('Only INR is supported.');
    const items = rows.map(row => ({itemId:row.id,name:row.name,quantity:quantities.get(row.id)!,unitMinor:row.priceMinor,lineMinor:row.priceMinor*quantities.get(row.id)!}));
    const subtotalMinor = items.reduce((sum,line)=>sum+line.lineMinor,0);
    const deliveryMinor = policyNumber('DELIVERY_FEE_MINOR',3000), otherMinor = policyNumber('OTHER_CHARGES_MINOR',0);
    return {restaurantId,currency:'INR',items,subtotalMinor,deliveryMinor,otherMinor,totalMinor:subtotalMinor+deliveryMinor+otherMinor};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
