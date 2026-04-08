import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Challenge } from './entities/challenge.entity';
import { CreateChallengeDto } from './dto/create-challenge.dto';

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  
  constructor(
    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,
  ) {}

  
  async create(createChallengeDto: CreateChallengeDto, userId: string) {
    this.logger.log(Creating challenge with name: ${createChallengeDto.name});

    const challenge = this.challengeRepo.create({
      ...createChallengeDto,
      created_by_user_id: userId,
    });

    const saved = await this.challengeRepo.save(challenge);

    return {
      message: 'Challenge created successfully',
      challenge: saved,
    };
  }

}