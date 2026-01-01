import { Module, Global } from '@nestjs/common';
import { PushService } from './push.service';

/**
 * 푸시 알림 모듈
 *
 * APNs (VoIP/Alert) 푸시 알림 서비스를 제공합니다.
 * @Global() 데코레이터로 전역 모듈로 등록되어 다른 모듈에서 import 없이 사용 가능
 */
@Global()
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
