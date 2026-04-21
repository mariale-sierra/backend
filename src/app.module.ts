import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChallengesModule } from './challenges/challenges.module';
import { ExercisesModule } from './exercises/exercises.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    /* TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: 6543,
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      schema: 'havit',
      synchronize: false,
      ssl: {
        rejectUnauthorized: false,
      },
      extra: {
        family: 4,
      },
    }), */ //DESCOMENTAR, SOLO ES EN LO QUE SALE LA DB

    //AuthModule, DESCOMENTAR, SOLO ES EN LO QUE SALE LA DB
    //UsersModule, DESCOMENTAR, SOLO ES EN LO QUE SALE LA DB
    //ChallengesModule, DESCOMENTAR, SOLO ES EN LO QUE SALE LA DB
    ExercisesModule,
  ],
})
export class AppModule {}