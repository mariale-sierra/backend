import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Challenge } from './challenge.entity';
import { User } from '../../users/entities/user.entity';

export type ChallengeJoinRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

/**
 * Maps to havit.challenge_join_requests (added in
 * 2026-09-20-01-add-challenge-roles.sql). Only used for PRIVATE challenges —
 * joining a public challenge still writes directly to challenge_user_map, no
 * row here. Same separation-of-concerns as SpaceJoinRequest vs SpaceMember.
 */
@Entity({ schema: 'havit', name: 'challenge_join_requests' })
export class ChallengeJoinRequest {
  // BIGINT GENERATED ALWAYS AS IDENTITY — pg driver returns it as string.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  challenge_id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    enumName: 'challenge_join_request_status_enum',
  })
  status!: ChallengeJoinRequestStatus;

  @CreateDateColumn()
  requested_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  responded_at?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  responded_by_user_id?: string | null;

  @ManyToOne(() => Challenge)
  @JoinColumn({ name: 'challenge_id' })
  challenge?: Challenge;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
