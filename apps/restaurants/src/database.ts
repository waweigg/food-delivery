import {Injectable,OnModuleDestroy} from '@nestjs/common';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {config} from './config.js';
@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  constructor(){super({adapter:new PrismaPg({connectionString:config().databaseUrl})});}
  async ready(){const row=await this.serviceIdentity.findUnique({where:{id:'singleton'}});if(row?.environment!==config().environment || row.service!=='restaurants') throw new Error('Wrong service or environment database');}
  async onModuleDestroy(){await this.$disconnect();}
}
