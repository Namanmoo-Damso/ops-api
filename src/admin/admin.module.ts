import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { WardsManagementController } from './wards-management/wards-management.controller';
import { WardsManagementService } from './wards-management/wards-management.service';
import { LocationsController } from './locations/locations.controller';
import { EmergenciesController } from './emergencies/emergencies.controller';
import { BeneficiariesController } from './beneficiaries/beneficiaries.controller';
import { StaffController, StaffService } from './staff';
import { SettingsController, SettingsService } from './settings';
import { BulletinsController, BulletinsService } from './bulletins';
import { NotificationsController, NotificationsService } from './notifications';
import { AuthService } from '../auth';
import { CallsService } from '../calls';
import { AdminOrganizationGuard } from '../common';
import { CsvHeaderMatcherService } from './wards-management/csv-header-matcher.service';

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
    StaffController,
    SettingsController,
    BulletinsController,
    NotificationsController,
  ],
  providers: [
    AdminAuthService,
    AuthService,
    CallsService,
    AdminOrganizationGuard,
    CsvHeaderMatcherService,
    WardsManagementService,
    StaffService,
    SettingsService,
    BulletinsService,
    NotificationsService,
  ],
  exports: [
    AdminAuthService,
    StaffService,
    SettingsService,
    BulletinsService,
    NotificationsService,
    WardsManagementService,
  ],
})
export class AdminModule {}
