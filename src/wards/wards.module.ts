import { Module } from '@nestjs/common';
import { WardsController } from './wards.controller';
import { WardsService } from './wards.service';
import { AuthService } from '../auth';

@Module({
  controllers: [WardsController],
  providers: [WardsService, AuthService],
  exports: [WardsService],
})
export class WardsModule {}
