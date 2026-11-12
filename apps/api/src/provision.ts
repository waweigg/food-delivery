import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { Database } from './database.js';

// Operator-only CLI: promotes an existing account; never creates a public role API.
export async function provision(database:Database,email:string,role:string,restaurantId?:string) {
  if(!['ADMIN','RESTAURANT','DRIVER'].includes(role)) throw new Error('Invalid role');
  if(role==='RESTAURANT' && !restaurantId) throw new Error('Restaurant ID required');
  await database.ready();
  return database.$transaction(async tx=>{
    // Serialize operator changes, including first-admin creation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(872431)`;
    const user=await tx.user.findUnique({where:{email:email.toLowerCase().trim()}});
    if(!user || user.disabled) throw new Error('Active registered user required');
    if(user.role!=='CUSTOMER' && user.role!==role) throw new Error('Existing privileged role must be reviewed manually');
    if(role==='ADMIN' && await tx.user.count({where:{role:'ADMIN'}})>0) throw new Error('Initial admin already exists; further admins require a separate reviewed process');
    if(role==='RESTAURANT') {
      if(!await tx.restaurant.findUnique({where:{id:restaurantId}})) throw new Error('Restaurant does not exist');
      await tx.restaurantMembership.upsert({where:{userId_restaurantId:{userId:user.id,restaurantId:restaurantId!}},create:{userId:user.id,restaurantId:restaurantId!},update:{}});
    }
    if(role==='DRIVER') await tx.driverProfile.upsert({where:{userId:user.id},create:{userId:user.id,approved:true},update:{approved:true}});
    await tx.user.update({where:{id:user.id},data:{role}});
    await tx.session.deleteMany({where:{userId:user.id}});
    await tx.auditEvent.create({data:{actorId:'operator',targetId:user.id,action:`PROVISION_${role}`}});
    return {id:user.id,role};
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const database=new Database();
  const [email,role,restaurantId]=process.argv.slice(2);
  if(!email || !role) { console.error('Usage: npm run provision -- email ADMIN|RESTAURANT|DRIVER [restaurantId]');process.exitCode=1; }
  else await provision(database,email,role,restaurantId).then(()=>console.log('Identity provisioned; sign in again.')).catch(()=>{console.error('Provisioning refused. Check account, role, database identity and existing administrator.');process.exitCode=1;});
  await database.$disconnect();
}
