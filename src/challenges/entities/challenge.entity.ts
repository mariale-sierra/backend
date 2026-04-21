import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ schema: 'havit', name: 'challenges' })
export class Challenge {
  @PrimaryGeneratedColumn()
  id!: string;

  @Column()
  created_by_user_id!: string; 

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  instructions?: string;

  @Column()
  visibility!: string;

  @Column()
  duration_days!: number;

  @Column({ nullable: true })
  cycle_length_days?: number;
}