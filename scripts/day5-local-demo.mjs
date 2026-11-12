// Run only inside the local restaurants development container.
import { Database } from './dist/database.js';
const db = new Database();
try {
  if (process.env.APP_ENV !== 'development') throw new Error('Local development only.');
  await db.ready();
  await db.$transaction(async tx => {
    const id = 'day5-demo-kitchen';
    if (await tx.restaurant.count({where:{status:'APPROVED',active:true}})) return;
    await tx.restaurant.create({data:{
      id,name:'waweigg Test Kitchen (demo)',address:'Demo pickup point',latitude:12.9716,longitude:77.5946,timezone:'UTC',
      status:'APPROVED',hours:Array.from({length:7},(_,day)=>({day,open:0,close:1440})),
    }});
    const category=await tx.menuCategory.create({data:{restaurantId:id,name:'Rice bowls',position:0}});
    await tx.menuItem.create({data:{id:'day5-demo-paneer',restaurantId:id,categoryId:category.id,name:'Paneer rice bowl',description:'Grilled paneer, rice and mint chutney.',currency:'INR',priceMinor:17900}});
  });
} finally { await db.$disconnect(); }
