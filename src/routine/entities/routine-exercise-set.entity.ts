import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

import { RoutineExercise } from './routine-exercise.entity';
import { RoutineExerciseSetTarget } from './routine-exercise-set-target.entity';

@Entity({
  schema: 'havit',
  name: 'routine_exercise_sets',
})
export class RoutineExerciseSet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  routine_exercise_id!: string;

  @Column('int')
  set_number!: number;

  @Column({
    type: 'int',
    nullable: true,
  })
  rest_seconds_after?: number;

  @Column({
    type: 'text',
    nullable: true,
  })
  notes?: string;

  @ManyToOne(
    () => RoutineExercise,
    routineExercise => routineExercise.sets,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'routine_exercise_id' })
  routineExercise!: RoutineExercise;

  @OneToMany(
    () => RoutineExerciseSetTarget,
    target => target.routineExerciseSet,
  )
  targets!: RoutineExerciseSetTarget[];
}