import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { DbService } from './database';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: DbService,
          useValue: {
            findUserByKakaoId: jest.fn(),
            deleteUser: jest.fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('healthz', () => {
    it('should return status ok', () => {
      const result = appController.getHealth();
      expect(result.status).toBe('ok');
      expect(result.ts).toBeDefined();
    });
  });
});
