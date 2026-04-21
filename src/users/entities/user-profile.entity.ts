import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity({ schema: 'havit', name: 'user_profiles' })
export class UserProfile {
  @PrimaryColumn()
  user_id!: string;

  @OneToOne(() => User, (user) => user.profile)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column()
  display_name!: string;

  @Column({ nullable: true, type: 'text' })
  bio?: string;

  @Column({ nullable: true })
  preferred_language?: string;

  @Column({ nullable: true })
  profile_image_url?: string;

  @Column({ default: false })
  is_private!: boolean;
}