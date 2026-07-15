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
import { RoutineExerciseTarget } from '../routine/entities/routine-exercise-target.entity';
import { RoutineExerciseSet } from '../routine/entities/routine-exercise-set.entity';
import { RoutineExerciseSetTarget } from '../routine/entities/routine-exercise-set-target.entity';

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
    ) {}

    async createWorkout(dto: {
        routineId?: number;
        userId: string;
        challengeId?: string;
        imageUrl?: string;
        caption?: string;
        visibility?: 'private' | 'followers';
        isRestDay?: boolean;
    }) {
        if (!dto.isRestDay && !dto.imageUrl) {
            throw new BadRequestException(
                'Se requiere una imagen para guardar este progreso.',
            );
        }

        if (dto.challengeId) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);

            const existing = await this.workoutRepo.findOne({
                where: {
                    userId: dto.userId,
                    challengeId: dto.challengeId,
                    started_at: Between(todayStart, todayEnd),
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
                status: 'in_progress' as WorkoutLog['status'],
                started_at: new Date(),
            });

            const createdWorkout = await manager.save(workout);

            if (dto.routineId) {
                const routineExercises = await manager.getRepository(RoutineExercise).find({
                    where: { routine: { id: dto.routineId } },
                    relations: [
                        'exercise',
                        'targets',
                        'sets',
                        'sets.targets',
                    ],
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

                        for (let setIndex = 0; setIndex < routineExercise.sets.length; setIndex += 1) {
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
            await this.workoutPostsService.create(
                {
                    workout_log_id: savedWorkout.id,
                    user_id: dto.userId,
                    image_url: dto.imageUrl,
                    caption: dto.caption,
                    visibility: dto.visibility || 'private',
                },
            );
        }

        return this.findOne(savedWorkout.id);
    }

    async finishWorkout(workoutId: number, userId: string) {
        const workout = await this.workoutRepo.findOneBy({ id: workoutId });

        if (!workout) throw new NotFoundException('Workout not found');
        if (workout.userId !== userId) {
            throw new ForbiddenException('You do not have access to this workout log');
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
        throw new ForbiddenException('You do not have access to this workout log');
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