import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Between, DataSource } from 'typeorm';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutLog } from './entities/workout-log.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { WorkoutPostsService } from '../workout-posts/workout-posts.service';
import { Challenge } from '../challenges/entities/challenge.entity';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
});

describe('WorkoutLogService', () => {
  let service: WorkoutLogService;
  let workoutRepo: ReturnType<typeof createMockRepo>;
  let dataSource: { transaction: jest.Mock };
  let workoutPostsService: { create: jest.Mock };
  let challengeRepo: ReturnType<typeof createMockRepo>;

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';

  beforeEach(async () => {
    workoutRepo = createMockRepo();
    dataSource = { transaction: jest.fn() };
    workoutPostsService = { create: jest.fn() };
    challengeRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutLogService,
        {
          provide: getRepositoryToken(RoutineExercise),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
        { provide: WorkoutPostsService, useValue: workoutPostsService },
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(WorkoutLogExercise),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
      ],
    }).compile();

    service = module.get(WorkoutLogService);
  });

  describe('createWorkout', () => {
    it('should reject a second progress log for the same challenge on the same day', async () => {
      workoutRepo.findOne.mockResolvedValue({
        id: 1,
        userId: OWNER_ID,
        challengeId: 'challenge-1',
      });

      await expect(
        service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/x.jpg',
        }),
      ).rejects.toThrow(ConflictException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    // Real bug: the duplicate-log check used to bound "today" with
    // Date.setHours(), the SERVER's local clock (pinned to UTC), not the
    // caller's own timezone — so logging late at night didn't cleanly flip
    // back to "available" at the user's own midnight.
    it("should key the duplicate-log check off the caller's local day, not the server's UTC day", async () => {
      jest.useFakeTimers();
      // 2026-08-28T05:59:00Z is already the next UTC calendar day, but
      // still 2026-08-27T23:59:00 local in America/Guatemala (UTC-6, no
      // DST) — the exact "logged late at night" scenario from the bug.
      jest.setSystemTime(new Date('2026-08-28T05:59:00.000Z'));

      workoutRepo.findOne.mockResolvedValue({
        id: 1,
        userId: OWNER_ID,
        challengeId: 'challenge-1',
      });

      await expect(
        service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/x.jpg',
          timezone: 'America/Guatemala',
        }),
      ).rejects.toThrow(ConflictException);

      expect(workoutRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            // Local midnight Aug 27 in Guatemala (UTC-6) -> UTC 06:00; local
            // end-of-day Aug 27 23:59:59.999 -> UTC Aug 28 05:59:59.999. A
            // server-UTC-only check would have used Aug 28's own boundaries
            // instead, missing the log the user made just before their own
            // midnight and letting a duplicate through.
            started_at: Between(
              new Date('2026-08-27T06:00:00.000Z'),
              new Date('2026-08-28T05:59:59.999Z'),
            ),
          }),
        }),
      );

      jest.useRealTimers();
    });

    it('should save the workout under the userId passed by the caller (the JWT-derived id)', async () => {
      workoutRepo.findOne.mockResolvedValue(null); // no existing log today
      const createdWorkout = { id: 99, userId: OWNER_ID };
      dataSource.transaction.mockImplementation(async (cb) =>
        cb({
          create: jest.fn().mockReturnValue(createdWorkout),
          save: jest.fn().mockResolvedValue(createdWorkout),
          getRepository: jest.fn(),
        }),
      );
      // findOne is also used at the end (this.findOne(savedWorkout.id))
      workoutRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createdWorkout);

      await service.createWorkout({
        userId: OWNER_ID,
        challengeId: 'challenge-1',
        imageUrl: 'https://example.com/x.jpg',
      });

      expect(dataSource.transaction).toHaveBeenCalled();
    });

    // Neither test above asserts what actually reaches WorkoutPostsService —
    // the piece B2 (Posts/Feed) consumes. Covers CP-09 (post generado desde
    // el progreso) and CP-28 (visibility='public' se propaga end to end).
    describe('generating the WorkoutPost (CP-09 / CP-28)', () => {
      beforeEach(() => {
        workoutRepo.findOne
          .mockResolvedValueOnce(null) // no existing log today
          .mockResolvedValueOnce({ id: 99, userId: OWNER_ID }); // this.findOne() at the end
        const createdWorkout = { id: 99, userId: OWNER_ID };
        dataSource.transaction.mockImplementation(
          (cb: (manager: unknown) => unknown) =>
            cb({
              create: jest.fn().mockReturnValue(createdWorkout),
              save: jest.fn().mockResolvedValue(createdWorkout),
              getRepository: jest.fn(),
            }),
        );
      });

      it('should call workoutPostsService.create with the submitted image, caption and visibility', async () => {
        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day1.jpg',
          caption: 'Día 1 completado',
          visibility: 'public',
        });

        expect(workoutPostsService.create).toHaveBeenCalledWith({
          workout_log_id: 99,
          user_id: OWNER_ID,
          image_url: 'https://example.com/day1.jpg',
          caption: 'Día 1 completado',
          visibility: 'public',
        });
      });

      it('should default visibility to private when the caller omits it', async () => {
        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day1.jpg',
        });

        expect(workoutPostsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: 'private' }),
        );
      });

      it('should not generate a post on a rest day', async () => {
        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          isRestDay: true,
        });

        expect(workoutPostsService.create).not.toHaveBeenCalled();
      });
    });

    // F8 (docs/testing/PLAN-MAESTRO-PRUEBAS.md): a post can never become
    // globally public content just because its challenge is private —
    // challenges.visibility and workout_posts.visibility are independent,
    // but the private challenge's own privacy must win. Write-side half of
    // the fix (WorkoutPostsService re-checks it at read time, see CP-29/30
    // in workout-posts.service.spec.ts).
    describe('downgrading visibility for private-challenge posts (CP-29)', () => {
      beforeEach(() => {
        workoutRepo.findOne
          .mockResolvedValueOnce(null) // no existing log today
          .mockResolvedValueOnce({ id: 99, userId: OWNER_ID }); // this.findOne() at the end
        const createdWorkout = { id: 99, userId: OWNER_ID };
        dataSource.transaction.mockImplementation(
          (cb: (manager: unknown) => unknown) =>
            cb({
              create: jest.fn().mockReturnValue(createdWorkout),
              save: jest.fn().mockResolvedValue(createdWorkout),
              getRepository: jest.fn(),
            }),
        );
      });

      it("should downgrade visibility to 'private' when requesting 'public' on a private challenge", async () => {
        challengeRepo.findOne.mockResolvedValue({ visibility: 'private' });

        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day1.jpg',
          visibility: 'public',
        });

        expect(challengeRepo.findOne).toHaveBeenCalledWith({
          where: { id: 'challenge-1' },
          select: ['visibility'],
        });
        expect(workoutPostsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: 'private' }),
        );
      });

      it("should keep 'public' when the challenge is public", async () => {
        challengeRepo.findOne.mockResolvedValue({ visibility: 'public' });

        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day1.jpg',
          visibility: 'public',
        });

        expect(workoutPostsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: 'public' }),
        );
      });

      it('should not downgrade or query the challenge when the requested visibility is not public', async () => {
        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day1.jpg',
          visibility: 'followers',
        });

        expect(challengeRepo.findOne).not.toHaveBeenCalled();
        expect(workoutPostsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: 'followers' }),
        );
      });

      it('should not query the challenge when the workout has no challengeId', async () => {
        // No challengeId means the daily-duplicate check never runs, so
        // createWorkout only calls workoutRepo.findOne() once (the final
        // this.findOne() lookup) — override the beforeEach's two-call queue.
        workoutRepo.findOne
          .mockReset()
          .mockResolvedValueOnce({ id: 99, userId: OWNER_ID });

        await service.createWorkout({
          userId: OWNER_ID,
          imageUrl: 'https://example.com/day1.jpg',
          visibility: 'public',
        });

        expect(challengeRepo.findOne).not.toHaveBeenCalled();
        expect(workoutPostsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: 'public' }),
        );
      });
    });
  });

  describe('finishWorkout', () => {
    it('should allow the owner to finish their own workout log', async () => {
      const workout = { id: 1, userId: OWNER_ID, status: 'in_progress' };
      workoutRepo.findOneBy.mockResolvedValue(workout);
      workoutRepo.save.mockImplementation((w) => Promise.resolve(w));

      const result = await service.finishWorkout(1, OWNER_ID);

      expect(result.status).toBe('completed');
      expect(result.ended_at).toBeInstanceOf(Date);
    });

    it('should reject finishing a workout log that belongs to another user', async () => {
      workoutRepo.findOneBy.mockResolvedValue({
        id: 1,
        userId: OWNER_ID,
        status: 'in_progress',
      });

      await expect(service.finishWorkout(1, OTHER_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(workoutRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the workout log does not exist', async () => {
      workoutRepo.findOneBy.mockResolvedValue(null);

      await expect(service.finishWorkout(999, OWNER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne', () => {
    it('should return the workout log when the caller is the owner', async () => {
      const workout = { id: 1, userId: OWNER_ID };
      workoutRepo.findOne.mockResolvedValue(workout);

      await expect(service.findOne(1, OWNER_ID)).resolves.toEqual(workout);
    });

    it('should reject fetching a workout log that belongs to another user', async () => {
      workoutRepo.findOne.mockResolvedValue({ id: 1, userId: OWNER_ID });

      await expect(service.findOne(1, OTHER_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when the workout log does not exist', async () => {
      workoutRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(999, OWNER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should scope the query to only the requesting user id', async () => {
      workoutRepo.find.mockResolvedValue([]);

      await service.findAll(OWNER_ID);

      expect(workoutRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: OWNER_ID } }),
      );
    });
  });
});
