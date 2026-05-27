import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(ChallengeUserMap)
    private challengeUserRepo: Repository<ChallengeUserMap>,
  ) {}

  async findById(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getUserChallenges(userId: string) {
    await this.syncExpiredChallengeStatuses(userId);

    const challenges = await this.challengeUserRepo
      .createQueryBuilder('cu')
      .leftJoinAndSelect('cu.challenge', 'challenge')
      .where('cu.user_id = :userId', { userId })
      .orderBy('cu.joined_at', 'DESC')
      .getMany();

    const grouped: {
      active: any[];
      completed: any[];
      left: any[];
    } = {
      active: [],
      completed: [],
      left: [],
    };

    for (const c of challenges) {
      const formatted: any = {
        ...c.challenge,
        status: c.status,
        joinedAt: c.joined_at,
      };

      if (c.status === 'completed') {
        grouped.completed.push(formatted);
      } else if (c.status === 'left') {
        grouped.left.push(formatted);
      } else {
        grouped.active.push(formatted);
      }
    }

    return grouped;
  }

  private async syncExpiredChallengeStatuses(userId: string) {
    const activeChallenges = await this.challengeUserRepo
      .createQueryBuilder('cu')
      .innerJoinAndSelect('cu.challenge', 'challenge')
      .where('cu.user_id = :userId', { userId })
      .andWhere('cu.status = :status', { status: 'active' })
      .getMany();

    const msPerDay = 1000 * 60 * 60 * 24;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiredRelations: ChallengeUserMap[] = [];

    for (const relation of activeChallenges) {
      if (!relation.joined_at || !relation.challenge?.duration_days) {
        continue;
      }

      const joinedAt = new Date(relation.joined_at);
      joinedAt.setHours(0, 0, 0, 0);
      const daysSinceStart = Math.floor((today.getTime() - joinedAt.getTime()) / msPerDay);
      const currentDay = daysSinceStart + 1;

      if (currentDay > relation.challenge.duration_days) {
        relation.status = 'completed';
        expiredRelations.push(relation);
      }
    }

    if (expiredRelations.length > 0) {
      await this.challengeUserRepo.save(expiredRelations);
      this.logger.log(
        `Marked ${expiredRelations.length} expired challenge(s) as completed for user ${userId}`,
      );
    }
  }
}