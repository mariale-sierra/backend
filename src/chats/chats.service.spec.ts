import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { DirectConversation } from './entities/direct-conversation.entity';
import { DirectConversationMember } from './entities/direct-conversation-member.entity';
import { DirectMessage } from './entities/direct-message.entity';
import { DirectConversationHiddenBy } from './entities/direct-conversation-hidden-by.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SharedContentService } from './shared-content.service';

// B3: emitters call notify()/notifyMany() fire-and-forget; never throws.
const notificationsService = {
  notify: jest.fn().mockResolvedValue(null),
  notifyMany: jest.fn().mockResolvedValue(undefined),
};

// B5: shared post/challenge previews. Default: nothing shared resolves to
// an empty map, and anything shared is visible to the sender.
const createMockSharedContentService = () => ({
  assertPostShareable: jest.fn().mockResolvedValue(undefined),
  assertChallengeShareable: jest.fn().mockResolvedValue(undefined),
  resolvePosts: jest.fn().mockResolvedValue(new Map()),
  resolveChallenges: jest.fn().mockResolvedValue(new Map()),
});

const createMockQueryBuilder = () => {
  const qb: Record<string, jest.Mock> = {};
  const chain = [
    'innerJoin',
    'where',
    'andWhere',
    'select',
    'orderBy',
    'take',
    'update',
    'set',
  ];
  chain.forEach((method) => {
    qb[method] = jest.fn().mockReturnValue(qb);
  });
  qb.getRawOne = jest.fn();
  qb.getMany = jest.fn();
  qb.execute = jest.fn();
  return qb;
};

const createMockConversationRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn(),
  update: jest.fn(),
});

const createMockMemberRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createMockMessageRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createMockUserRepo = () => ({
  findOne: jest.fn(),
});

// B4: per-user hidden conversations. Default: the viewer hid nothing.
const createMockHiddenRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn((data: Record<string, unknown>) => Promise.resolve(data)),
  delete: jest.fn().mockResolvedValue({ affected: 0 }),
});

describe('ChatsService', () => {
  let service: ChatsService;
  let conversationRepo: ReturnType<typeof createMockConversationRepo>;
  let memberRepo: ReturnType<typeof createMockMemberRepo>;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let userRepo: ReturnType<typeof createMockUserRepo>;
  let hiddenRepo: ReturnType<typeof createMockHiddenRepo>;
  let sharedContentService: ReturnType<typeof createMockSharedContentService>;

  beforeEach(async () => {
    sharedContentService = createMockSharedContentService();
    conversationRepo = createMockConversationRepo();
    memberRepo = createMockMemberRepo();
    messageRepo = createMockMessageRepo();
    userRepo = createMockUserRepo();
    hiddenRepo = createMockHiddenRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatsService,
        { provide: NotificationsService, useValue: notificationsService },
        { provide: SharedContentService, useValue: sharedContentService },
        {
          provide: getRepositoryToken(DirectConversation),
          useValue: conversationRepo,
        },
        {
          provide: getRepositoryToken(DirectConversationMember),
          useValue: memberRepo,
        },
        { provide: getRepositoryToken(DirectMessage), useValue: messageRepo },
        {
          provide: getRepositoryToken(DirectConversationHiddenBy),
          useValue: hiddenRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(ChatsService);
  });

  describe('findOrCreateDirectConversation', () => {
    it('should reject starting a conversation with yourself before touching the database', async () => {
      await expect(
        service.findOrCreateDirectConversation('user-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the recipient does not exist or is inactive', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOrCreateDirectConversation('user-1', 'user-2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a new conversation with exactly the two participants when none exists yet', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'user-2' }) // recipient lookup
        .mockResolvedValueOnce({
          id: 'user-2',
          username: 'bob',
          profile: undefined,
        }); // buildConversationSummary

      const qb = createMockQueryBuilder();
      qb.getRawOne.mockResolvedValue(null); // no existing conversation
      memberRepo.createQueryBuilder.mockReturnValue(qb);

      conversationRepo.save.mockResolvedValue({
        id: 'conv-1',
        created_at: new Date('2026-09-01T00:00:00Z'),
      });
      conversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        created_at: new Date('2026-09-01T00:00:00Z'),
      });
      memberRepo.save.mockResolvedValue(undefined);
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-2',
      });
      messageRepo.findOne.mockResolvedValue(null);
      messageRepo.count.mockResolvedValue(0);

      const result = await service.findOrCreateDirectConversation(
        'user-1',
        'user-2',
      );

      // The initiator (userA, the caller) starts 'accepted'; the recipient
      // (userB) starts 'pending' — the message-request behavior.
      expect(memberRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          direct_conversation_id: 'conv-1',
          user_id: 'user-1',
          status: 'accepted',
        }),
        expect.objectContaining({
          direct_conversation_id: 'conv-1',
          user_id: 'user-2',
          status: 'pending',
        }),
      ]);
      expect(result.id).toBe('conv-1');
      expect(result.otherParticipant.id).toBe('user-2');
    });

    it('should return the existing conversation instead of creating a duplicate', async () => {
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'user-2' })
        .mockResolvedValueOnce({
          id: 'user-2',
          username: 'bob',
          profile: undefined,
        });

      const qb = createMockQueryBuilder();
      qb.getRawOne.mockResolvedValue({ conversationId: 'existing-conv' });
      memberRepo.createQueryBuilder.mockReturnValue(qb);

      conversationRepo.findOne.mockResolvedValue({
        id: 'existing-conv',
        created_at: new Date('2026-08-01T00:00:00Z'),
      });
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'existing-conv',
        user_id: 'user-2',
      });
      messageRepo.findOne.mockResolvedValue(null);
      messageRepo.count.mockResolvedValue(0);

      const result = await service.findOrCreateDirectConversation(
        'user-1',
        'user-2',
      );

      expect(conversationRepo.save).not.toHaveBeenCalled();
      expect(memberRepo.save).not.toHaveBeenCalled();
      expect(result.id).toBe('existing-conv');
    });
  });

  describe('listConversations', () => {
    it('should return an empty array when the user has no conversations', async () => {
      memberRepo.find.mockResolvedValue([]);

      const result = await service.listConversations('user-1');

      expect(result).toEqual([]);
    });

    it('should sort conversations by most recent activity (last message over conversation creation)', async () => {
      memberRepo.find.mockResolvedValue([
        { direct_conversation_id: 'conv-old', user_id: 'user-1' },
        { direct_conversation_id: 'conv-new', user_id: 'user-1' },
      ]);

      conversationRepo.findOne.mockImplementation(
        (opts: { where: { id: string } }) => {
          const { id } = opts.where;
          if (id === 'conv-old') {
            return Promise.resolve({
              id,
              created_at: new Date('2026-01-01T00:00:00Z'),
            });
          }
          return Promise.resolve({
            id,
            created_at: new Date('2026-08-01T00:00:00Z'),
          });
        },
      );

      memberRepo.findOne.mockImplementation(
        (opts: { where: { direct_conversation_id: string } }) =>
          Promise.resolve({
            direct_conversation_id: opts.where.direct_conversation_id,
            user_id: 'other-user',
          }),
      );

      userRepo.findOne.mockResolvedValue({
        id: 'other-user',
        username: 'other',
      });

      messageRepo.findOne.mockImplementation(
        (opts: { where: { direct_conversation_id: string } }) => {
          if (opts.where.direct_conversation_id === 'conv-old') {
            // Old conversation, but its last message is very recent.
            return Promise.resolve({
              id: 1,
              message_text: 'hi',
              user_id: 'other-user',
              sent_at: new Date('2026-09-01T00:00:00Z'),
            });
          }
          return Promise.resolve(null);
        },
      );
      messageRepo.count.mockResolvedValue(0);

      const result = await service.listConversations('user-1');

      expect(result.map((c) => c.id)).toEqual(['conv-old', 'conv-new']);
    });

    it('should silently skip a conversation whose other participant no longer exists', async () => {
      memberRepo.find.mockResolvedValue([
        { direct_conversation_id: 'conv-1', user_id: 'user-1' },
      ]);
      conversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        created_at: new Date(),
      });
      // No "other" member found — as if the other user's account (and their
      // membership row, cascaded) was deleted.
      memberRepo.findOne.mockResolvedValue(null);

      const result = await service.listConversations('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('listMessages', () => {
    it('should throw NotFoundException when the caller is not a participant', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.listMessages('intruder', 'conv-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return messages oldest-first and a nextBefore cursor when there are more rows than the limit', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
      });

      const qb = createMockQueryBuilder();
      // limit=2 requested -> service asks for 3 (limit+1) to detect "hasMore"
      qb.getMany.mockResolvedValue([
        {
          id: 5,
          message_text: 'c',
          user_id: 'user-1',
          direct_conversation_id: 'conv-1',
          sent_at: new Date(),
          read_at: null,
        },
        {
          id: 4,
          message_text: 'b',
          user_id: 'user-2',
          direct_conversation_id: 'conv-1',
          sent_at: new Date(),
          read_at: null,
        },
        {
          id: 3,
          message_text: 'a',
          user_id: 'user-1',
          direct_conversation_id: 'conv-1',
          sent_at: new Date(),
          read_at: null,
        },
      ]);
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMessages('user-1', 'conv-1', {
        limit: 2,
      });

      expect(qb.take).toHaveBeenCalledWith(3);
      expect(result.messages.map((m) => m.id)).toEqual([4, 5]); // oldest-first, trimmed to limit
      expect(result.nextBefore).toBe(4); // id of the oldest row actually returned
    });

    it('should return nextBefore null on the last page', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
      });

      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([
        {
          id: 2,
          message_text: 'b',
          user_id: 'user-1',
          direct_conversation_id: 'conv-1',
          sent_at: new Date(),
          read_at: null,
        },
        {
          id: 1,
          message_text: 'a',
          user_id: 'user-1',
          direct_conversation_id: 'conv-1',
          sent_at: new Date(),
          read_at: null,
        },
      ]);
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMessages('user-1', 'conv-1', {
        limit: 10,
      });

      expect(result.nextBefore).toBeNull();
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      // B4: sendMessage now requires a globally active conversation.
      conversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        is_active: true,
      });
    });

    it('should throw NotFoundException when the caller is not a participant', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.sendMessage('intruder', 'conv-1', 'hi'),
      ).rejects.toThrow(NotFoundException);
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should persist the message tied to the sender and conversation', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
      });
      messageRepo.save.mockImplementation((m) =>
        Promise.resolve({ ...m, id: 42, sent_at: new Date(), read_at: null }),
      );

      const result = await service.sendMessage('user-1', 'conv-1', 'hola');

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          direct_conversation_id: 'conv-1',
          user_id: 'user-1',
          message_text: 'hola',
        }),
      );
      expect(result.id).toBe(42);
      expect(result.content).toBe('hola');
    });

    it("should reject with Forbidden while the caller's own membership is still 'pending', without persisting anything", async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
        status: 'pending',
      });

      await expect(
        service.sendMessage('user-1', 'conv-1', 'hola'),
      ).rejects.toThrow(ForbiddenException);
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it("should allow sending once the caller's membership is 'accepted'", async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
        status: 'accepted',
      });
      messageRepo.save.mockImplementation((m) =>
        Promise.resolve({ ...m, id: 42, sent_at: new Date(), read_at: null }),
      );

      await expect(
        service.sendMessage('user-1', 'conv-1', 'hola'),
      ).resolves.toMatchObject({ id: 42 });
    });

    describe('sharing content (B5)', () => {
      beforeEach(() => {
        memberRepo.findOne.mockResolvedValue({
          direct_conversation_id: 'conv-1',
          user_id: 'user-1',
          status: 'accepted',
        });
        messageRepo.save.mockImplementation((m) =>
          Promise.resolve({ ...m, id: 7, sent_at: new Date(), read_at: null }),
        );
      });

      it('shares a post with no text, stored as an empty message_text', async () => {
        const preview = { id: 'post-1', available: true };
        sharedContentService.resolvePosts.mockResolvedValue(
          new Map([['post-1', preview]]),
        );

        const result = await service.sendMessage(
          'user-1',
          'conv-1',
          undefined,
          {
            workoutPostId: 'post-1',
          },
        );

        expect(sharedContentService.assertPostShareable).toHaveBeenCalledWith(
          'post-1',
          'user-1',
        );
        expect(messageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            message_text: '',
            workout_post_id: 'post-1',
            challenge_id: null,
          }),
        );
        expect(result.sharedPost).toBe(preview);
        expect(result.sharedChallenge).toBeNull();
      });

      it('shares a challenge together with a comment', async () => {
        await service.sendMessage('user-1', 'conv-1', '¡Únete!', {
          challengeId: 'ch-1',
        });

        expect(
          sharedContentService.assertChallengeShareable,
        ).toHaveBeenCalledWith('ch-1');
        expect(messageRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            message_text: '¡Únete!',
            workout_post_id: null,
            challenge_id: 'ch-1',
          }),
        );
      });

      it('does not persist a post the sender cannot see', async () => {
        sharedContentService.assertPostShareable.mockRejectedValue(
          new NotFoundException('Workout post not found'),
        );

        await expect(
          service.sendMessage('user-1', 'conv-1', undefined, {
            workoutPostId: 'post-private',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(messageRepo.save).not.toHaveBeenCalled();
      });

      it('rejects sharing a post and a challenge in the same message', async () => {
        await expect(
          service.sendMessage('user-1', 'conv-1', undefined, {
            workoutPostId: 'post-1',
            challengeId: 'ch-1',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(messageRepo.save).not.toHaveBeenCalled();
      });

      it('rejects a message with neither text nor shared content', async () => {
        await expect(
          service.sendMessage('user-1', 'conv-1', '   '),
        ).rejects.toThrow(BadRequestException);
        expect(messageRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('acceptRequest', () => {
    it('should throw NotFoundException when the caller has no membership row', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(service.acceptRequest('intruder', 'conv-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(memberRepo.save).not.toHaveBeenCalled();
    });

    it("should flip the caller's own status to 'accepted' and return a summary with isPending: false", async () => {
      const membership = {
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
        status: 'pending',
      };
      memberRepo.findOne
        .mockResolvedValueOnce(membership) // the caller's own row, looked up first
        .mockResolvedValueOnce({
          direct_conversation_id: 'conv-1',
          user_id: 'other-user',
        }) // otherMember, inside buildConversationSummary
        .mockResolvedValueOnce({
          direct_conversation_id: 'conv-1',
          user_id: 'user-1',
          status: 'accepted',
        }); // viewerMember, re-read after save — reflects the flip
      memberRepo.save.mockResolvedValue(undefined);
      conversationRepo.findOne.mockResolvedValue({
        id: 'conv-1',
        created_at: new Date('2026-09-01T00:00:00Z'),
      });
      userRepo.findOne.mockResolvedValue({
        id: 'other-user',
        username: 'bob',
      });
      messageRepo.findOne.mockResolvedValue(null);
      messageRepo.count.mockResolvedValue(0);

      const result = await service.acceptRequest('user-1', 'conv-1');

      expect(memberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'accepted' }),
      );
      expect(result.isPending).toBe(false);
    });
  });

  describe('declineRequest', () => {
    it('should throw NotFoundException when the caller has no membership row', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.declineRequest('intruder', 'conv-1'),
      ).rejects.toThrow(NotFoundException);
      expect(conversationRepo.update).not.toHaveBeenCalled();
    });

    it('should soft-delete the whole conversation (is_active: false), removing it for both participants', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
        status: 'pending',
      });

      await service.declineRequest('user-1', 'conv-1');

      expect(conversationRepo.update).toHaveBeenCalledWith('conv-1', {
        is_active: false,
      });
    });

    it('should no longer be visible to either participant afterward — buildConversationSummary returns null for an inactive conversation', async () => {
      memberRepo.find.mockResolvedValue([
        { direct_conversation_id: 'conv-1', user_id: 'user-1' },
      ]);
      // Matches a real is_active: true filter: a soft-deleted conversation
      // simply doesn't come back from this lookup.
      conversationRepo.findOne.mockResolvedValue(null);

      const result = await service.listConversations('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('markConversationRead', () => {
    it('should throw NotFoundException when the caller is not a participant', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.markConversationRead('intruder', 'conv-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it("should only mark the other participant's messages as read, never the caller's own", async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
      });

      const qb = createMockQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 3 });
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.markConversationRead('user-1', 'conv-1');

      expect(qb.andWhere).toHaveBeenCalledWith('user_id != :userId', {
        userId: 'user-1',
      });
      expect(result.updated).toBe(3);
    });
  });

  describe('notifications (B3)', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
      notificationsService.notifyMany.mockClear();
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
        status: 'accepted',
      });
      messageRepo.save.mockImplementation((m) =>
        Promise.resolve({ ...m, id: 42, sent_at: new Date(), read_at: null }),
      );
    });

    it('notifies the other participant of an active conversation (no message text)', async () => {
      conversationRepo.findOne.mockResolvedValue({ id: 'conv-1' });
      memberRepo.find.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);

      await service.sendMessage('user-1', 'conv-1', 'private words');
      await flush();

      expect(notificationsService.notifyMany).toHaveBeenCalledWith(['user-2'], {
        actorUserId: 'user-1',
        type: 'direct_message',
        entity: { type: 'direct_conversation', id: 'conv-1' },
      });
    });

    it('does not notify the person who declined (soft-deleted) the conversation', async () => {
      // B4: a declined (globally inactive) conversation now refuses the send
      // outright, so nothing is persisted and nobody is notified.
      conversationRepo.findOne.mockResolvedValue(null);
      memberRepo.find.mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
      ]);

      await expect(
        service.sendMessage('user-1', 'conv-1', 'hola'),
      ).rejects.toThrow(NotFoundException);
      await flush();

      expect(messageRepo.save).not.toHaveBeenCalled();
      expect(notificationsService.notifyMany).not.toHaveBeenCalled();
    });

    it('still delivers the message when looking up recipients fails', async () => {
      conversationRepo.findOne
        .mockResolvedValueOnce({ id: 'conv-1', is_active: true }) // send guard
        .mockRejectedValueOnce(new Error('db down')); // notification lookup
      memberRepo.find.mockResolvedValue([]);

      const result = await service.sendMessage('user-1', 'conv-1', 'hola');
      await flush();

      expect(result.id).toBe(42);
    });
  });

  // ---------------------------------------------------------------------
  // Sprint 9 (B4): deleting a single message (sender only, soft delete).
  // ---------------------------------------------------------------------
  describe('deleteMessage (B4)', () => {
    const member = { direct_conversation_id: 'conv-1', user_id: 'user-1' };

    it('should 404 a non-participant before looking the message up', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteMessage('intruder', 'conv-1', 42),
      ).rejects.toThrow(NotFoundException);
      expect(messageRepo.findOne).not.toHaveBeenCalled();
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should only find an active message inside THIS conversation', async () => {
      memberRepo.findOne.mockResolvedValue(member);
      messageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteMessage('user-1', 'conv-1', 42),
      ).rejects.toThrow(NotFoundException);
      expect(messageRepo.findOne).toHaveBeenCalledWith({
        where: { id: 42, direct_conversation_id: 'conv-1', is_active: true },
      });
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should soft-delete the sender’s own message (is_active=false via save)', async () => {
      memberRepo.findOne.mockResolvedValue(member);
      const message = {
        id: 42,
        direct_conversation_id: 'conv-1',
        user_id: 'user-1',
        is_active: true,
      };
      messageRepo.findOne.mockResolvedValue(message);
      messageRepo.save.mockImplementation((m) => Promise.resolve(m));

      await service.deleteMessage('user-1', 'conv-1', 42);

      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, is_active: false }),
      );
      // The conversation itself is never touched.
      expect(conversationRepo.update).not.toHaveBeenCalled();
      expect(conversationRepo.save).not.toHaveBeenCalled();
    });

    it("should forbid deleting the other participant's message", async () => {
      memberRepo.findOne.mockResolvedValue(member);
      messageRepo.findOne.mockResolvedValue({
        id: 43,
        direct_conversation_id: 'conv-1',
        user_id: 'user-2',
        is_active: true,
      });

      await expect(
        service.deleteMessage('user-1', 'conv-1', 43),
      ).rejects.toThrow(ForbiddenException);
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should keep deleted messages out of listMessages (active-only read)', async () => {
      memberRepo.findOne.mockResolvedValue(member);
      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      await service.listMessages('user-1', 'conv-1', {});

      expect(qb.andWhere).toHaveBeenCalledWith('m.is_active = true');
    });
  });

  // ---------------------------------------------------------------------
  // Sprint 9 (B4): hiding a conversation from MY list only.
  // ---------------------------------------------------------------------
  describe('hideConversation / per-user visibility (B4)', () => {
    const conversation = {
      id: 'conv-1',
      created_at: new Date('2026-10-01T00:00:00Z'),
      is_active: true,
    };

    function mockSummaryLookups(viewerId: string, otherId: string) {
      conversationRepo.findOne.mockResolvedValue(conversation);
      memberRepo.findOne.mockImplementation(
        ({ where }: { where: { user_id: unknown } }) =>
          Promise.resolve(
            typeof where.user_id === 'string'
              ? { direct_conversation_id: 'conv-1', user_id: viewerId }
              : { direct_conversation_id: 'conv-1', user_id: otherId },
          ),
      );
      userRepo.findOne.mockResolvedValue({ id: otherId, username: otherId });
      messageRepo.findOne.mockResolvedValue(null);
      messageRepo.count.mockResolvedValue(0);
    }

    it('should 404 a non-participant without writing anything', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.hideConversation('intruder', 'conv-1'),
      ).rejects.toThrow(NotFoundException);
      expect(hiddenRepo.save).not.toHaveBeenCalled();
    });

    it('should record a hidden_by row for the caller only, leaving messages and the conversation alone', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-a',
      });

      await service.hideConversation('user-a', 'conv-1');

      expect(hiddenRepo.save).toHaveBeenCalledWith({
        direct_conversation_id: 'conv-1',
        user_id: 'user-a',
      });
      expect(conversationRepo.update).not.toHaveBeenCalled();
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should be idempotent: hiding an already-hidden conversation writes nothing', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-a',
      });
      hiddenRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-a',
      });

      await expect(
        service.hideConversation('user-a', 'conv-1'),
      ).resolves.toBeUndefined();
      expect(hiddenRepo.save).not.toHaveBeenCalled();
    });

    it('should treat a concurrent duplicate hide (23505) as success', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-a',
      });
      hiddenRepo.save.mockRejectedValue(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      await expect(
        service.hideConversation('user-a', 'conv-1'),
      ).resolves.toBeUndefined();
    });

    it('A no longer sees the conversation it hid', async () => {
      memberRepo.find.mockResolvedValue([
        { direct_conversation_id: 'conv-1', user_id: 'user-a' },
      ]);
      hiddenRepo.find.mockResolvedValue([
        { direct_conversation_id: 'conv-1', user_id: 'user-a' },
      ]);

      await expect(service.listConversations('user-a')).resolves.toEqual([]);
      expect(hiddenRepo.find).toHaveBeenCalledWith({
        where: { user_id: 'user-a' },
      });
      expect(conversationRepo.findOne).not.toHaveBeenCalled();
    });

    it('B still sees the same conversation (only A hid it)', async () => {
      memberRepo.find.mockResolvedValue([
        { direct_conversation_id: 'conv-1', user_id: 'user-b' },
      ]);
      // hidden_by lookups are scoped per viewer: B has no row.
      hiddenRepo.find.mockResolvedValue([]);
      mockSummaryLookups('user-b', 'user-a');

      const list = await service.listConversations('user-b');

      expect(list.map((c) => c.id)).toEqual(['conv-1']);
    });

    it('listMessages is a pure read: it never unhides the conversation', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-a',
      });
      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([
        {
          id: 1,
          direct_conversation_id: 'conv-1',
          user_id: 'user-b',
          message_text: 'still here',
          sent_at: new Date(),
          read_at: null,
          is_active: true,
        },
      ]);
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMessages('user-a', 'conv-1', {});

      // History is preserved for the user who hid the chat…
      expect(result.messages.map((m) => m.content)).toEqual(['still here']);
      // …and reading it changes no state.
      expect(hiddenRepo.delete).not.toHaveBeenCalled();
      expect(hiddenRepo.save).not.toHaveBeenCalled();
    });

    it('a successfully sent message brings the conversation back (clears hidden_by AFTER saving)', async () => {
      const order: string[] = [];
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-b',
        status: 'accepted',
      });
      conversationRepo.findOne.mockResolvedValue(conversation);
      memberRepo.find.mockResolvedValue([]);
      messageRepo.save.mockImplementation((m) => {
        order.push('save');
        return Promise.resolve({ ...m, id: 7, sent_at: new Date() });
      });
      hiddenRepo.delete.mockImplementation(() => {
        order.push('unhide');
        return Promise.resolve({ affected: 1 });
      });

      await service.sendMessage('user-b', 'conv-1', 'hey again');

      expect(hiddenRepo.delete).toHaveBeenCalledWith({
        direct_conversation_id: 'conv-1',
      });
      expect(order).toEqual(['save', 'unhide']);
    });

    it('a failed send never unhides the conversation', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-b',
        status: 'accepted',
      });
      conversationRepo.findOne.mockResolvedValue(conversation);
      messageRepo.save.mockRejectedValue(new Error('db down'));

      await expect(
        service.sendMessage('user-b', 'conv-1', 'hey'),
      ).rejects.toThrow('db down');
      expect(hiddenRepo.delete).not.toHaveBeenCalled();
    });

    it('a globally inactive (declined) conversation blocks sendMessage and stays hidden', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-b',
        status: 'accepted',
      });
      conversationRepo.findOne.mockResolvedValue(null); // is_active = false

      await expect(
        service.sendMessage('user-b', 'conv-1', 'hey'),
      ).rejects.toThrow(NotFoundException);
      expect(conversationRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'conv-1', is_active: true },
      });
      expect(messageRepo.save).not.toHaveBeenCalled();
      expect(hiddenRepo.delete).not.toHaveBeenCalled();
    });

    it('declineRequest stays global and separate from hiding', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-a',
      });

      await service.declineRequest('user-a', 'conv-1');

      expect(conversationRepo.update).toHaveBeenCalledWith('conv-1', {
        is_active: false,
      });
      expect(hiddenRepo.save).not.toHaveBeenCalled();
    });

    it('a still-delivered message survives an unhide failure', async () => {
      memberRepo.findOne.mockResolvedValue({
        direct_conversation_id: 'conv-1',
        user_id: 'user-b',
        status: 'accepted',
      });
      conversationRepo.findOne.mockResolvedValue(conversation);
      memberRepo.find.mockResolvedValue([]);
      messageRepo.save.mockImplementation((m) =>
        Promise.resolve({ ...m, id: 8, sent_at: new Date() }),
      );
      hiddenRepo.delete.mockRejectedValue(new Error('db hiccup'));

      await expect(
        service.sendMessage('user-b', 'conv-1', 'hey'),
      ).resolves.toMatchObject({ id: 8 });
    });
  });
});
