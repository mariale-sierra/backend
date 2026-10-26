import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// DataSource (TypeOrmModule.forRoot) and RedisCacheService (@Global
// CacheModule) are both available app-wide, so nothing to import here.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
