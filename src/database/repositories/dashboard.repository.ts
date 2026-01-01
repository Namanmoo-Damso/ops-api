/**
 * Dashboard Repository
 * 대시보드 통계 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { Prisma } from '../../generated/prisma';

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const result = await this.prisma.$queryRaw<
      Array<{
        total_wards: bigint;
        active_wards: bigint;
        total_guardians: bigint;
        total_organizations: bigint;
        total_calls: bigint;
        total_call_minutes: number;
      }>
    >`
      SELECT
        (SELECT count(*) FROM wards) as total_wards,
        (SELECT count(DISTINCT w.id) FROM wards w
         JOIN ward_current_locations wcl ON w.id = wcl.ward_id
         WHERE wcl.last_updated > now() - interval '24 hours') as active_wards,
        (SELECT count(*) FROM guardians) as total_guardians,
        (SELECT count(*) FROM organizations) as total_organizations,
        (SELECT count(*) FROM calls WHERE state = 'ended') as total_calls,
        (SELECT coalesce(sum(extract(epoch from (ended_at - answered_at))/60), 0)
         FROM calls WHERE state = 'ended' AND answered_at IS NOT NULL) as total_call_minutes
    `;

    const row = result[0];
    return {
      totalWards: Number(row.total_wards),
      activeWards: Number(row.active_wards),
      totalGuardians: Number(row.total_guardians),
      totalOrganizations: Number(row.total_organizations),
      totalCalls: Number(row.total_calls),
      totalCallMinutes: Math.round(Number(row.total_call_minutes)),
    };
  }

  async getTodayStats() {
    const result = await this.prisma.$queryRaw<
      Array<{
        calls: bigint;
        avg_duration: number | null;
        emergencies: bigint;
        new_registrations: bigint;
      }>
    >`
      SELECT
        (SELECT count(*) FROM calls
         WHERE created_at >= current_date AND state = 'ended') as calls,
        (SELECT avg(extract(epoch from (ended_at - answered_at))/60)
         FROM calls
         WHERE created_at >= current_date AND state = 'ended' AND answered_at IS NOT NULL) as avg_duration,
        (SELECT count(*) FROM emergencies
         WHERE created_at >= current_date) as emergencies,
        (SELECT count(*) FROM wards
         WHERE created_at >= current_date) as new_registrations
    `;

    const row = result[0];
    return {
      calls: Number(row.calls),
      avgDuration: Math.round(Number(row.avg_duration || 0)),
      emergencies: Number(row.emergencies),
      newRegistrations: Number(row.new_registrations),
    };
  }

  async getWeeklyTrend() {
    const result = await this.prisma.$queryRaw<
      Array<{
        day: string;
        day_label: string;
        calls: bigint;
        emergencies: bigint;
      }>
    >`
      WITH days AS (
        SELECT generate_series(
          current_date - interval '6 days',
          current_date,
          '1 day'::interval
        )::date as day
      )
      SELECT
        d.day::text,
        to_char(d.day, 'Dy') as day_label,
        coalesce((
          SELECT count(*) FROM calls c
          WHERE c.created_at::date = d.day AND c.state = 'ended'
        ), 0) as calls,
        coalesce((
          SELECT count(*) FROM emergencies e
          WHERE e.created_at::date = d.day
        ), 0) as emergencies
      FROM days d
      ORDER BY d.day
    `;

    const dayLabels: Record<string, string> = {
      Mon: '월',
      Tue: '화',
      Wed: '수',
      Thu: '목',
      Fri: '금',
      Sat: '토',
      Sun: '일',
    };

    return {
      calls: result.map(r => Number(r.calls)),
      emergencies: result.map(r => Number(r.emergencies)),
      labels: result.map(r => dayLabels[r.day_label] || r.day_label),
    };
  }

  async getMoodDistribution() {
    const [positiveCount, neutralCount, negativeCount] = await Promise.all([
      this.prisma.callSummary.count({ where: { mood: 'positive' } }),
      this.prisma.callSummary.count({ where: { mood: 'neutral' } }),
      this.prisma.callSummary.count({ where: { mood: 'negative' } }),
    ]);

    const total = positiveCount + neutralCount + negativeCount;

    if (total === 0) {
      return { positive: 0, neutral: 0, negative: 0 };
    }

    return {
      positive: Math.round((positiveCount / total) * 100),
      neutral: Math.round((neutralCount / total) * 100),
      negative: Math.round((negativeCount / total) * 100),
    };
  }

  async getHealthAlertsSummary() {
    const [warningCount, infoCount, unreadCount] = await Promise.all([
      this.prisma.healthAlert.count({ where: { alertType: 'warning' } }),
      this.prisma.healthAlert.count({ where: { alertType: 'info' } }),
      this.prisma.healthAlert.count({ where: { isRead: false } }),
    ]);

    return {
      warning: warningCount,
      info: infoCount,
      unread: unreadCount,
    };
  }

  async getTopHealthKeywords(limit: number = 5) {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const summaries = await this.prisma.callSummary.findMany({
      where: {
        healthKeywords: { not: Prisma.DbNull },
        createdAt: { gt: cutoff },
      },
      select: { healthKeywords: true },
    });

    const keywordCounts: Record<string, number> = {};
    const keywordLabels: Record<string, string> = {
      pain: '통증',
      sleep: '수면',
      meal: '식사',
      medication: '약 복용',
    };

    for (const row of summaries) {
      const keywords = row.healthKeywords as Record<string, unknown> | null;
      if (keywords) {
        for (const [key, value] of Object.entries(keywords)) {
          if (typeof value === 'number') {
            keywordCounts[key] = (keywordCounts[key] || 0) + value;
          } else if (value) {
            keywordCounts[key] = (keywordCounts[key] || 0) + 1;
          }
        }
      }
    }

    return Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([keyword, count]) => ({
        keyword: keywordLabels[keyword] || keyword,
        count,
      }));
  }

  async getOrganizationStats() {
    const result = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        wards: bigint;
        calls: bigint;
      }>
    >`
      SELECT
        o.id,
        o.name,
        (SELECT count(*) FROM wards w WHERE w.organization_id = o.id) as wards,
        (SELECT count(*) FROM calls c
         JOIN wards w ON c.callee_user_id = w.user_id
         WHERE w.organization_id = o.id AND c.state = 'ended') as calls
      FROM organizations o
      ORDER BY wards DESC
    `;

    return result.map(r => ({
      id: r.id,
      name: r.name,
      wards: Number(r.wards),
      calls: Number(r.calls),
    }));
  }

  async getRealtimeStats() {
    const [activeCalls, onlineWards, pendingEmergencies] = await Promise.all([
      this.prisma.call.count({ where: { state: 'answered' } }),
      this.prisma.wardCurrentLocation.count({
        where: {
          lastUpdated: { gt: new Date(Date.now() - 5 * 60 * 1000) },
        },
      }),
      this.prisma.emergency.count({ where: { status: 'active' } }),
    ]);

    return {
      activeCalls,
      onlineWards,
      pendingEmergencies,
    };
  }

  async getRecentActivity(limit: number = 10) {
    const result = await this.prisma.$queryRaw<
      Array<{
        type: string;
        ward_name: string | null;
        duration: number | null;
        time: string;
        created_at: Date;
      }>
    >`
      (
        SELECT
          'call_started' as type,
          u.nickname as ward_name,
          null::float as duration,
          to_char(c.created_at, 'HH24:MI') as time,
          c.created_at
        FROM calls c
        JOIN users u ON c.callee_user_id = u.id
        WHERE c.state IN ('ringing', 'answered')
          AND c.created_at > now() - interval '1 hour'
      )
      UNION ALL
      (
        SELECT
          'call_ended' as type,
          u.nickname as ward_name,
          extract(epoch from (c.ended_at - c.answered_at))/60 as duration,
          to_char(c.ended_at, 'HH24:MI') as time,
          c.ended_at as created_at
        FROM calls c
        JOIN users u ON c.callee_user_id = u.id
        WHERE c.state = 'ended'
          AND c.ended_at > now() - interval '1 hour'
          AND c.answered_at IS NOT NULL
      )
      UNION ALL
      (
        SELECT
          'emergency' as type,
          u.nickname as ward_name,
          null::float as duration,
          to_char(e.created_at, 'HH24:MI') as time,
          e.created_at
        FROM emergencies e
        JOIN wards w ON e.ward_id = w.id
        JOIN users u ON w.user_id = u.id
        WHERE e.created_at > now() - interval '24 hours'
      )
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return result.map(r => ({
      type: r.type,
      wardName: r.ward_name || '알 수 없음',
      duration: r.duration ? Math.round(r.duration) : undefined,
      time: r.time,
    }));
  }
}
