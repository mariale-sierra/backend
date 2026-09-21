import { Entity, PrimaryGeneratedColumn, Column, OneToOne } from 'typeorm';
import { UserProfile } from './user-profile.entity';

@Entity({ schema: 'havit', name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password_hash!: string;

  @Column({ default: true })
  is_active!: boolean;

  // Global platform admin — 2026-09-21-01-add-user-is-admin.sql. No endpoint ever sets
  // this on the caller's own account; the first admin is always granted by hand,
  // directly against the database (see that migration's own comment).
  @Column({ default: false })
  is_admin!: boolean;

  @OneToOne(() => UserProfile, (profile) => profile.user)
  profile?: UserProfile;
}
