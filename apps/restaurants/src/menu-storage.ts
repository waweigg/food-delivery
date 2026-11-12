import {BadRequestException,Injectable,OnModuleDestroy,ServiceUnavailableException} from '@nestjs/common';
import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand,HeadBucketCommand,CreateBucketCommand} from '@aws-sdk/client-s3';
import sharp from 'sharp';

export const MAX_PHOTO_BYTES=5*1024*1024;
export async function normalizePhoto(input:unknown):Promise<Buffer>{
  if(!Buffer.isBuffer(input)||!input.length||input.length>MAX_PHOTO_BYTES)throw new BadRequestException('Photo must be at most 5 MiB');
  try{
    const image=sharp(input,{limitInputPixels:20_000_000,failOn:'warning'});
    const meta=await image.metadata();
    if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error('Unsupported image');
    // Decode and re-encode; never serve uploaded bytes, metadata or filenames.
    return await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
  }catch{throw new BadRequestException('Use a valid, single-frame JPEG, PNG or WebP image up to 20 megapixels');}
}
@Injectable()
export class MenuStorage implements OnModuleDestroy {
  private client?:S3Client;
  private connection(){
    const bucket=process.env.MENU_S3_BUCKET;
    const endpoint=process.env.MENU_S3_ENDPOINT;
    if(!bucket||!endpoint||!process.env.MENU_S3_ACCESS_KEY||!process.env.MENU_S3_SECRET_KEY)throw new ServiceUnavailableException('Photo storage is not configured');
    if(!this.client)this.client=new S3Client({endpoint,region:process.env.MENU_S3_REGION??'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.MENU_S3_ACCESS_KEY,secretAccessKey:process.env.MENU_S3_SECRET_KEY},maxAttempts:2});
    return {client:this.client,bucket};
  }
  async initialize(){
    const {client,bucket}=this.connection();
    try{await client.send(new HeadBucketCommand({Bucket:bucket}));}catch(e){
      if((e as {$metadata?:{httpStatusCode:number}}).$metadata?.httpStatusCode!==404)throw e;
      await client.send(new CreateBucketCommand({Bucket:bucket}));
    }
  }
  async put(key:string,body:Buffer){
    const {client,bucket}=this.connection();
    try{await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:'image/jpeg'}),{abortSignal:AbortSignal.timeout(15000)});}catch{throw new ServiceUnavailableException('Photo storage unavailable');}
  }
  async get(key:string){
    const {client,bucket}=this.connection();
    try{const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});if(!result.Body)throw new Error();return Buffer.from(await result.Body.transformToByteArray());}catch{throw new ServiceUnavailableException('Photo unavailable');}
  }
  async remove(key:string){const {client,bucket}=this.connection();await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(15000)});}
  onModuleDestroy(){this.client?.destroy();}
}
