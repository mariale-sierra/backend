import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Challenge } from './entities/challenge.entity';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(
    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,
    @InjectRepository(User)
    private userRepo: Repository<User>, 
    @InjectRepository(ChallengeUserMap)
    private challengeUserMapRepo: Repository<ChallengeUserMap>,
) {}


  
  async create(createChallengeDto: CreateChallengeDto, supabaseId: string) {
    this.logger.log(`Creating challenge with name: ${createChallengeDto.name}`);

    console.log('supabase_id buscado:', supabaseId);

    const user = await this.userRepo.findOne({ 
      where: { supabase_id: supabaseId } 
    });

    console.log('usuario encontrado:', user); 
    if (!user) throw new NotFoundException('User not found');

    const challenge = this.challengeRepo.create({
      ...createChallengeDto,
      created_by_user_id: user.id,
    });

    const saved = await this.challengeRepo.save(challenge);

    return {
      message: 'Challenge created successfully',
      challenge: saved,
    };
  }

  
  async findAll() {
    const challenges = await this.challengeRepo.find();

    return {
      message: 'Challenges retrieved successfully',
      data: challenges,
    };
  }

 
  async findOne(id: number) {
    const challenge = await this.challengeRepo.findOne({
      where: { id },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    return challenge;
  }

  
  async update(id: number, updateChallengeDto: UpdateChallengeDto) {
    const challenge = await this.challengeRepo.findOne({
      where: { id },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    Object.assign(challenge, updateChallengeDto);

    const updated = await this.challengeRepo.save(challenge);

    return {
      message: 'Challenge updated successfully',
      challenge: updated,
    };
  }

  
  async remove(id: number) {
    const challenge = await this.challengeRepo.findOne({
      where: { id },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    await this.challengeRepo.remove(challenge);

    return {
      message: 'Challenge deleted successfully',
    };
  }

  
  async joinChallenge(supabaseId: string, challengeId: number) {
    const user = await this.userRepo.findOne({
      where: { supabase_id: supabaseId }
    });

    if (!user) throw new NotFoundException('User not found');

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId }
    });

    if (!challenge) throw new NotFoundException('Challenge not found');

   
    const alreadyJoined = await this.challengeUserMapRepo.findOne({
      where: { user_id: Number(user.id), challenge_id: challengeId }
    });

    if (alreadyJoined) throw new BadRequestException('Already joined this challenge');

    const join = this.challengeUserMapRepo.create({
      user_id: Number(user.id),
      challenge_id: challengeId,
      role: 'participant',
      status: 'active',
    });

    await this.challengeUserMapRepo.save(join);

    return {
      message: 'Joined successfully',
      data: join,
    };
  }
}