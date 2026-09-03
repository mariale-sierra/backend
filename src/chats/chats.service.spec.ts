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
import { User } from '../users/entities/user.entity';

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

describe('ChatsService', () => {
  let service: ChatsService;
  let conversationRepo: ReturnType<typeof createMockConversationRepo>;
  let memberRepo: ReturnType<typeof createMockMemberRepo>;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let userRepo: ReturnType<typeof createMockUserRepo>;

  beforeEach(async () => {
    conversationRepo = createMockConversationRepo();
    memberRepo = createMockMemberRepo();
    messageRepo = createMockMessageRepo();
    userRepo = createMockUserRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatsService,
        {
          provide: getRepositoryToken(DirectConversation),
          useValue: conversationRepo,
        },
        {
          provide: getRepositoryToken(DirectConversationMember),
          useValue: memberRepo,
        },
        { provide: getRepositoryToken(DirectMessage), useValue: messageRepo },
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
});
