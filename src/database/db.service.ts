/**
 * DbService - Facade Pattern
 *
 * 기존 인터페이스를 100% 유지하면서 Repository로 위임
 * 모든 기존 코드가 수정 없이 동작하도록 보장
 */
import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import {
  UserRepository,
  DeviceRepository,
  RoomRepository,
  CallRepository,
  GuardianRepository,
  WardRepository,
  AdminRepository,
  EmergencyRepository,
  LocationRepository,
  DashboardRepository,
} from './repositories';
import type {
  BeneficiaryDetailItem,
  BeneficiaryListResult,
} from './repositories/ward.repository';

// Re-export types for backward compatibility
export type {
  UserRow,
  GuardianRow,
  WardRow,
  DeviceRow,
  RoomMemberRow,
} from './types';

@Injectable()
export class DbService implements OnModuleDestroy {
  constructor(
    @Inject('DATABASE_POOL') private readonly pool: Pool,
    private readonly users: UserRepository,
    private readonly devices: DeviceRepository,
    private readonly rooms: RoomRepository,
    private readonly calls: CallRepository,
    private readonly guardians: GuardianRepository,
    private readonly wards: WardRepository,
    private readonly admins: AdminRepository,
    private readonly emergencies: EmergencyRepository,
    private readonly locations: LocationRepository,
    private readonly dashboard: DashboardRepository,
  ) {}

  async onModuleDestroy() {
    await this.pool.end();
  }

  // ============================================================
  // User methods
  // ============================================================
  async upsertUser(identity: string, displayName?: string) {
    return this.users.upsert(identity, displayName);
  }

  async findUserById(userId: string) {
    return this.users.findById(userId);
  }

  async findUserByKakaoId(kakaoId: string) {
    return this.users.findByKakaoId(kakaoId);
  }

  async findUserByIdentity(identity: string) {
    return this.users.findByIdentity(identity);
  }

  async updateUserType(userId: string, userType: 'guardian' | 'ward') {
    return this.users.updateType(userId, userType);
  }

  async createUserWithKakao(params: {
    kakaoId: string;
    email: string | null;
    nickname: string | null;
    profileImageUrl: string | null;
    userType: 'guardian' | 'ward' | null;
  }) {
    return this.users.createWithKakao(params);
  }

  async deleteUser(userId: string) {
    return this.users.delete(userId, uid => this.guardians.findByUserId(uid));
  }

  async saveRefreshToken(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.users.saveRefreshToken(params);
  }

  async findRefreshToken(tokenHash: string) {
    return this.users.findRefreshToken(tokenHash);
  }

  async deleteRefreshToken(tokenHash: string) {
    return this.users.deleteRefreshToken(tokenHash);
  }

  async deleteUserRefreshTokens(userId: string) {
    return this.users.deleteUserRefreshTokens(userId);
  }

  // ============================================================
  // Device methods
  // ============================================================
  async upsertDevice(params: {
    identity: string;
    displayName?: string;
    platform: string;
    env: string;
    apnsToken?: string;
    voipToken?: string;
    supportsCallKit?: boolean;
  }) {
    // 익명 사용자 생성 차단 - 기존 사용자만 허용
    const user = await this.findUserByIdentity(params.identity);
    if (!user) {
      throw new Error('로그인이 필요합니다');
    }
    return this.devices.upsert(user, params);
  }

  async listDevicesByIdentity(params: {
    identity: string;
    env?: string;
    tokenType?: 'apns' | 'voip';
  }) {
    return this.devices.listByIdentity(params);
  }

  async listAllDevicesByIdentity(params: { identity: string; env?: string }) {
    return this.devices.listAllByIdentity(params);
  }

  async findUserByDeviceToken(params: {
    tokenType: 'apns' | 'voip';
    token: string;
    env?: string;
  }) {
    return this.devices.findUserByToken(params);
  }

  async listDevices(params: { tokenType: 'apns' | 'voip'; env?: string }) {
    return this.devices.list(params);
  }

  async invalidateToken(tokenType: 'apns' | 'voip', token: string) {
    return this.devices.invalidateToken(tokenType, token);
  }

  async deleteDevicesByUserId(userId: string) {
    return this.devices.deleteByUserId(userId);
  }

  // ============================================================
  // Room methods
  // ============================================================
  async listRoomMembers(roomName: string) {
    return this.rooms.listMembers(roomName);
  }

  async createRoomIfMissing(roomName: string) {
    return this.rooms.createIfMissing(roomName);
  }

  async upsertRoomMember(params: {
    roomName: string;
    userId: string;
    role: string;
  }) {
    return this.rooms.upsertMember(params);
  }

  async deleteRoomMembersByUserId(userId: string) {
    return this.rooms.deleteMembersByUserId(userId);
  }

  // ============================================================
  // Call methods
  // ============================================================
  async findRingingCall(
    calleeIdentity: string,
    roomName: string,
    seconds: number,
  ) {
    return this.calls.findRinging(calleeIdentity, roomName, seconds);
  }

  async createCall(params: {
    callerIdentity: string;
    calleeIdentity: string;
    callerUserId?: string;
    calleeUserId?: string;
    roomName: string;
  }) {
    return this.calls.create(params);
  }

  async updateCallState(callId: string, state: 'answered' | 'ended') {
    return this.calls.updateState(callId, state);
  }

  async getRecentCallSummaries(wardId: string, limit: number = 5) {
    return this.calls.getRecentSummaries(wardId, limit);
  }

  async getCallSummariesForReport(wardId: string, days: number) {
    return this.calls.getSummariesForReport(wardId, days);
  }

  async getMissedCalls(hoursAgo: number = 1) {
    return this.calls.getMissed(hoursAgo);
  }

  async getCallWithWardInfo(callId: string) {
    return this.calls.getWithWardInfo(callId);
  }

  async getCallForAnalysis(callId: string) {
    return this.calls.getForAnalysis(callId);
  }

  async createCallSummary(params: {
    callId: string;
    wardId: string | null;
    summary: string;
    mood: string;
    moodScore: number;
    tags: string[];
    healthKeywords: Record<string, unknown>;
  }) {
    return this.calls.createSummary(params);
  }

  async getRecentPainMentions(wardId: string, days: number) {
    return this.calls.getRecentPainMentions(wardId, days);
  }

  async getCallSummary(callId: string) {
    return this.calls.getSummary(callId);
  }

  // ============================================================
  // Guardian methods
  // ============================================================
  async createGuardian(params: {
    userId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }) {
    return this.guardians.create(params);
  }

  async findGuardianByUserId(userId: string) {
    return this.guardians.findByUserId(userId);
  }

  async findGuardianById(guardianId: string) {
    return this.guardians.findById(guardianId);
  }

  async findGuardianByWardEmail(wardEmail: string) {
    return this.guardians.findByWardEmail(wardEmail);
  }

  async getGuardianWards(guardianId: string) {
    return this.guardians.getWards(guardianId);
  }

  async createGuardianWardRegistration(params: {
    guardianId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }) {
    return this.guardians.createWardRegistration(params);
  }

  async findGuardianWardRegistration(id: string, guardianId: string) {
    return this.guardians.findWardRegistration(id, guardianId);
  }

  async updateGuardianWardRegistration(params: {
    id: string;
    guardianId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }) {
    return this.guardians.updateWardRegistration(params);
  }

  async deleteGuardianWardRegistration(id: string, guardianId: string) {
    return this.guardians.deleteWardRegistration(id, guardianId);
  }

  async updateGuardianPrimaryWard(params: {
    guardianId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }) {
    return this.guardians.updatePrimaryWard(params);
  }

  async unlinkPrimaryWard(guardianId: string) {
    return this.guardians.unlinkPrimaryWard(guardianId);
  }

  async getHealthAlerts(guardianId: string, limit: number = 5) {
    return this.guardians.getHealthAlerts(guardianId, limit);
  }

  async createHealthAlert(params: {
    wardId: string;
    guardianId: string;
    alertType: 'warning' | 'info';
    message: string;
  }) {
    return this.guardians.createHealthAlert(params);
  }

  async getNotificationSettings(userId: string) {
    return this.guardians.getNotificationSettings(userId);
  }

  async getGuardianNotificationSettings(guardianUserId: string) {
    return this.guardians.getGuardianNotificationSettings(guardianUserId);
  }

  async upsertNotificationSettings(params: {
    userId: string;
    callReminder?: boolean;
    callComplete?: boolean;
    healthAlert?: boolean;
  }) {
    return this.guardians.upsertNotificationSettings(params);
  }

  // ============================================================
  // Ward methods
  // ============================================================
  async createWard(params: {
    userId: string;
    phoneNumber: string;
    guardianId: string | null;
  }) {
    return this.wards.create(params);
  }

  async findWardByUserId(userId: string) {
    return this.wards.findByUserId(userId);
  }

  async findWardById(wardId: string) {
    return this.wards.findById(wardId);
  }

  async findWardByGuardianId(guardianId: string) {
    return this.wards.findByGuardianId(guardianId);
  }

  async getWardCallStats(wardId: string) {
    return this.wards.getCallStats(wardId);
  }

  async getWardWeeklyCallChange(wardId: string) {
    return this.wards.getWeeklyCallChange(wardId);
  }

  async getWardMoodStats(wardId: string) {
    return this.wards.getMoodStats(wardId);
  }

  async getEmotionTrend(wardId: string, days: number) {
    return this.wards.getEmotionTrend(wardId, days);
  }

  async getHealthKeywordStats(wardId: string, days: number) {
    return this.wards.getHealthKeywordStats(wardId, days);
  }

  async getTopTopics(wardId: string, days: number, limit: number = 5) {
    return this.wards.getTopTopics(wardId, days, limit);
  }

  async updateWardSettings(params: {
    wardId: string;
    aiPersona?: string;
    weeklyCallCount?: number;
    callDurationMinutes?: number;
  }) {
    return this.wards.updateSettings(params);
  }

  async getWardWithGuardianInfo(wardId: string) {
    return this.wards.getWithGuardianInfo(wardId);
  }

  async findOrganizationWard(organizationId: string, email: string) {
    return this.wards.findOrganizationWard(organizationId, email);
  }

  async findPendingOrganizationWardByEmail(email: string) {
    return this.wards.findPendingOrganizationWardByEmail(email);
  }

  async linkOrganizationWard(params: {
    organizationWardId: string;
    wardId: string;
  }) {
    return this.wards.linkOrganizationWard(params);
  }

  async updateWardOrganization(params: {
    wardId: string;
    organizationId: string;
  }) {
    return this.wards.updateWardOrganization(params);
  }

  async createOrganizationWard(params: {
    organizationId: string;
    email: string;
    phoneNumber: string;
    name: string;
    birthDate: string | null;
    address: string | null;
    uploadedByAdminId?: string;
    notes?: string;
  }) {
    return this.wards.createOrganizationWard(params);
  }

  async getOrganizationWards(organizationId: string) {
    return this.wards.getOrganizationWards(organizationId);
  }

  async getMyManagedWards(adminId: string) {
    return this.wards.getMyManagedWards(adminId);
  }

  async getMyManagedWardsStats(adminId: string) {
    return this.wards.getMyManagedWardsStats(adminId);
  }

  async getUpcomingCallSchedules(
    dayOfWeek: number,
    startTime: string,
    endTime: string,
  ) {
    return this.wards.getUpcomingCallSchedules(dayOfWeek, startTime, endTime);
  }

  async markReminderSent(scheduleId: string) {
    return this.wards.markReminderSent(scheduleId);
  }

  async listOrganizationBeneficiaries(params: {
    organizationId: string;
    search?: string;
    riskOnly?: boolean;
    page: number;
    pageSize: number;
  }): Promise<BeneficiaryListResult> {
    return this.wards.listOrganizationBeneficiaries(params);
  }

  async deleteOrganizationBeneficiary(params: {
    organizationId: string;
    beneficiaryId: string;
  }): Promise<boolean> {
    const info = await this.wards.findOrganizationBeneficiaryForDeletion(params);
    if (!info) return false;

    if (info.ward_user_id) {
      await this.deleteUser(info.ward_user_id);
    }

    return this.wards.deleteOrganizationBeneficiary(params);
  }

  async getOrganizationBeneficiaryDetail(params: {
    organizationId: string;
    beneficiaryId: string;
  }): Promise<BeneficiaryDetailItem | null> {
    return this.wards.getOrganizationBeneficiaryDetail(params);
  }

  // ============================================================
  // Admin methods
  // ============================================================
  async findAdminByProviderId(provider: string, providerId: string) {
    return this.admins.findByProviderId(provider, providerId);
  }

  async findAdminByEmail(email: string) {
    return this.admins.findByEmail(email);
  }

  async findAdminById(adminId: string) {
    return this.admins.findById(adminId);
  }

  async createAdmin(params: {
    email: string;
    name?: string;
    provider: string;
    providerId: string;
    role?: string;
    organizationId?: string;
  }) {
    return this.admins.create(params);
  }

  async updateAdminLastLogin(adminId: string) {
    return this.admins.updateLastLogin(adminId);
  }

  async getAdminPermissions(adminId: string) {
    return this.admins.getPermissions(adminId);
  }

  async createAdminRefreshToken(
    adminId: string,
    tokenHash: string,
    expiresAt: Date,
  ) {
    return this.admins.createRefreshToken(adminId, tokenHash, expiresAt);
  }

  async findAdminRefreshToken(tokenHash: string) {
    return this.admins.findRefreshToken(tokenHash);
  }

  async deleteAdminRefreshToken(tokenHash: string) {
    return this.admins.deleteRefreshToken(tokenHash);
  }

  async deleteAllAdminRefreshTokens(adminId: string) {
    return this.admins.deleteAllRefreshTokens(adminId);
  }

  async getAllAdmins() {
    return this.admins.getAll();
  }

  async updateAdminRole(
    adminId: string,
    role: string,
    organizationId?: string,
  ) {
    return this.admins.updateRole(adminId, role, organizationId);
  }

  async updateAdminActiveStatus(adminId: string, isActive: boolean) {
    return this.admins.updateActiveStatus(adminId, isActive);
  }

  async updateAdminOrganization(adminId: string, organizationId: string) {
    return this.admins.updateOrganization(adminId, organizationId);
  }

  async findOrganization(organizationId: string) {
    return this.admins.findOrganization(organizationId);
  }

  async findOrganizationById(organizationId: string) {
    return this.admins.findOrganization(organizationId);
  }

  async listAllOrganizations() {
    return this.admins.listAllOrganizations();
  }

  async findOrCreateOrganization(name: string) {
    return this.admins.findOrCreateOrganization(name);
  }

  // ============================================================
  // Emergency methods
  // ============================================================
  async createEmergency(params: {
    wardId: string;
    type: 'manual' | 'ai_detected' | 'geofence' | 'admin';
    latitude?: number;
    longitude?: number;
    message?: string;
  }) {
    return this.emergencies.create(params);
  }

  async updateEmergencyGuardianNotified(emergencyId: string) {
    return this.emergencies.updateGuardianNotified(emergencyId);
  }

  async findNearbyAgencies(
    latitude: number,
    longitude: number,
    radiusKm: number = 5,
    limit: number = 5,
  ) {
    return this.emergencies.findNearbyAgencies(
      latitude,
      longitude,
      radiusKm,
      limit,
    );
  }

  async createEmergencyContact(params: {
    emergencyId: string;
    agencyId: string;
    distanceKm: number;
    responseStatus?: 'pending' | 'answered' | 'dispatched' | 'failed';
  }) {
    return this.emergencies.createContact(params);
  }

  async getEmergencyById(emergencyId: string) {
    return this.emergencies.getById(emergencyId);
  }

  async getEmergencies(params: {
    status?: 'active' | 'resolved' | 'false_alarm';
    wardId?: string;
    limit?: number;
  }) {
    return this.emergencies.getList(params);
  }

  async getEmergencyContacts(emergencyId: string) {
    return this.emergencies.getContacts(emergencyId);
  }

  async resolveEmergency(params: {
    emergencyId: string;
    resolvedBy: string;
    status: 'resolved' | 'false_alarm';
    resolutionNote?: string;
  }) {
    return this.emergencies.resolve(params);
  }

  // ============================================================
  // Location methods
  // ============================================================
  async createWardLocation(params: {
    wardId: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    recordedAt: Date;
  }) {
    return this.locations.createWardLocation(params);
  }

  async upsertWardCurrentLocation(params: {
    wardId: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    status?: 'normal' | 'warning' | 'emergency';
  }) {
    return this.locations.upsertCurrentLocation(params);
  }

  async getAllWardCurrentLocations(organizationId?: string) {
    return this.locations.getAllCurrentLocations(organizationId);
  }

  async getWardLocationHistory(params: {
    wardId: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }) {
    return this.locations.getHistory(params);
  }

  async getWardCurrentLocation(wardId: string) {
    return this.locations.getCurrentLocation(wardId);
  }

  async updateWardLocationStatus(
    wardId: string,
    status: 'normal' | 'warning' | 'emergency',
  ) {
    return this.locations.updateStatus(wardId, status);
  }

  // ============================================================
  // Dashboard methods
  // ============================================================
  async getDashboardOverview() {
    return this.dashboard.getOverview();
  }

  async getTodayStats() {
    return this.dashboard.getTodayStats();
  }

  async getWeeklyTrend() {
    return this.dashboard.getWeeklyTrend();
  }

  async getMoodDistribution() {
    return this.dashboard.getMoodDistribution();
  }

  async getHealthAlertsSummary() {
    return this.dashboard.getHealthAlertsSummary();
  }

  async getTopHealthKeywords(limit: number = 5) {
    return this.dashboard.getTopHealthKeywords(limit);
  }

  async getOrganizationStats() {
    return this.dashboard.getOrganizationStats();
  }

  async getRealtimeStats() {
    return this.dashboard.getRealtimeStats();
  }

  async getRecentActivity(limit: number = 10) {
    return this.dashboard.getRecentActivity(limit);
  }
}
