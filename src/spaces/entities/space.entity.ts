import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ExerciseCategory } from '../../exercises/entities/exercise-category.entity';

export type SpaceVisibility = 'public' | 'private';

@Entity({ schema: 'havit', name: 'spaces' })
export class Space {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  created_by_user_id!: string;

  @Column({ length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ nullable: true })
  image_url?: string;

  @Column({
    type: 'enum',
    enum: ['public', 'private'],
    enumName: 'space_visibility_enum',
  })
  visibility!: SpaceVisibility;

  // References exercise_categories.id — reuses the same activity taxonomy
  // challenges use (Strength/Cardio Intense/.../Functional) for the wireframe's
  // "Activity Color" picker, instead of a duplicate enum. See migration
  // 2026-09-02-01-spaces-join-requests-and-activity-category.sql.
  @Column({ nullable: true })
  activity_category_id?: number | null;

  @Column({ default: true })
  is_active!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy?: User;

  @ManyToOne(() => ExerciseCategory)
  @JoinColumn({ name: 'activity_category_id' })
  activityCategory?: ExerciseCategory | null;
}
