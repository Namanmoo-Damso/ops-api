import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { WardsManagementController } from './wards-management/wards-management.controller';
import { LocationsController } from './locations/locations.controller';
import { EmergenciesController } from './emergencies/emergencies.controller';
import { BeneficiariesController } from './beneficiaries/beneficiaries.controller';
import { AuthService } from '../auth';
import { CallsService } from '../calls';
import { AdminOrganizationGuard } from '../common';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
    }),
  ],
  controllers: [
    AdminAuthController,
    DashboardController,
    WardsManagementController,
    LocationsController,
    EmergenciesController,
    BeneficiariesController,
  ],
  providers: [AdminAuthService, AuthService, CallsService, AdminOrganizationGuard],
  exports: [AdminAuthService],
})
export class AdminModule {}
