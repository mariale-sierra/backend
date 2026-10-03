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

  // B2 — consent trail (2026-10-02-03 migration). NULL for accounts created
  // before T&C acceptance existed.
  @Column({ type: 'timestamptz', nullable: true })
  terms_accepted_at?: Date | null;

  @Column({ type: 'text', nullable: true })
  terms_version?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  age_confirmed_at?: Date | null;

  // B2 — account deletion. Requested -> grace period -> purged by
  // AccountDeletionService; the row itself is kept, anonymized.
  @Column({ type: 'timestamptz', nullable: true })
  deletion_requested_at?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletion_scheduled_for?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deleted_at?: Date | null;

  @OneToOne(() => UserProfile, (profile) => profile.user)
  profile?: UserProfile;
}
