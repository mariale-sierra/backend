import { BadRequestException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Challenge } from './entities/challenge.entity';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';
import { DataSource } from 'typeorm';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCycleDay } from './entities/challenge-cycle-days.entity';



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
    private dataSource: DataSource,
    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,
    @InjectRepository(ChallengeCycleDay)
    private challengeCycleDaysRepo: Repository<ChallengeCycleDay>,
  ) {}

  async create(createChallengeDto: CreateChallengeDto, userId: string) {
    this.logger.log(`Creating challenge with name: ${createChallengeDto.name}`);
    if (createChallengeDto.cycle_length_days > createChallengeDto.duration_days) {
      throw new BadRequestException('Cycle length cannot exceed duration');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const result = await this.dataSource.transaction(async (manager) => {
      const challenge = manager.create(Challenge, {
        ...createChallengeDto,
        created_by_user_id: userId,
      });
      const savedChallenge = await manager.save(challenge);

      const ownerMap = manager.create(ChallengeUserMap, {
        challenge_id: savedChallenge.id,
        user_id: userId,
        role: 'owner',
        status: 'active',
      });
      await manager.save(ownerMap);

      return savedChallenge;
    });

    return {
      message: 'Challenge created successfully',
      challenge: result,
    };
  }

  async findAll() {
    const challenges = await this.challengeRepo.find();
    return {
      message: 'Challenges retrieved successfully',
      data: challenges,
    };
  }

  async findOne(id: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');
    return challenge;
  }

  async update(id: string, updateChallengeDto: UpdateChallengeDto) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');

    Object.assign(challenge, updateChallengeDto);
    const updated = await this.challengeRepo.save(challenge);

    return {
      message: 'Challenge updated successfully',
      challenge: updated,
    };
  }

  async remove(id: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('Challenge not found');

    await this.challengeRepo.remove(challenge);
    return { message: 'Challenge deleted successfully' };
  }

  async joinChallenge(userId: string, challengeId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const challenge = await this.challengeRepo.findOne({ where: { id: challengeId } });
    if (!challenge) throw new NotFoundException('Challenge not found');

    // no puede unirse el creador
    if (challenge.created_by_user_id === userId) {
      throw new BadRequestException('You cannot join a challenge you created');
    }

    const alreadyJoined = await this.challengeUserMapRepo.findOne({
      where: { user_id: userId, challenge_id: challengeId }
    });
    if (alreadyJoined) throw new BadRequestException('Already joined this challenge');

    const join = this.challengeUserMapRepo.create({
      user_id: userId,
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

  async findUsersByChallenge(challengeId: string) {
    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    const users = await this.challengeUserMapRepo
      .createQueryBuilder('map')
      .innerJoin(User, 'user', 'user.id = map.user_id')
      .where('map.challenge_id = :challengeId', { challengeId })
      .select([
        'user.id AS id',
        'user.username AS username',
        'user.email AS email',
        'map.role AS role',
        'map.status AS status',
        'map.joined_at AS joined_at',
      ])
      .getRawMany();

    return {
      message: 'Challenge users retrieved successfully',
      data: users,
    };

  
  }
  async getProgress(userId: string, challengeId: string) {
    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        user_id: String(userId),
        challenge_id: challengeId,
        status: 'active',
      },
    });

    if (!relation) return null;

    const challenge = await this.challengeRepo.findOne({ where: { id: challengeId } });
    if (!challenge) return null;

    // Nueva lógica para calcular currentDay y currentDayInCycle
    const joinedAt = new Date(relation.joined_at!);
    const today = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysSinceStart = Math.floor((today.getTime() - joinedAt.getTime()) / msPerDay);
    const currentDay = daysSinceStart + 1;
    const currentDayInCycle = ((currentDay - 1) % challenge.cycle_length_days) + 1;

    // completedToday
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const todayWorkout = await this.workoutRepo.findOne({
      where: {
        userId: String(userId),
        challengeId: challengeId,
        started_at: Between(start, end),
      },
    });

    // hours left
    const now = new Date();
    const endDay = new Date();
    endDay.setHours(23, 59, 59, 999);

    const hoursLeft = Math.ceil((endDay.getTime() - now.getTime()) / (1000 * 60 * 60));

    return {
      challenge,
      currentDay,
      currentDayInCycle,
      totalDays: challenge.duration_days,
      completedToday: !!todayWorkout,
      hoursLeftToday: hoursLeft,
    };
  }

  async getToday(challengeId: string, userId: string) {
    const relation = await this.challengeUserMapRepo.findOne({
      where: {
        user_id: userId,
        challenge_id: challengeId,
        status: 'active',
      },
    });

    if (!relation) {
      throw new NotFoundException('User is not part of this challenge');
    }

    const challenge = await this.challengeRepo.findOne({ where: { id: challengeId } });
    if (!challenge) {
      throw new NotFoundException('Challenge not found');
    }

    const joinedAt = new Date(relation.joined_at!);
    const today = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysSinceStart = Math.floor((today.getTime() - joinedAt.getTime()) / msPerDay);
    const currentDay = daysSinceStart + 1;
    const currentDayInCycle = ((currentDay - 1) % challenge.cycle_length_days) + 1;

    const cycleDay = await this.challengeCycleDaysRepo.findOne({
      where: {
        challenge_id: challengeId,
        day_in_cycle: currentDayInCycle,
      },
    });

    if (!cycleDay || cycleDay.day_type === 'rest') {
    return {
      challenge_id: challengeId,

      currentDay,
      currentDayInCycle,

      totalDays: challenge.duration_days,

      hasWorkout: false,

      day_type: 'rest',

      routine_id: null,
    };
  }

  return {
    challenge_id: challengeId,

    currentDay,
    currentDayInCycle,

    totalDays: challenge.duration_days,

    hasWorkout: true,

    day_type: cycleDay.day_type,

    routine_id: cycleDay.routine_id,
  };
  }
}