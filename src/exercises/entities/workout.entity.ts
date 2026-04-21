 import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { RoutineExercise } from './routine-exercise.entity';
import { WorkoutLog } from './workout-log.entity';

@Entity({ schema: 'havit', name: 'routines' })
export class Routine {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column()
  user_id!: number;

  @Column({ default: true })
  is_active!: boolean;

  @OneToMany(() => RoutineExercise, (re) => re.routine)
  routine_exercises?: RoutineExercise[];

  @OneToMany(() => WorkoutLog, (log) => log.routine)
  workout_logs?: WorkoutLog[];
}