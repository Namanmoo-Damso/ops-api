import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CareAlertsController } from './care-alerts.controller';
import { CareAlertsService } from './care-alerts.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PushModule } from '../push/push.module';
import { AuthModule } from '../auth';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    PushModule,
    AuthModule,
  ],
  controllers: [CareAlertsController],
  providers: [CareAlertsService],
  exports: [CareAlertsService],
})
export class CareAlertsModule {}
