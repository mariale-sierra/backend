import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
/* import { TypeOrmModule } from '@nestjs/typeorm';*/
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { ChallengesModule } from './challenges/challenges.module';

@Module({
  imports: [
    /* TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
    }), */
    ConfigModule.forRoot({isGlobal: true}),
    UsersModule,
    AuthModule,
    ChallengesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}