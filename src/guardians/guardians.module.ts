import { Module } from '@nestjs/common';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';
import { AuthService } from '../auth';

@Module({
  controllers: [GuardiansController],
  providers: [GuardiansService, AuthService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
