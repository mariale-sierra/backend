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
  bio?: string | null;

  @Column({ nullable: true })
  preferred_language?: string;

  @Column({ nullable: true })
  profile_image_url?: string;

  @Column({ default: false })
  is_private!: boolean;

  /** Self-reported sport/fitness practices (e.g. "Weightlifting", "Yoga") —
   * shown as colored badges on the profile screen. A plain Postgres text
   * array, not a join table: same "small, frontend-owned reference list"
   * pattern challenge categories/locations already use
   * (`constants/challengeCreateOptions.ts` on the frontend) — the valid
   * codes/labels/colors live in the frontend's own `practiceOptions.ts`,
   * not a backend table, so this column just stores whatever short strings
   * the client sends (capped at 6, see `UpdateUserProfileDto`). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  practice_preferences!: string[];
}
