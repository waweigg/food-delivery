import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { Database } from './database.js';
import { DomainModules } from './domains.js';
import { AuthService } from './auth.js';
import { SessionGuard } from './access.js';
import { IdentityController } from './identity.controller.js';
@Controller()
class HealthController {
  constructor(private readonly database:Database) {}
  @Get('health/live') live() { return {status:'ok'}; }
  @Get('health/ready') async ready() {
    try { await this.database.ready(); return {status:'ok'}; }
    catch { throw new ServiceUnavailableException('Service unavailable'); }
  }
  @Get('config') config() { return {orderingEnabled:false,maintenance:true}; }
}
@Module({imports:DomainModules,controllers:[HealthController,IdentityController],providers:[Database,AuthService,SessionGuard]})
export class AppModule {}
