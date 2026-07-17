import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChallengesService } from './challenges.service';
import { Challenge } from './entities/challenge.entity';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCycleDay } from './entities/challenge-cycle-days.entity';
import { Routine } from '../routine/entities/routine.entity';

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
};

const createMockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ChallengesService', () => {
  let service: ChallengesService;
  let challengeRepo: MockRepo;
  let challengeCycleDaysRepo: MockRepo;

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';
  const CHALLENGE_ID = 'challenge-1';

  const baseChallenge = () => ({
    id: CHALLENGE_ID,
    name: 'Test challenge',
    created_by_user_id: OWNER_ID,
    duration_days: 30,
    cycle_length_days: 7,
  });

  beforeEach(async () => {
    challengeRepo = createMockRepo();
    challengeCycleDaysRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesService,
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(User), useValue: createMockRepo() },
        { provide: getRepositoryToken(ChallengeUserMap), useValue: createMockRepo() },
        { provide: getRepositoryToken(WorkoutLog), useValue: createMockRepo() },
        { provide: getRepositoryToken(ChallengeCycleDay), useValue: challengeCycleDaysRepo },
        { provide: getRepositoryToken(Routine), useValue: createMockRepo() },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get(ChallengesService);
  });

  describe('update', () => {
    it('should allow the creator to update their own challenge', async () => {
      const challenge = baseChallenge();
      challengeRepo.findOne.mockResolvedValue(challenge);
      challengeRepo.save.mockResolvedValue({ ...challenge, name: 'Updated' });

      const result = await service.update(CHALLENGE_ID, { name: 'Updated' } as any, OWNER_ID);

      expect(challengeRepo.save).toHaveBeenCalled();
      expect(result.challenge.name).toBe('Updated');
    });

    it('should reject updating a challenge the caller did not create', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());

      await expect(
        service.update(CHALLENGE_ID, { name: 'Hacked' } as any, OTHER_USER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(challengeRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the challenge does not exist', async () => {
      challengeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'x' } as any, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should allow the creator to remove their own challenge', async () => {
      const challenge = baseChallenge();
      challengeRepo.findOne.mockResolvedValue(challenge);
      challengeRepo.remove.mockResolvedValue(challenge);

      const result = await service.remove(CHALLENGE_ID, OWNER_ID);

      expect(challengeRepo.remove).toHaveBeenCalledWith(challenge);
      expect(result).toEqual({ message: 'Challenge deleted successfully' });
    });

    it('should reject removing a challenge the caller did not create', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());

      await expect(service.remove(CHALLENGE_ID, OTHER_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(challengeRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('updateCycleDay', () => {
    const cycleDayDto = { day_type: 'workout' } as any;

    it('should allow the creator to update a cycle day', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      challengeCycleDaysRepo.findOne.mockResolvedValue({
        id: 'cycle-1',
        challenge_id: CHALLENGE_ID,
        day_in_cycle: 1,
        day_type: 'rest',
        routine_id: null,
      });
      challengeCycleDaysRepo.save.mockResolvedValue({});
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'cycle-1', day_in_cycle: 1, day_type: 'workout', routine_id: null }),
      });

      const result = await service.updateCycleDay(CHALLENGE_ID, 1, cycleDayDto, OWNER_ID);

      expect(challengeCycleDaysRepo.save).toHaveBeenCalled();
      expect(result.message).toBe('Challenge cycle day updated successfully');
    });

    it('should reject updating a cycle day when the caller did not create the challenge', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());

      await expect(
        service.updateCycleDay(CHALLENGE_ID, 1, cycleDayDto, OTHER_USER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(challengeCycleDaysRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the challenge does not exist', async () => {
      challengeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateCycleDay('missing-id', 1, cycleDayDto, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
