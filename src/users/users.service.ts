import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(ChallengeUserMap)
    private challengeUserRepo: Repository<ChallengeUserMap>,
  ) {}

  async findById(id: string): Promise<UserResponseDto> {
    // select explicitly — never pull password_hash off the DB for a response path.
    const user = await this.userRepo.findOne({
      where: { id },
      select: ['id', 'username', 'email', 'is_active'],
    });
    if (!user) throw new NotFoundException('User not found');
    return UserResponseDto.fromEntity(user);
  }

  async findByEmail(email: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getUserChallenges(userId: string) {
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
}