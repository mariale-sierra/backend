import { Injectable, Logger } from '@nestjs/common';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';


@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  private challenges: any[] = []; //Almacenamiento por ahora.

  private participants: any[] = []; //Almacenamiento por ahora.

  create(createChallengeDto: CreateChallengeDto, userId: number) {
  this.logger.log(`Creating challenge with name: ${createChallengeDto.name}`);

  const createdChallenge = {
    id: Date.now(),
    created_by_user_id: userId,
    ...createChallengeDto,
  };

  this.challenges.push(createdChallenge); //Almacenamiento por ahora.

  return {
    message: 'Challenge created successfully',
    challenge: createdChallenge,
  };
}

  findAll() {
  const userId = 1; // mock

  return this.challenges.map(challenge => {
    const participants = this.participants.filter(
      p => p.challengeId === challenge.id
    );

    const isJoined = participants.some(p => p.userId === userId);

    return {
      ...challenge,
      participants: participants.length,
      joined: isJoined,
    };
  });
}

  joinChallenge(userId: number, challengeId: number) {
  const challenge = this.challenges.find(c => c.id === challengeId);

  if (!challenge) {
    return { message: 'Challenge not found' };
  }

  const alreadyJoined = this.participants.find(
    p => p.userId === userId && p.challengeId === challengeId
  );

  if (alreadyJoined) {
    return { message: 'User already joined this challenge' };
  }

  const participation = {
    userId,
    challengeId,
    joinedAt: new Date(),
  };

  this.participants.push(participation);

  return {
    message: 'Joined successfully',
    data: participation,
  };
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
