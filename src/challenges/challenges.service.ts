import { Injectable, Logger } from '@nestjs/common';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  create(createChallengeDto: CreateChallengeDto, userId: number) {
    this.logger.log(`Creating challenge with name: ${createChallengeDto.name}`);

    const createdChallenge = {
    id: Date.now(),
    created_by_user_id: userId,
    ...createChallengeDto,
  };

    return {
      message: 'Challenge created successfully',
      challenge: createdChallenge,
    };
  }

  findAll() {
    return `This action returns all challenges`;
  }

  findOne(id: number) {
    return `This action returns a #${id} challenge`;
  }

  update(id: number, updateChallengeDto: UpdateChallengeDto) {
    return `This action updates a #${id} challenge`;
  }

  remove(id: number) {
    return `This action removes a #${id} challenge`;
  }
}
