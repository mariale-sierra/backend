import {
  Injectable,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WorkoutLog } from './entities/workout-log.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { WorkoutLogExerciseTarget } from './entities/workout-log-exercise-target.entity';
import { WorkoutLogExerciseSet } from './entities/workout-log-exercise-set.entity';
import { WorkoutLogExerciseSetTarget } from './entities/workout-log-exercise-set-target.entity';
import { Between } from 'typeorm';
import { WorkoutPostsService } from '../workout-posts/workout-posts.service';
import { Challenge } from '../challenges/entities/challenge.entity';
import { getLocalDayBoundsUtc } from '../common/timezone.util';

@Injectable()
export class WorkoutLogService {
  constructor(
    @InjectRepository(RoutineExercise)
    private routineExerciseRepo: Repository<RoutineExercise>,

    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,

    private workoutPostsService: WorkoutPostsService,
    private dataSource: DataSource,

    @InjectRepository(WorkoutLogExercise)
    private wleRepo: Repository<WorkoutLogExercise>,

    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,
  ) {}

  async createWorkout(dto: {
    routineId?: number;
    userId: string;
    challengeId?: string;
    imageUrl?: string;
    caption?: string;
    visibility?: 'private' | 'followers' | 'public';
    isRestDay?: boolean;
    /** Caller's IANA timezone (from the `X-Timezone` request header,
     * already validated/defaulted to 'UTC' by the controller). Only
     * consulted when `challengeId` is set — the plain routineId-only
     * create() path never reaches the day-check block below, so it's fine
     * to omit there. */
    timezone?: string;
  }) {
    if (!dto.isRestDay && !dto.imageUrl) {
      throw new BadRequestException(
        'Se requiere una imagen para guardar este progreso.',
      );
    }

    if (dto.challengeId) {
      // Bounded by the user's local calendar day, not the server's UTC
      // clock, so the one-log-per-day gate agrees with the "completed
      // today" display logic elsewhere (ChallengesService, UsersService) —
      // logging late at night now flips back to "available" at the user's
      // own midnight, not the server's.
      const { start, end } = getLocalDayBoundsUtc(
        new Date(),
        dto.timezone ?? 'UTC',
      );

      const existing = await this.workoutRepo.findOne({
        where: {
          userId: dto.userId,
          challengeId: dto.challengeId,
          started_at: Between(start, end),
        },
      });

      if (existing) {
        throw new ConflictException('You already logged progress today');
      }
    }

    const savedWorkout = await this.dataSource.transaction(async (manager) => {
      const workout = manager.create(WorkoutLog, {
        routineId: dto.routineId,
        userId: dto.userId,
        challengeId: dto.challengeId,
        // createWorkout is a single atomic submission (image + all exercise
        // data at once) — nothing in the app calls PATCH /workout-logs/:id/finish
        // afterwards, so leaving this as 'in_progress' meant every log stayed
        // unfinished forever and progress %/streak (which only count
        // 'completed' logs) were permanently stuck at 0.
        status: 'completed' as WorkoutLog['status'],
        started_at: new Date(),
        ended_at: new Date(),
      });

      const createdWorkout = await manager.save(workout);

      if (dto.routineId) {
        const routineExercises = await manager
          .getRepository(RoutineExercise)
          .find({
            where: { routine: { id: dto.routineId } },
            relations: ['exercise', 'targets', 'sets', 'sets.targets'],
            order: { order_index: 'ASC' },
          });

        const workoutExercises = await manager.save(
          routineExercises.map((routineExercise) =>
            manager.create(WorkoutLogExercise, {
              workout: createdWorkout,
              exercise: routineExercise.exercise,
              orderIndex: routineExercise.order_index,
              notes: routineExercise.notes,
            }),
          ),
        );

        for (let index = 0; index < routineExercises.length; index += 1) {
          const routineExercise = routineExercises[index];
          const workoutExercise = workoutExercises[index];

          if (routineExercise.targets?.length) {
            await manager.save(
              routineExercise.targets.map((target) =>
                manager.create(WorkoutLogExerciseTarget, {
                  workoutLogExercise: workoutExercise,
                  metricTypeId: target.metric_type_id,
                  targetValueInt: target.target_value_int,
                  targetValueDecimal: target.target_value_decimal,
                  targetValueText: target.target_value_text,
                  targetValueSeconds: target.target_value_seconds,
                  targetValueBoolean: target.target_value_boolean,
                  unit: target.unit,
                }),
              ),
            );
          }

          if (routineExercise.sets?.length) {
            const workoutSets = await manager.save(
              routineExercise.sets.map((set) =>
                manager.create(WorkoutLogExerciseSet, {
                  workoutLogExercise: workoutExercise,
                  setNumber: set.set_number,
                  restSecondsAfter: set.rest_seconds_after,
                  notes: set.notes,
                }),
              ),
            );

            for (
              let setIndex = 0;
              setIndex < routineExercise.sets.length;
              setIndex += 1
            ) {
              const routineSet = routineExercise.sets[setIndex];
              const workoutSet = workoutSets[setIndex];

              if (routineSet.targets?.length) {
                await manager.save(
                  routineSet.targets.map((target) =>
                    manager.create(WorkoutLogExerciseSetTarget, {
                      workoutLogExerciseSet: workoutSet,
                      metricTypeId: target.metric_type_id,
                      targetValueInt: target.target_value_int,
                      targetValueDecimal: target.target_value_decimal,
                      targetValueText: target.target_value_text,
                      targetValueSeconds: target.target_value_seconds,
                      targetValueBoolean: target.target_value_boolean,
                      unit: target.unit,
                    }),
                  ),
                );
              }
            }
          }
        }
      }

      return createdWorkout;
    });

    if (!dto.isRestDay) {
      await this.workoutPostsService.create({
        workout_log_id: savedWorkout.id,
        user_id: dto.userId,
        image_url: dto.imageUrl,
        caption: dto.caption,
        visibility: await this.resolvePostVisibility(
          dto.challengeId,
          dto.visibility,
        ),
      });
    }

    return this.findOne(savedWorkout.id);
  }

  /**
   * A post can never become globally public content from a private
   * challenge — challenges.visibility (who can access/join a challenge) and
   * workout_posts.visibility (who can see a post) are independent concepts,
   * but a private challenge's posts must not leak into public surfaces
   * (Feed, another user's public profile) just because the poster picked
   * 'public'. Downgraded silently to 'private' rather than rejecting the
   * whole progress submission over a visibility mismatch (see F8 in
   * docs/testing/PLAN-MAESTRO-PRUEBAS.md). This is the write-side half of
   * the rule; getFeed/getUserPosts/getChallengePhotos in
   * WorkoutPostsService re-check it at read time as a second layer.
   */
  private async resolvePostVisibility(
    challengeId: string | undefined,
    requestedVisibility: 'private' | 'followers' | 'public' | undefined,
  ): Promise<'private' | 'followers' | 'public'> {
    const visibility = requestedVisibility || 'private';
    if (!challengeId || visibility !== 'public') {
      return visibility;
    }

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
      select: ['visibility'],
    });

    return challenge?.visibility === 'private' ? 'private' : visibility;
  }

  async finishWorkout(workoutId: number, userId: string) {
    const workout = await this.workoutRepo.findOneBy({ id: workoutId });

    if (!workout) throw new NotFoundException('Workout not found');
    if (workout.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this workout log',
      );
    }

    workout.ended_at = new Date();
    workout.status = 'completed' as WorkoutLog['status'];

    return this.workoutRepo.save(workout);
  }

  // `userId` is optional: internal callers (e.g. right after createWorkout)
  // fetch the just-created workout without an ownership check; the
  // controller-facing GET /workout-logs/:id route always passes it.
  async findOne(id: number, userId?: string) {
    const workout = await this.workoutRepo.findOne({
      where: { id },
      relations: [
        'exercises',
        'exercises.exercise',
        'exercises.metrics',
        'exercises.targets',
        'exercises.sets',
        'exercises.sets.targets',
        'posts',
      ],
    });

    if (!workout) {
      throw new NotFoundException('Workout not found');
    }

    if (userId !== undefined && workout.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this workout log',
      );
    }

    return workout;
  }

  async findAll(userId: string) {
    return this.workoutRepo.find({
      where: { userId },
      relations: [
        'exercises',
        'exercises.exercise',
        'exercises.metrics',
        'exercises.targets',
        'exercises.sets',
        'exercises.sets.targets',
        'posts',
      ],
    });
  }
}
