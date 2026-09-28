import { Global, Module } from '@nestjs/common';
import { RedisCacheService } from './redis-cache.service';

// @Global(): one Redis connection for the whole process, injectable anywhere
// without every feature module importing CacheModule individually — same
// reasoning as ConfigModule.forRoot({ isGlobal: true }) in app.module.ts.
@Global()
@Module({
  providers: [RedisCacheService],
  exports: [RedisCacheService],
})
export class CacheModule {}
