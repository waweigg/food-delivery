import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readConfig } from './config.js';
@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  constructor() { super({adapter:new PrismaPg({connectionString:readConfig().databaseUrl})}); }
  async ready() {
    const identity = await this.environmentIdentity.findUnique({where:{id:'singleton'}});
    if (identity?.name !== readConfig().environment) throw new Error('Database environment identity mismatch');
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
