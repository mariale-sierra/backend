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

  challenges.forEach((c) => {
    const formatted = {
      ...c.challenge,
      status: c.status,
      joinedAt: c.joined_at,
    };

    if (c.status === 'active') grouped.active.push(formatted);
    if (c.status === 'completed') grouped.completed.push(formatted);
    if (c.status === 'left') grouped.left.push(formatted);
  });

  return grouped;
}
}