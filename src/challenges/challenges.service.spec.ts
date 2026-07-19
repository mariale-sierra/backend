import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Routine } from '../routine/entities/routine.entity';
import { User } from '../users/entities/user.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengesService } from './challenges.service';
import { ChallengeVisibility } from './dto/create-challenge.dto';
import { ChallengeCategoryMap } from './entities/challenge-category-map.entity';
import { ChallengeCycleDay } from './entities/challenge-cycle-days.entity';
import { ChallengeLocationMap } from './entities/challenge-location-map.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';
import { Challenge } from './entities/challenge.entity';
import { ExerciseCategory } from '../exercises/entities/exercise-category.entity';
import { ExerciseLocation } from '../exercises/entities/exercise-location.entity';

describe('ChallengesService', () => {
  let service: ChallengesService;
  let challengeRepo: { findOne: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let challengeUserMapRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    challengeRepo = { findOne: jest.fn() };
    userRepo = { findOne: jest.fn() };
    challengeUserMapRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesService,
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserMapRepo,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(WorkoutLog), useValue: {} },
        { provide: getRepositoryToken(ChallengeCycleDay), useValue: {} },
        { provide: getRepositoryToken(Routine), useValue: {} },
        { provide: getRepositoryToken(ChallengeCategoryMap), useValue: {} },
        { provide: getRepositoryToken(ChallengeLocationMap), useValue: {} },
        { provide: getRepositoryToken(ExerciseCategory), useValue: {} },
        { provide: getRepositoryToken(ExerciseLocation), useValue: {} },
      ],
    }).compile();

    service = module.get(ChallengesService);
  });

  it('rejects a cycle longer than the challenge before accessing persistence', async () => {
    await expect(
      service.create(
        {
          name: 'Short challenge',
          visibility: ChallengeVisibility.PUBLIC,
          duration_days: 5,
          cycle_length_days: 7,
        },
        'user-1',
      ),
    ).rejects.toThrow('Cycle length cannot exceed duration');

    expect(userRepo.findOne).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('transitions an active participation to completed and persists it', async () => {
    const relation = {
      challenge_id: 'challenge-1',
      user_id: 'user-1',
      status: 'active',
    } as ChallengeUserMap;
    const savedRelation = { ...relation, status: 'completed' };
    challengeRepo.findOne.mockResolvedValue({ id: 'challenge-1' });
    challengeUserMapRepo.findOne.mockResolvedValue(relation);
    challengeUserMapRepo.save.mockResolvedValue(savedRelation);

    await expect(
      service.completeChallenge('user-1', 'challenge-1'),
    ).resolves.toEqual({
      message: 'Challenge completed successfully',
      data: savedRelation,
    });

    expect(relation.status).toBe('completed');
    expect(challengeUserMapRepo.save).toHaveBeenCalledWith(relation);
  });

  it('rejects an invalid transition from left to completed', async () => {
    challengeRepo.findOne.mockResolvedValue({ id: 'challenge-1' });
    challengeUserMapRepo.findOne.mockResolvedValue({
      challenge_id: 'challenge-1',
      user_id: 'user-1',
      status: 'left',
    });

    await expect(
      service.completeChallenge('user-1', 'challenge-1'),
    ).rejects.toThrow(BadRequestException);

    expect(challengeUserMapRepo.save).not.toHaveBeenCalled();
  });
});
