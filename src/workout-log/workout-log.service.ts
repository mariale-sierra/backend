import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkoutLog } from './entities/workout-log.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';

@Injectable()
export class WorkoutLogService {
  constructor(
    @InjectRepository(RoutineExercise)
    private routineExerciseRepo: Repository<RoutineExercise>,

    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,

    @InjectRepository(WorkoutLogExercise)
    private wleRepo: Repository<WorkoutLogExercise>,
  ) {}


    async createWorkout(dto: { routineId?: number; userId: string }) {
    const workout = this.workoutRepo.create({
    routineId: dto.routineId,
    userId: dto.userId, 
    status: 'in_progress' as WorkoutLog['status'],
    started_at: new Date(),
    });

    const savedWorkout = await this.workoutRepo.save(workout);

    if (dto.routineId) {
        const routineExercises = await this.routineExerciseRepo.find({
        where: { routine: { id: dto.routineId } },
        relations: ['exercise'],
        order: { order_index: 'ASC' },
        });

        const workoutExercises = routineExercises.map((re) =>
        this.wleRepo.create({
            workout: savedWorkout,
            exercise: re.exercise,
            orderIndex: re.order_index,
        }),
        );

        await this.wleRepo.save(workoutExercises);
    }

    return savedWorkout;
    }

    async finishWorkout(workoutId: number) {
    const workout = await this.workoutRepo.findOneBy({ id: workoutId });

    if (!workout) throw new Error('Workout not found');

    workout.ended_at = new Date();
    workout.status = 'completed' as WorkoutLog['status'];

    return this.workoutRepo.save(workout);
    }

    async findOne(id: number) {
    const workout = await this.workoutRepo.findOne({
        where: { id },
        relations: [
        'exercises',
        'exercises.exercise', 
        'exercises.metrics', 
        ],
    });

    if (!workout) {
        throw new Error('Workout not found');
    }

    return workout;
    }

    async findAll() {
    return this.workoutRepo.find({
        relations: ['exercises', 'exercises.exercise', 'exercises.metrics'],
    });
    }

}