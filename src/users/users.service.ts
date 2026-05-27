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

  async getUserChallenges(userId: number) {
  const challenges = await this.challengeUserRepo
    .createQueryBuilder('cu')
    .leftJoinAndSelect('cu.challenge', 'challenge')
    .where('cu.user_id = :userId', { userId })
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

  const msPerDay = 1000 * 60 * 60 * 24;

  for (const c of challenges) {
    const formatted: any = {
      ...c.challenge,
      status: c.status,
      joinedAt: c.joined_at,
    };

    // If relation is active, compute whether the challenge has actually finished
    // according to calendar days since `joined_at` versus `duration_days`.
    if (c.status === 'active') {
      try {
        if (c.joined_at && c.challenge && c.challenge.duration_days) {
          const joinedAt = new Date(c.joined_at);
          joinedAt.setHours(0, 0, 0, 0);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysSinceStart = Math.floor((today.getTime() - joinedAt.getTime()) / msPerDay);
          const currentDay = daysSinceStart + 1;
          if (currentDay > (c.challenge.duration_days ?? 0)) {
            // treat as completed for the client view
            formatted.status = 'completed';
            grouped.completed.push(formatted);
            continue;
          }
        }
      } catch (e) {
        // fallback: if any error, keep original active status
      }

      grouped.active.push(formatted);
      continue;
    }

    if (c.status === 'completed') grouped.completed.push(formatted);
    else if (c.status === 'left') grouped.left.push(formatted);
    else grouped.active.push(formatted);
  }

  return grouped;
}
}