import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const base='http://localhost:8088',file='.local/demo-credentials.json';mkdirSync('.local',{recursive:true});
const accounts=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
const roles=['customer','restaurant','delivery','admin'];
for(const role of roles){
 if(!accounts[role]){
  const email=role+'@waweigg.test',password='Wg-'+randomBytes(12).toString('base64url');
  const r=await fetch(base+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',Origin:base},body:JSON.stringify({email,password,name:'waweigg Demo '+role})});
  if(!r.ok)throw Error('Could not create '+role+' fixture. Existing accounts are never reset automatically.');
  accounts[role]={email,password,id:(await r.json()).user.id};writeFileSync(file,JSON.stringify(accounts,null,2));
 }
}
const restaurants=[
 {id:'mlp-demo-malabar',name:'Malabar Biriyani House (Demo)',latitude:11.0735,longitude:76.0740,menu:[['Chicken dum biriyani','Fragrant rice, chicken and Malabar spices.',18000],['Vegetable biriyani','Seasonal vegetables with fragrant rice.',14000],['Lime soda','Fresh lime with a sparkling finish.',4500]]},
 {id:'mlp-demo-coconut',name:'Coconut & Curry (Demo)',latitude:11.0750,longitude:76.0750,menu:[['Kerala meals','Rice, vegetable sides, sambar and papadam.',12000],['Porotta with chicken curry','Two flaky porottas with a coconut-based curry.',16000],['Fish curry meals','Rice, fish curry and vegetable sides.',19000]]},
 {id:'mlp-demo-chaya',name:'Chaya Corner (Demo)',latitude:11.0720,longitude:76.0730,menu:[['Chaya and pazham pori','Milk tea with two banana fritters.',6000],['Appam and vegetable stew','Two appams with gently spiced coconut stew.',10000],['Sulaimani','Black tea with lime and spices.',2500]]},
];
const context={accounts:Object.fromEntries(roles.map(r=>[r,{id:accounts[r].id,email:accounts[r].email}])),restaurants};
function run(service,source){execFileSync('docker',['compose','-f','compose.yaml','-f','compose.services.yaml','exec','-T','-e','DEMO_FIXTURE='+JSON.stringify(context),service,'node','--input-type=module'],{input:source,stdio:['pipe','pipe','pipe']});}
run('identity',`
import {Database} from './dist/database.js';
if(process.env.APP_ENV!=='development')throw Error('Development only');
const {accounts,restaurants}=JSON.parse(process.env.DEMO_FIXTURE),db=new Database();await db.ready();
await db.$transaction(async tx=>{
 for(const r of restaurants)await tx.restaurant.upsert({where:{id:r.id},create:{id:r.id,name:r.name},update:{name:r.name}});
 for(const [label,a] of Object.entries(accounts)){
  const role={customer:'CUSTOMER',restaurant:'RESTAURANT',delivery:'DRIVER',admin:'ADMIN'}[label];
  const u=await tx.user.findUnique({where:{id:a.id}});
  if(!u||u.email!==a.email||!a.email.endsWith('@waweigg.test')||u.disabled||!['CUSTOMER',role].includes(u.role))throw Error('Invalid local fixture');
  if(role==='DRIVER')await tx.driverProfile.upsert({where:{userId:a.id},create:{userId:a.id,approved:true},update:{approved:true}});
  if(role==='RESTAURANT')for(const r of restaurants)await tx.restaurantMembership.upsert({where:{userId_restaurantId:{userId:a.id,restaurantId:r.id}},create:{userId:a.id,restaurantId:r.id},update:{}});
  if(u.role!==role){await tx.user.update({where:{id:a.id},data:{role}});await tx.session.deleteMany({where:{userId:a.id}});await tx.auditEvent.create({data:{actorId:'local-demo-operator',targetId:a.id,action:'LOCAL_DEMO_'+role}});}
 }
});await db.$disconnect();`);
run('restaurants',`
import {Database} from './dist/database.js';
if(process.env.APP_ENV!=='development')throw Error('Development only');
const {accounts,restaurants}=JSON.parse(process.env.DEMO_FIXTURE),db=new Database();await db.ready();
await db.$transaction(async tx=>{
 for(const [index,r] of restaurants.entries()){
  const data={name:r.name,address:'Sample pickup, Malappuram, Kerala — fictional test restaurant',latitude:r.latitude,longitude:r.longitude,timezone:'Asia/Kolkata',hours:Array.from({length:7},(_,day)=>({day,open:0,close:1440})),status:'APPROVED',active:true};
  const row=await tx.restaurant.upsert({where:{id:r.id},create:{id:r.id,...data,createdAt:new Date(Date.now()-index*1000)},update:{...data,menuVersion:{increment:1},version:{increment:1}}});
  await tx.approvalEvent.create({data:{restaurantId:r.id,actorId:'local-demo-operator',action:'APPROVED',reason:'User-authorized fictional Malappuram demo',version:row.version}});
  await tx.restaurantMember.upsert({where:{restaurantId_userId:{restaurantId:r.id,userId:accounts.restaurant.id}},create:{restaurantId:r.id,userId:accounts.restaurant.id},update:{}});
  const categoryId=r.id+'-popular';await tx.menuCategory.upsert({where:{id:categoryId},create:{id:categoryId,restaurantId:r.id,name:'Popular picks',position:0},update:{archivedAt:null}});
  for(const [i,item] of r.menu.entries()){
   const data={restaurantId:r.id,categoryId,name:item[0],description:item[1]+' Sample menu and test price.',priceMinor:item[2],currency:'INR',available:true,archivedAt:null};
   await tx.menuItem.upsert({where:{id:r.id+'-item-'+i},create:{id:r.id+'-item-'+i,...data},update:data});
  }
 }
 await tx.restaurant.updateMany({where:{id:'day5-demo-kitchen'},data:{name:'waweigg Test Kitchen (demo)'}});
});await db.$disconnect();`);
run('drivers',`
import pg from 'pg';if(process.env.APP_ENV!=='development')throw Error('Development only');
const {accounts}=JSON.parse(process.env.DEMO_FIXTURE),c=new pg.Client({connectionString:process.env.DRIVERS_DATABASE_URL});await c.connect();await c.query('BEGIN');
await c.query("INSERT INTO driver_profiles(user_id,name,vehicle,status) VALUES($1,'waweigg Demo Driver','DEMO-TAXI','APPROVED') ON CONFLICT(user_id) DO UPDATE SET status='APPROVED',online=false,version=driver_profiles.version+1",[accounts.delivery.id]);
await c.query("INSERT INTO driver_audit(actor,driver_id,action) VALUES('local-demo-operator',$1,'APPROVED')",[accounts.delivery.id]);await c.query('COMMIT');await c.end();`);
for(const role of roles){const a=accounts[role];const r=await fetch(base+'/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json',Origin:base},body:JSON.stringify({email:a.email,password:a.password})});if(!r.ok)throw Error(role+' login failed');const token=r.headers.get('set-auth-token');const me=await fetch(base+'/me',{headers:{authorization:'Bearer '+token}}).then(r=>r.json());if(me.role!==({customer:'CUSTOMER',restaurant:'RESTAURANT',delivery:'DRIVER',admin:'ADMIN'})[role])throw Error('Role mismatch');}
console.log('Created and verified four local demo logins and three fictional Malappuram restaurants. Credentials: .local/demo-credentials.json');
