import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { DirectConversation } from './entities/direct-conversation.entity';
import { DirectConversationMember } from './entities/direct-conversation-member.entity';
import { DirectMessage } from './entities/direct-message.entity';
import { User } from '../users/entities/user.entity';
import { MessageDto } from './dto/message.dto';
import {
  ConversationSummaryDto,
  LastMessagePreviewDto,
} from './dto/conversation-summary.dto';
import { ConversationParticipantDto } from './dto/conversation-participant.dto';
import {
  DEFAULT_MESSAGES_LIMIT,
  MAX_MESSAGES_LIMIT,
} from './dto/messages-query.dto';

export interface ListMessagesResult {
  messages: MessageDto[];
  nextBefore: number | null;
}

@Injectable()
export class ChatsService {
  constructor(
    @InjectRepository(DirectConversation)
    private conversationRepo: Repository<DirectConversation>,
    @InjectRepository(DirectConversationMember)
    private memberRepo: Repository<DirectConversationMember>,
    @InjectRepository(DirectMessage)
    private messageRepo: Repository<DirectMessage>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  /**
   * Returns the existing 1:1 conversation between the two users, or creates
   * one. Every conversation this service creates has exactly two members
   * (group chat is the separate havit.spaces schema, out of scope here), so
   * "a conversation containing both user ids" is unambiguous — no separate
   * dedup column needed. Known limitation, accepted rather than solved with
   * an advisory lock: two simultaneous first-DM calls between the same pair
   * could in theory race into two conversations instead of one.
   */
  async findOrCreateDirectConversation(
    currentUserId: string,
    recipientUserId: string,
  ): Promise<ConversationSummaryDto> {
    if (currentUserId === recipientUserId) {
      throw new BadRequestException(
        'You cannot start a conversation with yourself',
      );
    }

    const recipient = await this.userRepo.findOne({
      where: { id: recipientUserId, is_active: true },
    });
    if (!recipient) {
      throw new NotFoundException('User not found');
    }

    const existingId = await this.findExistingConversationId(
      currentUserId,
      recipientUserId,
    );

    const conversationId =
      existingId ??
      (await this.createConversation(currentUserId, recipientUserId));

    const summary = await this.buildConversationSummary(
      conversationId,
      currentUserId,
    );
    if (!summary) {
      throw new NotFoundException('Conversation not found');
    }
    return summary;
  }

  async listConversations(userId: string): Promise<ConversationSummaryDto[]> {
    const memberships = await this.memberRepo.find({
      where: { user_id: userId },
    });
    if (memberships.length === 0) return [];

    const summaries = await Promise.all(
      memberships.map((m) =>
        this.buildConversationSummary(m.direct_conversation_id, userId),
      ),
    );

    return summaries
      .filter((s): s is ConversationSummaryDto => s !== null)
      .sort((a, b) => {
        const aTime = (a.lastMessage?.sentAt ?? a.createdAt).getTime();
        const bTime = (b.lastMessage?.sentAt ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }

  async listMessages(
    userId: string,
    conversationId: string,
    query: { before?: number; limit?: number },
  ): Promise<ListMessagesResult> {
    await this.assertMembership(conversationId, userId);

    const limit = Math.min(
      query.limit ?? DEFAULT_MESSAGES_LIMIT,
      MAX_MESSAGES_LIMIT,
    );

    const qb = this.messageRepo
      .createQueryBuilder('m')
      .where('m.direct_conversation_id = :conversationId', { conversationId })
      .andWhere('m.is_active = true')
      .orderBy('m.id', 'DESC')
      .take(limit + 1);

    if (query.before !== undefined) {
      qb.andWhere('m.id < :before', { before: query.before });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextBefore = hasMore ? page[page.length - 1].id : null;

    // Reversed to oldest-first — the natural order for rendering a thread.
    const messages = page.reverse().map((m) => this.toMessageDto(m));

    return { messages, nextBefore };
  }

  /**
   * Persists and returns a new message. Deliberately does NOT run any
   * content moderation yet — Esteban's Moderation API (Bloque 4) isn't in
   * this repo yet, so there's no contract to integrate against without
   * duplicating validation logic. This is the single place that call
   * belongs once that contract exists (mirror how
   * WorkoutPostsService.create calls ModerationService.validateWorkoutImage
   * before persisting).
   */
  async sendMessage(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<MessageDto> {
    await this.assertMembership(conversationId, userId);

    // A pending recipient can already read (assertMembership alone covers
    // that) but can't reply until they accept the request — the frontend
    // already hides the composer for this state, this is defense in depth
    // so the endpoint doesn't just trust that.
    const membership = await this.memberRepo.findOne({
      where: { direct_conversation_id: conversationId, user_id: userId },
    });
    if (membership?.status === 'pending') {
      throw new ForbiddenException('Accept this request before replying');
    }

    const message = this.messageRepo.create({
      direct_conversation_id: conversationId,
      user_id: userId,
      message_text: content,
    });
    const saved = await this.messageRepo.save(message);
    return this.toMessageDto(saved);
  }

  /** Marks every unread message from the OTHER participant as read. */
  async markConversationRead(
    userId: string,
    conversationId: string,
  ): Promise<{ updated: number }> {
    await this.assertMembership(conversationId, userId);

    const result = await this.messageRepo
      .createQueryBuilder()
      .update(DirectMessage)
      .set({ read_at: () => 'CURRENT_TIMESTAMP' })
      .where('direct_conversation_id = :conversationId', { conversationId })
      .andWhere('user_id != :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();

    return { updated: result.affected ?? 0 };
  }

  /** Accepts a message request — flips the caller's OWN membership row from
   * 'pending' to 'accepted', unlocking sendMessage() for them. Same
   * "conversation not found" status for a missing membership row as
   * assertMembership uses elsewhere in this service. */
  async acceptRequest(
    userId: string,
    conversationId: string,
  ): Promise<ConversationSummaryDto> {
    const membership = await this.memberRepo.findOne({
      where: { direct_conversation_id: conversationId, user_id: userId },
    });
    if (!membership) throw new NotFoundException('Conversation not found');

    membership.status = 'accepted';
    await this.memberRepo.save(membership);

    const summary = await this.buildConversationSummary(conversationId, userId);
    if (!summary) throw new NotFoundException('Conversation not found');
    return summary;
  }

  /** Declines a message request — soft-deletes the WHOLE conversation
   * (matches this codebase's existing soft-delete convention, e.g.
   * SpacesService.remove()), removing it for BOTH participants, not just
   * the decliner. */
  async declineRequest(userId: string, conversationId: string): Promise<void> {
    const membership = await this.memberRepo.findOne({
      where: { direct_conversation_id: conversationId, user_id: userId },
    });
    if (!membership) throw new NotFoundException('Conversation not found');

    await this.conversationRepo.update(conversationId, { is_active: false });
  }

  /**
   * `userA` is always the caller (findOrCreateDirectConversation's
   * currentUserId) — their own row starts 'accepted'; `userB`'s (the
   * recipient) starts 'pending', the message-request behavior: they can
   * read immediately but can't reply until they accept.
   */
  private async createConversation(
    userA: string,
    userB: string,
  ): Promise<string> {
    const conversation = await this.conversationRepo.save(
      this.conversationRepo.create({}),
    );
    await this.memberRepo.save([
      this.memberRepo.create({
        direct_conversation_id: conversation.id,
        user_id: userA,
        status: 'accepted',
      }),
      this.memberRepo.create({
        direct_conversation_id: conversation.id,
        user_id: userB,
        status: 'pending',
      }),
    ]);
    return conversation.id;
  }

  /**
   * Only matches an ACTIVE conversation — a previously declined one
   * (declineRequest soft-deletes it) must not be resurrected the next time
   * userA tries to message userB; a fresh conversation (with a fresh
   * 'pending' recipient row) should be created instead.
   */
  private async findExistingConversationId(
    userA: string,
    userB: string,
  ): Promise<string | null> {
    const row = await this.memberRepo
      .createQueryBuilder('m1')
      .innerJoin(
        DirectConversationMember,
        'm2',
        'm2.direct_conversation_id = m1.direct_conversation_id AND m2.user_id = :userB',
        { userB },
      )
      .innerJoin(
        DirectConversation,
        'c',
        'c.id = m1.direct_conversation_id AND c.is_active = true',
      )
      .where('m1.user_id = :userA', { userA })
      .select('m1.direct_conversation_id', 'conversationId')
      .getRawOne<{ conversationId: string }>();

    return row?.conversationId ?? null;
  }

  /**
   * Same "not found" status whether the conversation id doesn't exist or the
   * caller just isn't a participant — doesn't confirm a conversation's
   * existence to someone outside it.
   */
  private async assertMembership(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.memberRepo.findOne({
      where: { direct_conversation_id: conversationId, user_id: userId },
    });
    if (!membership) {
      throw new NotFoundException('Conversation not found');
    }
  }

  private async buildConversationSummary(
    conversationId: string,
    viewerUserId: string,
  ): Promise<ConversationSummaryDto | null> {
    // is_active: true — a declined conversation (declineRequest soft-deletes
    // it) must stop showing up for either participant.
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, is_active: true },
    });
    if (!conversation) return null;

    const [otherMember, viewerMember] = await Promise.all([
      this.memberRepo.findOne({
        where: {
          direct_conversation_id: conversationId,
          user_id: Not(viewerUserId),
        },
      }),
      this.memberRepo.findOne({
        where: {
          direct_conversation_id: conversationId,
          user_id: viewerUserId,
        },
      }),
    ]);
    // Under this service's own invariant (always exactly two members), a
    // missing "other" member means that user's account is gone (FK cascade
    // removed their membership row) — treat the conversation as unusable
    // rather than showing a broken participant.
    if (!otherMember) return null;

    const otherUser = await this.userRepo.findOne({
      where: { id: otherMember.user_id },
      relations: { profile: true },
    });
    if (!otherUser) return null;

    const lastMessage = await this.messageRepo.findOne({
      where: { direct_conversation_id: conversationId, is_active: true },
      order: { id: 'DESC' },
    });

    const unreadCount = await this.messageRepo.count({
      where: {
        direct_conversation_id: conversationId,
        user_id: Not(viewerUserId),
        read_at: IsNull(),
        is_active: true,
      },
    });

    const summary = new ConversationSummaryDto();
    summary.id = conversationId;
    summary.createdAt = conversation.created_at;
    summary.otherParticipant = this.toParticipantDto(otherUser);
    summary.lastMessage = lastMessage
      ? this.toLastMessagePreview(lastMessage)
      : null;
    summary.unreadCount = unreadCount;
    // Only the recipient of a not-yet-accepted request sees this as true —
    // the initiator's own row is always 'accepted' (createConversation).
    summary.isPending = viewerMember?.status === 'pending';
    return summary;
  }

  private toParticipantDto(user: User): ConversationParticipantDto {
    const dto = new ConversationParticipantDto();
    dto.id = user.id;
    dto.username = user.username;
    dto.displayName = user.profile?.display_name ?? null;
    dto.profileImageUrl = user.profile?.profile_image_url ?? null;
    return dto;
  }

  private toLastMessagePreview(message: DirectMessage): LastMessagePreviewDto {
    const dto = new LastMessagePreviewDto();
    dto.id = message.id;
    dto.content = message.message_text;
    dto.senderId = message.user_id;
    dto.sentAt = message.sent_at;
    return dto;
  }

  private toMessageDto(message: DirectMessage): MessageDto {
    const dto = new MessageDto();
    dto.id = message.id;
    dto.conversationId = message.direct_conversation_id;
    dto.senderId = message.user_id;
    dto.content = message.message_text;
    dto.sentAt = message.sent_at;
    dto.readAt = message.read_at ?? null;
    return dto;
  }
}
