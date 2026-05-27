import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

import { Routine } from './routine.entity';
import { Exercise } from '../../exercises/entities/exercise.entity';

import { RoutineExerciseSet } from './routine-exercise-set.entity';
import { RoutineExerciseTarget } from './routine-exercise-target.entity';

@Entity({
  schema: 'havit',
  name: 'routine_exercises',
})
export class RoutineExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('int')
  routine_id!: number;

  @Column('int')
  exercise_id!: number;

  @Column('int')
  order_index!: number;

  @Column({
    type: 'text',
    nullable: true,
  })
  notes?: string;

  @ManyToOne(() => Routine)
  @JoinColumn({ name: 'routine_id' })
  routine!: Routine;

  @ManyToOne(() => Exercise)
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @OneToMany(() => RoutineExerciseSet, (set) => set.routineExercise)
  sets!: RoutineExerciseSet[];

  @OneToMany(() => RoutineExerciseTarget, (target) => target.routineExercise)
  targets!: RoutineExerciseTarget[];
}
