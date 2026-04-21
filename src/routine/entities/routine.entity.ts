import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';

@Entity({ schema: 'havit', name: 'routines' })
export class Routine {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string;

  @Column({ default: true })
  is_active!: boolean;

  @OneToMany('RoutineExercise', 'routine')  
  routine_exercises?: any[];
}