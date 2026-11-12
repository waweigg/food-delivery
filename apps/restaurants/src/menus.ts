import {quoteCart} from './quote.js';
import {BadRequestException,Body,ConflictException,Controller,Get,Header,NotFoundException,Param,Post,Req,StreamableFile,UseGuards} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {Database} from './database.js';
import {IdentityGuard,type AuthRequest} from './access.js';
import {object,text,version} from './validation.js';
import {MenuStorage,normalizePhoto} from './menu-storage.js';

export function menuCurrency(){const value=process.env.MENU_CURRENCY??'INR';if(!/^[A-Z]{3}$/.test(value))throw new Error('Invalid MENU_CURRENCY');return value;}
export function itemInput(value:unknown){
  const b=object(value,['menuVersion','categoryId','name','description','priceMinor','currency','available','photoId']);
  if(!Number.isSafeInteger(b.priceMinor)||Number(b.priceMinor)<1||Number(b.priceMinor)>2147483647)throw new BadRequestException('Price must be positive integer minor units');
  if(b.currency!==menuCurrency())throw new BadRequestException('Incorrect menu currency');
  if(typeof b.available!=='boolean'||typeof b.description!=='string'||b.description.length>2000)throw new BadRequestException('Invalid item details');
  return {name:text(b.name,'name',120),description:b.description.trim(),categoryId:text(b.categoryId,'category',100),priceMinor:Number(b.priceMinor),currency:menuCurrency(),available:b.available,photoId:b.photoId===null?null:text(b.photoId,'photo',100)};
}
@Controller()
export class MenuController {
  constructor(private readonly db:Database,private readonly storage:MenuStorage){}
  private async member(id:string,userId:string){if(!await this.db.restaurantMember.findUnique({where:{restaurantId_userId:{restaurantId:id,userId}}}))throw new NotFoundException();}
  private async published(id:string){if(!await this.db.restaurant.findFirst({where:{id,status:'APPROVED',active:true}}))throw new NotFoundException();}
  private async read(id:string,privateView:boolean){
    return this.db.$transaction(async tx=>{
      const restaurant=await tx.restaurant.findUniqueOrThrow({where:{id},select:{menuVersion:true}});
      const categories=await tx.menuCategory.findMany({where:{restaurantId:id,archivedAt:null},orderBy:[{position:'asc'},{id:'asc'}],include:{items:{where:{archivedAt:null,...(privateView?{}:{available:true})},orderBy:[{createdAt:'asc'},{id:'asc'}]}}});
      return {currency:menuCurrency(),...(privateView?{menuVersion:restaurant.menuVersion}:{}),categories:categories.map(c=>({id:c.id,name:c.name,items:c.items.map(i=>({id:i.id,categoryId:i.categoryId,name:i.name,description:i.description,priceMinor:i.priceMinor,currency:i.currency,available:i.available,photoId:i.photoId,photoUrl:i.photoId?`/${privateView?'restaurant-onboarding':'catalog/restaurants'}/${id}/menu/photos/${i.photoId}`:null}))}))};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  private async mutate(id:string,userId:string,expected:unknown,action:(tx:Prisma.TransactionClient)=>Promise<unknown>){
    await this.member(id,userId);const v=version(expected);
    return this.db.$transaction(async tx=>{
      // Every menu mutation takes the same row lock; stale editors cannot overwrite changes.
      const changed=await tx.restaurant.updateMany({where:{id,menuVersion:v},data:{menuVersion:{increment:1}}});
      if(changed.count!==1)throw new ConflictException('Menu changed; refresh before saving');
      await action(tx);return {menuVersion:v+1};
    });
  }
  @Post('catalog/restaurants/:id/quote')
  async quote(@Param('id') id:string,@Body() input:unknown){return quoteCart(this.db,id,input);}
  @Get('catalog/restaurants/:id/menu')
  async catalog(@Param('id') id:string){await this.published(id);return this.read(id,false);}
  @Get('restaurant-onboarding/:id/menu') @UseGuards(IdentityGuard)
  async mine(@Param('id') id:string,@Req() req:AuthRequest){await this.member(id,req.actor.id);return this.read(id,true);}
  @Post('restaurant-onboarding/:id/menu/categories') @UseGuards(IdentityGuard)
  async category(@Param('id') id:string,@Req() req:AuthRequest,@Body() input:unknown){
    const b=object(input,['menuVersion','name']);const name=text(b.name,'category name',80);
    return this.mutate(id,req.actor.id,b.menuVersion,async tx=>{
      const last=await tx.menuCategory.aggregate({where:{restaurantId:id,archivedAt:null},_max:{position:true}});
      if(await tx.menuCategory.count({where:{restaurantId:id,archivedAt:null}})>=100)throw new BadRequestException('Maximum 100 categories');
      return tx.menuCategory.create({data:{restaurantId:id,name,position:(last._max.position??-1)+1}});
    });
  }
  @Post('restaurant-onboarding/:id/menu/categories/reorder') @UseGuards(IdentityGuard)
  async reorder(@Param('id') id:string,@Req() req:AuthRequest,@Body() input:unknown){
    const b=object(input,['menuVersion','ids']);
    if(!Array.isArray(b.ids)||b.ids.length>100||b.ids.some(v=>typeof v!=='string')||new Set(b.ids).size!==b.ids.length)throw new BadRequestException('Invalid category order');
    const ids=b.ids as string[];
    return this.mutate(id,req.actor.id,b.menuVersion,async tx=>{
      const categories=await tx.menuCategory.findMany({where:{restaurantId:id,archivedAt:null}});
      if(categories.length!==ids.length||categories.some(c=>!ids.includes(c.id)))throw new BadRequestException('Include every active category exactly once');
      for(const [position,categoryId] of ids.entries())await tx.menuCategory.update({where:{id:categoryId},data:{position}});
    });
  }
  @Post('restaurant-onboarding/:id/menu/categories/:categoryId') @UseGuards(IdentityGuard)
  async rename(@Param('id') id:string,@Param('categoryId') categoryId:string,@Req() req:AuthRequest,@Body() input:unknown){
    const b=object(input,['menuVersion','name']);const name=text(b.name,'category name',80);
    return this.mutate(id,req.actor.id,b.menuVersion,async tx=>{if((await tx.menuCategory.updateMany({where:{id:categoryId,restaurantId:id,archivedAt:null},data:{name}})).count!==1)throw new NotFoundException();});
  }
  @Post('restaurant-onboarding/:id/menu/categories/:categoryId/archive') @UseGuards(IdentityGuard)
  async archiveCategory(@Param('id') id:string,@Param('categoryId') categoryId:string,@Req() req:AuthRequest,@Body() input:unknown){
    const b=object(input,['menuVersion']);
    return this.mutate(id,req.actor.id,b.menuVersion,async tx=>{
      const archivedAt=new Date();
      if((await tx.menuCategory.updateMany({where:{id:categoryId,restaurantId:id,archivedAt:null},data:{archivedAt}})).count!==1)throw new NotFoundException();
      await tx.menuItem.updateMany({where:{restaurantId:id,categoryId,archivedAt:null},data:{archivedAt,available:false}});
    });
  }
  private async save(id:string,req:AuthRequest,input:unknown,itemId?:string){
    const data=itemInput(input),b=input as Record<string,unknown>;
    return this.mutate(id,req.actor.id,b.menuVersion,async tx=>{
      if(!await tx.menuCategory.findFirst({where:{id:data.categoryId,restaurantId:id,archivedAt:null}}))throw new BadRequestException('Invalid category');
      if(data.photoId&&!await tx.menuPhoto.findFirst({where:{id:data.photoId,restaurantId:id}}))throw new BadRequestException('Invalid photo');
      if(itemId){if((await tx.menuItem.updateMany({where:{id:itemId,restaurantId:id,archivedAt:null},data})).count!==1)throw new NotFoundException();}
      else{
        if(await tx.menuItem.count({where:{restaurantId:id,archivedAt:null}})>=1000)throw new BadRequestException('Maximum 1000 items');
        await tx.menuItem.create({data:{...data,restaurantId:id}});
      }
    });
  }
  @Post('restaurant-onboarding/:id/menu/items') @UseGuards(IdentityGuard)
  createItem(@Param('id') id:string,@Req() req:AuthRequest,@Body() input:unknown){return this.save(id,req,input);}
  @Post('restaurant-onboarding/:id/menu/items/:itemId') @UseGuards(IdentityGuard)
  editItem(@Param('id') id:string,@Param('itemId') itemId:string,@Req() req:AuthRequest,@Body() input:unknown){return this.save(id,req,input,itemId);}
  @Post('restaurant-onboarding/:id/menu/items/:itemId/archive') @UseGuards(IdentityGuard)
  async archiveItem(@Param('id') id:string,@Param('itemId') itemId:string,@Req() req:AuthRequest,@Body() input:unknown){
    const b=object(input,['menuVersion']);return this.mutate(id,req.actor.id,b.menuVersion,async tx=>{if((await tx.menuItem.updateMany({where:{id:itemId,restaurantId:id,archivedAt:null},data:{archivedAt:new Date(),available:false}})).count!==1)throw new NotFoundException();});
  }
  @Post('restaurant-onboarding/:id/menu/photos') @UseGuards(IdentityGuard)
  async upload(@Param('id') id:string,@Req() req:AuthRequest,@Body() input:unknown){
    await this.member(id,req.actor.id);const data=await normalizePhoto(input);const photoId=randomUUID(),key=`menus/${id}/${photoId}.jpg`;
    await this.storage.put(key,data);
    try{await this.db.menuPhoto.create({data:{id:photoId,restaurantId:id,objectKey:key,bytes:data.length}});}catch(e){await this.storage.remove(key).catch(()=>undefined);throw e;}
    return {id:photoId,photoUrl:`/restaurant-onboarding/${id}/menu/photos/${photoId}`};
  }
  private async photo(id:string,photoId:string){const photo=await this.db.menuPhoto.findFirst({where:{id:photoId,restaurantId:id}});if(!photo)throw new NotFoundException();return new StreamableFile(await this.storage.get(photo.objectKey),{type:'image/jpeg'});}
  @Get('restaurant-onboarding/:id/menu/photos/:photoId') @UseGuards(IdentityGuard) @Header('X-Content-Type-Options','nosniff')
  async privatePhoto(@Param('id') id:string,@Param('photoId') photoId:string,@Req() req:AuthRequest){await this.member(id,req.actor.id);return this.photo(id,photoId);}
  @Get('catalog/restaurants/:id/menu/photos/:photoId') @Header('X-Content-Type-Options','nosniff')
  async publicPhoto(@Param('id') id:string,@Param('photoId') photoId:string){
    await this.published(id);
    if(!await this.db.menuItem.findFirst({where:{restaurantId:id,photoId,available:true,archivedAt:null,category:{archivedAt:null}}}))throw new NotFoundException();
    return this.photo(id,photoId);
  }
}

