import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../database';
import { PushService } from '../push/push.service';
import { ConfigService } from '../core/config';

type PushType = 'alert' | 'voip';

export type InviteCallResult = {
  callId: string;
  roomName: string;
  state: string;
  deduped: boolean;
  push: {
    sent: number;
    failed: number;
    invalidTokens: string[];
    voip: { sent: number; failed: number };
    alert: { sent: number; failed: number };
  };
};

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly pushService: PushService,
    private readonly configService: ConfigService,
  ) {}

  async inviteCall(params: {
    callerIdentity: string;
    callerName?: string;
    calleeIdentity: string;
    roomName?: string;
  }): Promise<InviteCallResult> {
    const roomName = params.roomName?.trim() || `call-${randomUUID()}`;
    await this.dbService.createRoomIfMissing(roomName);

    const existing = await this.dbService.findRingingCall(
      params.calleeIdentity,
      roomName,
      30,
    );

    // If there's an existing ringing call, reuse callId but still resend push
    const isDeduped = !!existing;
    let callId: string;
    let callState: string;

    if (existing) {
      callId = existing.callId;
      callState = 'ringing';
      this.logger.log(
        `inviteCall deduped caller=${params.callerIdentity} callee=${params.calleeIdentity} room=${roomName} callId=${callId} (resending push)`,
      );
    } else {
      const callerUser = await this.dbService.upsertUser(
        params.callerIdentity,
        params.callerName,
      );
      const calleeUser = await this.dbService.upsertUser(params.calleeIdentity);

      const call = await this.dbService.createCall({
        callerIdentity: params.callerIdentity,
        calleeIdentity: params.calleeIdentity,
        callerUserId: callerUser.id,
        calleeUserId: calleeUser.id,
        roomName,
      });
      callId = call.id;
      callState = call.state;
    }

    const payload = {
      callId,
      roomName,
      callerName: params.callerName ?? params.callerIdentity,
      callerIdentity: params.callerIdentity,
    };

    // Get all devices for the callee to determine push type
    const devices = await this.dbService.listAllDevicesByIdentity({
      identity: params.calleeIdentity,
    });

    let voipSent = 0;
    let voipFailed = 0;
    let alertSent = 0;
    let alertFailed = 0;
    const invalidTokens: string[] = [];

    // Separate devices into VoIP-capable and APNs-only
    const voipTokens: { token: string; env: string }[] = [];
    const apnsTokens: { token: string; env: string }[] = [];

    for (const device of devices) {
      if (device.supports_callkit && device.voip_token) {
        // iPhone or Cellular iPad: use VoIP Push
        voipTokens.push({ token: device.voip_token, env: device.env });
      } else if (device.apns_token) {
        // WiFi-only iPad or device without VoIP token: use APNs alert
        apnsTokens.push({ token: device.apns_token, env: device.env });
      }
    }

    // Send VoIP Push to CallKit-capable devices
    if (voipTokens.length > 0) {
      const voipResult = await this.pushService.sendPush({
        tokens: voipTokens,
        type: 'voip',
        payload,
      });
      voipSent = voipResult.sent;
      voipFailed = voipResult.failed;
      invalidTokens.push(...voipResult.invalidTokens);
      for (const token of voipResult.invalidTokens) {
        await this.dbService.invalidateToken('voip', token);
      }
    }

    // Send APNs alert to WiFi-only iPads
    if (apnsTokens.length > 0) {
      const callerDisplayName = params.callerName ?? params.callerIdentity;
      const apnsResult = await this.pushService.sendPush({
        tokens: apnsTokens,
        type: 'alert',
        title: '수신 전화',
        body: `${callerDisplayName}님이 전화 중`,
        payload,
        category: 'INCOMING_CALL',
        sound: 'ringtone.caf',
        interruptionLevel: 'time-sensitive',
      });
      alertSent = apnsResult.sent;
      alertFailed = apnsResult.failed;
      invalidTokens.push(...apnsResult.invalidTokens);
      for (const token of apnsResult.invalidTokens) {
        await this.dbService.invalidateToken('apns', token);
      }
    }

    const push = {
      sent: voipSent + alertSent,
      failed: voipFailed + alertFailed,
      invalidTokens,
      voip: { sent: voipSent, failed: voipFailed },
      alert: { sent: alertSent, failed: alertFailed },
    };

    this.logger.log(
      `inviteCall sent caller=${params.callerIdentity} callee=${params.calleeIdentity} room=${roomName} callId=${callId} deduped=${isDeduped} voipSent=${voipSent} voipFailed=${voipFailed} alertSent=${alertSent} alertFailed=${alertFailed}`,
    );

    return {
      callId,
      roomName,
      state: callState,
      deduped: isDeduped,
      push,
    };
  }

  async answerCall(callId: string) {
    this.logger.log(`answerCall callId=${callId}`);
    return this.dbService.updateCallState(callId, 'answered');
  }

  async endCall(callId: string) {
    this.logger.log(`endCall callId=${callId}`);
    return this.dbService.updateCallState(callId, 'ended');
  }

  async sendBroadcastPush(params: {
    type: PushType;
    title?: string;
    body?: string;
    payload?: Record<string, unknown>;
    env?: string;
  }) {
    const tokenType = params.type === 'voip' ? 'voip' : 'apns';
    const env = params.env
      ? this.configService.normalizeEnv(params.env)
      : undefined;
    const devices = await this.dbService.listDevices({ tokenType, env });
    const tokens = devices
      .map(d => ({
        token: (tokenType === 'voip' ? d.voip_token : d.apns_token) as string,
        env: d.env,
      }))
      .filter(t => t.token);
    const result = await this.pushService.sendPush({
      tokens,
      type: params.type,
      title: params.title,
      body: params.body,
      payload: params.payload,
    });
    for (const token of result.invalidTokens) {
      await this.dbService.invalidateToken(tokenType, token);
    }
    this.logger.log(
      `pushBroadcast type=${params.type} requested=${tokens.length} sent=${result.sent} failed=${result.failed} invalid=${result.invalidTokens.length}`,
    );
    return { ...result, requested: tokens.length };
  }

  async sendUserPush(params: {
    identity: string;
    type: PushType;
    title?: string;
    body?: string;
    payload?: Record<string, unknown>;
    env?: string;
  }) {
    const tokenType = params.type === 'voip' ? 'voip' : 'apns';
    const env = params.env
      ? this.configService.normalizeEnv(params.env)
      : undefined;
    const devices = await this.dbService.listDevicesByIdentity({
      identity: params.identity,
      tokenType,
      env,
    });
    const tokens = devices
      .map(d => ({
        token: (tokenType === 'voip' ? d.voip_token : d.apns_token) as string,
        env: d.env,
      }))
      .filter(t => t.token);
    const result = await this.pushService.sendPush({
      tokens,
      type: params.type,
      title: params.title,
      body: params.body,
      payload: params.payload,
    });
    for (const token of result.invalidTokens) {
      await this.dbService.invalidateToken(tokenType, token);
    }
    this.logger.log(
      `pushUser identity=${params.identity} type=${params.type} requested=${tokens.length} sent=${result.sent} failed=${result.failed} invalid=${result.invalidTokens.length}`,
    );
    return { ...result, requested: tokens.length };
  }

  async listRoomMembers(roomName: string) {
    const members = await this.dbService.listRoomMembers(roomName);
    return members.map(member => ({
      identity: member.identity,
      displayName: member.display_name,
      joinedAt: member.joined_at,
    }));
  }
}
