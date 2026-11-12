import { Module } from '@nestjs/common';
@Module({}) export class IdentityModule {}
// apps/api is now the identity service. Business services will be separate deployables.
export const DomainModules=[IdentityModule];
