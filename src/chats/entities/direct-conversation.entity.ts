import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Maps to havit.direct_conversations, defined in the init schema (section
 * "9. MENSAJERÍA PRIVADA") but unused by any backend module until the chats
 * feature. Exclusively 1:1 — group chat lives in the separate
 * havit.spaces/space_members/space_messages tables, out of scope here.
 */
@Entity({ schema: 'havit', name: 'direct_conversations' })
export class DirectConversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  created_at!: Date;

  @Column({ default: true })
  is_active!: boolean;
}
