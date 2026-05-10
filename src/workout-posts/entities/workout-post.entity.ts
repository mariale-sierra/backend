import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('workout_posts')

export class WorkoutPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  workout_log_id!: number;

  @Column()
  user_id!: number;

  @Column()
  image_url!: string;

  @Column({ nullable: true })
  caption?: string;

  @Column()
  visibility!: 'private' | 'followers';

  @CreateDateColumn()
  created_at!: Date;
}