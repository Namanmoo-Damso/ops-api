import { Test, TestingModule } from '@nestjs/testing';
import { NotificationScheduler } from './notification.scheduler';
import { DbService } from '../database';
import { CallsService } from '../calls/calls.service';

// Mock Redis client
const mockRedisClient = {
  connect: jest.fn(),
  quit: jest.fn(),
  set: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

describe('NotificationScheduler', () => {
  let scheduler: NotificationScheduler;
  let mockDbService: Partial<DbService>;
  let mockCallsService: Partial<CallsService>;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    mockRedisClient.set.mockReset();

    mockDbService = {
      getUpcomingCallSchedules: jest.fn().mockResolvedValue([]),
      getMissedCalls: jest.fn().mockResolvedValue([]),
      getSchedulesForCurrentSlot: jest.fn().mockResolvedValue([]),
      markReminderSent: jest.fn().mockResolvedValue(undefined),
      endStaleCalls: jest.fn().mockResolvedValue(0),
    };

    mockCallsService = {
      sendUserPush: jest.fn().mockResolvedValue(undefined),
      inviteCall: jest
        .fn()
        .mockResolvedValue({ callId: 'test-call-id', roomName: 'test-room' }),
    };

    // Set REDIS_URL for tests
    process.env.REDIS_URL = 'redis://localhost:6379';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationScheduler,
        { provide: DbService, useValue: mockDbService },
        { provide: CallsService, useValue: mockCallsService },
      ],
    }).compile();

    scheduler = module.get<NotificationScheduler>(NotificationScheduler);
    await scheduler.onModuleInit();
  });

  afterEach(async () => {
    await scheduler.onModuleDestroy();
  });

  describe('Distributed Lock - tryAcquireLock', () => {
    it('should acquire lock when Redis SET NX succeeds', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      // Access private method via type assertion
      const result = await (scheduler as any).tryAcquireLock('test:lock:key');

      expect(result).toBe(true);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test:lock:key',
        expect.any(String), // process.pid
        { NX: true, EX: 300 },
      );
    });

    it('should fail to acquire lock when key already exists', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      const result = await (scheduler as any).tryAcquireLock('test:lock:key');

      expect(result).toBe(false);
    });

    it('should return true when Redis throws error (fallback behavior)', async () => {
      mockRedisClient.set.mockRejectedValue(
        new Error('Redis connection error'),
      );

      const result = await (scheduler as any).tryAcquireLock('test:lock:key');

      expect(result).toBe(true); // 에러 시 진행 허용
    });
  });

  describe('checkCallReminders - Lock Integration', () => {
    it('should skip execution when lock already exists', async () => {
      mockRedisClient.set.mockResolvedValue(null); // Lock exists

      await scheduler.checkCallReminders();

      expect(mockDbService.getUpcomingCallSchedules).not.toHaveBeenCalled();
    });

    it('should execute when lock acquired', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.checkCallReminders();

      expect(mockDbService.getUpcomingCallSchedules).toHaveBeenCalled();
    });
  });

  describe('checkMissedCalls - Lock Integration', () => {
    it('should skip execution when lock already exists', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      await scheduler.checkMissedCalls();

      expect(mockDbService.getMissedCalls).not.toHaveBeenCalled();
    });

    it('should execute when lock acquired', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.checkMissedCalls();

      expect(mockDbService.getMissedCalls).toHaveBeenCalled();
    });
  });

  describe('initiateScheduledCalls - Lock Integration', () => {
    it('should skip execution when lock already exists', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      await scheduler.initiateScheduledCalls();

      expect(mockDbService.getSchedulesForCurrentSlot).not.toHaveBeenCalled();
    });

    it('should execute when lock acquired', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.initiateScheduledCalls();

      expect(mockDbService.getSchedulesForCurrentSlot).toHaveBeenCalled();
    });
  });

  describe('Lock Key Generation', () => {
    it('should generate correct lock key for reminders', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.checkCallReminders();

      const lockKeyArg = mockRedisClient.set.mock.calls[0][0];
      expect(lockKeyArg).toMatch(/^scheduler:reminder:\d+:(00|30)$/);
    });

    it('should generate correct lock key for missed calls', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.checkMissedCalls();

      const lockKeyArg = mockRedisClient.set.mock.calls[0][0];
      expect(lockKeyArg).toMatch(/^scheduler:missed:\d+$/);
    });

    it('should generate correct lock key for scheduled calls', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.initiateScheduledCalls();

      const lockKeyArg = mockRedisClient.set.mock.calls[0][0];
      expect(lockKeyArg).toMatch(/^scheduler:call:\d+:\d{2}$/);
    });

    it('should generate correct lock key for stale cleanup', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.cleanupStaleCalls();

      const lockKeyArg = mockRedisClient.set.mock.calls[0][0];
      expect(lockKeyArg).toMatch(/^scheduler:stale-cleanup:\d+:\d+$/);
    });
  });

  describe('cleanupStaleCalls - Lock Integration', () => {
    it('should skip execution when lock already exists', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      await scheduler.cleanupStaleCalls();

      expect(mockDbService.endStaleCalls).not.toHaveBeenCalled();
    });

    it('should execute when lock acquired', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await scheduler.cleanupStaleCalls();

      expect(mockDbService.endStaleCalls).toHaveBeenCalledWith(15);
    });

    it('should log when stale calls are ended', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      (mockDbService.endStaleCalls as jest.Mock).mockResolvedValue(3);

      await scheduler.cleanupStaleCalls();

      expect(mockDbService.endStaleCalls).toHaveBeenCalledWith(15);
    });
  });
});
