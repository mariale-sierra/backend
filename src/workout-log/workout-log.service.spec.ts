import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
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
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';

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
  let challengeUserMapRepo: ReturnType<typeof createMockRepo>;

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';

  // Open, unfinishable-by-cycle-length challenge — the "just some other
  // challenge" default so tests that aren't about the challenge-status/
  // auto-complete logic itself don't have to think about it.
  const OPEN_CHALLENGE = { id: 'challenge-1', status: 'open' };

  beforeEach(async () => {
    workoutRepo = createMockRepo();
    dataSource = { transaction: jest.fn() };
    workoutPostsService = { create: jest.fn() };
    challengeRepo = createMockRepo();
    challengeUserMapRepo = createMockRepo();

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
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserMapRepo,
        },
      ],
    }).compile();

    service = module.get(WorkoutLogService);
  });

  describe('createWorkout', () => {
    it('should reject a second progress log for the same challenge on the same day', async () => {
      challengeRepo.findOne.mockResolvedValue(OPEN_CHALLENGE);
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

      challengeRepo.findOne.mockResolvedValue(OPEN_CHALLENGE);
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
      challengeRepo.findOne.mockResolvedValue(OPEN_CHALLENGE);
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

    // New guard rails added alongside the private-challenge join-request
    // feature and the admin close-challenge action: logging progress against
    // a challenge that doesn't exist, or one that's been closed, must be
    // rejected server-side — not just hidden client-side — so a stale
    // client (or a direct API call) can't bypass either.
    describe('challenge existence/closed checks', () => {
      it('should throw NotFoundException when the challenge does not exist', async () => {
        challengeRepo.findOne.mockResolvedValue(null);

        await expect(
          service.createWorkout({
            userId: OWNER_ID,
            challengeId: 'missing-challenge',
            imageUrl: 'https://example.com/x.jpg',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(workoutRepo.findOne).not.toHaveBeenCalled();
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('should throw BadRequestException when the challenge is closed', async () => {
        challengeRepo.findOne.mockResolvedValue({
          id: 'challenge-1',
          status: 'closed',
        });

        await expect(
          service.createWorkout({
            userId: OWNER_ID,
            challengeId: 'challenge-1',
            imageUrl: 'https://example.com/x.jpg',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(workoutRepo.findOne).not.toHaveBeenCalled();
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('should not query the challenge at all when the workout has no challengeId', async () => {
        workoutRepo.findOne.mockResolvedValueOnce({
          id: 99,
          userId: OWNER_ID,
        });
        dataSource.transaction.mockImplementation(async (cb) =>
          cb({
            create: jest.fn().mockReturnValue({ id: 99, userId: OWNER_ID }),
            save: jest
              .fn()
              .mockResolvedValue({ id: 99, userId: OWNER_ID }),
            getRepository: jest.fn(),
          }),
        );

        await service.createWorkout({
          userId: OWNER_ID,
          imageUrl: 'https://example.com/x.jpg',
        });

        expect(challengeRepo.findOne).not.toHaveBeenCalled();
      });
    });

    // Neither test above asserts what actually reaches WorkoutPostsService —
    // the piece B2 (Posts/Feed) consumes. Covers CP-09 (post generado desde
    // el progreso) and CP-28 (visibility='public' se propaga end to end).
    describe('generating the WorkoutPost (CP-09 / CP-28)', () => {
      beforeEach(() => {
        challengeRepo.findOne.mockResolvedValue(OPEN_CHALLENGE);
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
        // Same mock answers both the upfront existence/closed check in
        // createWorkout() and resolvePostVisibility()'s own lookup below —
        // neither cares about the other's fields, so one shared object works
        // for both call sites.
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

      it('should not re-query the challenge for visibility when the requested visibility is not public', async () => {
        // createWorkout() still does its own upfront existence/closed check
        // whenever challengeId is set — only resolvePostVisibility()'s
        // separate, visibility-specific lookup is skipped here.
        challengeRepo.findOne.mockResolvedValue(OPEN_CHALLENGE);

        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day1.jpg',
          visibility: 'followers',
        });

        expect(challengeRepo.findOne).not.toHaveBeenCalledWith(
          expect.objectContaining({ select: ['visibility'] }),
        );
        expect(workoutPostsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ visibility: 'followers' }),
        );
      });

      it('should not query the challenge when the workout has no challengeId', async () => {
        // No challengeId means neither the daily-duplicate check nor the
        // existence/closed check ever run, so createWorkout only calls
        // workoutRepo.findOne() once (the final this.findOne() lookup) —
        // override the beforeEach's two-call queue.
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

    // Server-side auto-completion: a challenge that's genuinely run its full
    // length must flip challenge_user_map.status to 'completed' the moment
    // its last day's workout is saved, not only after a second, separate
    // client round-trip (see completeChallengeIfThisWasTheLastDay's own
    // doc-comment in workout-log.service.ts) — this is the actual fix for
    // "a 20/20-day challenge still shows as active".
    describe('completeChallengeIfThisWasTheLastDay (server-side auto-complete)', () => {
      const CHALLENGE_WITH_CYCLE = {
        id: 'challenge-1',
        status: 'open',
        duration_days: 20,
        cycle_length_days: 4,
      };

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
        challengeRepo.findOne.mockResolvedValue(CHALLENGE_WITH_CYCLE);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it("should mark the participant 'completed' when today is genuinely the challenge's last day", async () => {
        jest.useFakeTimers();
        // Joined 19 days before "now" -> raw/capped currentDay 20, exactly
        // duration_days — today's workout is the last-day one.
        jest.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
        challengeUserMapRepo.findOne.mockResolvedValue({
          challenge_id: 'challenge-1',
          user_id: OWNER_ID,
          status: 'active',
          joined_at: new Date('2026-08-27T12:00:00.000Z'),
        });
        challengeUserMapRepo.save.mockImplementation((r) => Promise.resolve(r));

        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day20.jpg',
          timezone: 'UTC',
        });

        expect(challengeUserMapRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'completed' }),
        );
      });

      it('should NOT mark the participant completed when today is not yet the last day', async () => {
        jest.useFakeTimers();
        // Joined 10 days before "now" -> currentDay 11, short of the 20-day
        // duration.
        jest.setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
        challengeUserMapRepo.findOne.mockResolvedValue({
          challenge_id: 'challenge-1',
          user_id: OWNER_ID,
          status: 'active',
          joined_at: new Date('2026-08-27T12:00:00.000Z'),
        });

        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day11.jpg',
          timezone: 'UTC',
        });

        expect(challengeUserMapRepo.save).not.toHaveBeenCalled();
      });

      it('should no-op when the caller has no active relation for this challenge', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
        challengeUserMapRepo.findOne.mockResolvedValue(null);

        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day20.jpg',
          timezone: 'UTC',
        });

        expect(challengeUserMapRepo.save).not.toHaveBeenCalled();
      });

      it('should no-op without even querying the relation when the challenge has no cycle_length_days configured', async () => {
        challengeRepo.findOne.mockResolvedValue({
          id: 'challenge-1',
          status: 'open',
          duration_days: 20,
          cycle_length_days: null,
        });

        await service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/day1.jpg',
        });

        expect(challengeUserMapRepo.findOne).not.toHaveBeenCalled();
        expect(challengeUserMapRepo.save).not.toHaveBeenCalled();
      });

      it('should never surface an auto-complete failure as a failed progress submission', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
        challengeUserMapRepo.findOne.mockRejectedValue(
          new Error('db hiccup'),
        );
        const consoleErrorSpy = jest
          .spyOn(console, 'error')
          .mockImplementation(() => undefined);

        await expect(
          service.createWorkout({
            userId: OWNER_ID,
            challengeId: 'challenge-1',
            imageUrl: 'https://example.com/day20.jpg',
            timezone: 'UTC',
          }),
        ).resolves.toBeDefined();

        expect(consoleErrorSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
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
