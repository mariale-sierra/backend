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
    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,

    @InjectRepository(ChallengeUserMap)
    private challengeUserMapRepo: Repository<ChallengeUserMap>,
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

  async getMyChallenges(userId: string) {
  const challenges = await this.challengeRepo
    .createQueryBuilder('challenge')
    .innerJoin(
      ChallengeUserMap,
      'map',
      'map.challenge_id = challenge.id',
    )
    .where('map.user_id = :userId', { userId })
    .select([
      'challenge.id AS id',
      'challenge.name AS name',
      'challenge.description AS description',
      'challenge.instructions AS instructions',
      'challenge.visibility AS visibility',
      'challenge.duration_days AS duration_days',
      'challenge.cycle_length_days AS cycle_length_days',
      'challenge.created_by_user_id AS created_by_user_id',
      'map.role AS role',
      'map.status AS status',
      'map.joined_at AS joined_at',
    ])
    .getRawMany();

  return {
    message: 'User challenges retrieved successfully',
    data: challenges,
  };
}  
}