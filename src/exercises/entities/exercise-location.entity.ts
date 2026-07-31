import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'havit', name: 'exercise_locations' })
export class ExerciseLocation {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  code!: string;

  @Column()
  name!: string;
}
