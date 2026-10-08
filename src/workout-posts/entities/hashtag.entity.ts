import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Maps to havit.hashtags (2026-10-07-02-create-hashtags.sql, Sprint 10 B5):
 * one row per distinct tag, stored lowercase and without the leading '#'.
 * Rows are only written by HashtagsService.syncPostHashtags.
 */
@Entity({ schema: 'havit', name: 'hashtags' })
export class Hashtag {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  tag!: string;

  @CreateDateColumn()
  created_at!: Date;
}
