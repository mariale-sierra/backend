import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Challenge } from '../../challenges/entities/challenge.entity';
import { User } from '../../users/entities/user.entity';

export type ChallengeInviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired';

@Entity({ schema: 'havit', name: 'challenge_invites' })
export class ChallengeInvite {
  // BIGINT GENERATED ALWAYS AS IDENTITY — pg driver returns it as string.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  challenge_id!: string;

  @Column({ type: 'uuid' })
  sender_user_id!: string;

  @Column({ type: 'uuid' })
  recipient_user_id!: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'accepted', 'declined', 'cancelled', 'expired'],
    enumName: 'challenge_invite_status_enum',
  })
  status!: ChallengeInviteStatus;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  responded_at?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expires_at?: Date | null;

  @Column({ default: true })
  is_active!: boolean;

  @ManyToOne(() => Challenge)
  @JoinColumn({ name: 'challenge_id' })
  challenge?: Challenge;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'sender_user_id' })
  sender?: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'recipient_user_id' })
  recipient?: User;
}
