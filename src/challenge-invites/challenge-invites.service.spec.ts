import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChallengeInvitesService } from './challenge-invites.service';
import { ChallengeInvite } from './entities/challenge-invite.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { User } from '../users/entities/user.entity';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const SENDER = 'sender-uuid';
const RECIPIENT = 'recipient-uuid';
const CHALLENGE = 'challenge-uuid';
const INVITE_ID = '42';

describe('ChallengeInvitesService', () => {
  let service: ChallengeInvitesService;
  let inviteRepo: ReturnType<typeof createMockRepo>;
  let challengeRepo: ReturnType<typeof createMockRepo>;
  let memberRepo: ReturnType<typeof createMockRepo>;
  let userRepo: ReturnType<typeof createMockRepo>;
  let dataSource: { transaction: jest.Mock };

  const baseChallenge = () => ({
    id: CHALLENGE,
    name: 'Test challenge',
    created_by_user_id: SENDER,
    duration_days: 30,
  });

  const pendingInvite = () => ({
    id: INVITE_ID,
    challenge_id: CHALLENGE,
    sender_user_id: SENDER,
    recipient_user_id: RECIPIENT,
    status: 'pending' as const,
    is_active: true,
    created_at: new Date(),
    responded_at: null,
    expires_at: null,
  });

  beforeEach(async () => {
    inviteRepo = createMockRepo();
    challengeRepo = createMockRepo();
    memberRepo = createMockRepo();
    userRepo = createMockRepo();
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengeInvitesService,
        { provide: getRepositoryToken(ChallengeInvite), useValue: inviteRepo },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(ChallengeUserMap), useValue: memberRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ChallengeInvitesService);
  });

  describe('create', () => {
    const arrangeHappyPath = () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      userRepo.findOne.mockResolvedValue({ id: RECIPIENT, username: 'bob' });
      // First membership lookup = sender, second = recipient.
      memberRepo.findOne.mockResolvedValue(null);
      inviteRepo.findOne
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce({
          ...pendingInvite(),
          challenge: baseChallenge(),
        }); // reload with relations
      inviteRepo.create.mockImplementation((data: object) => ({ ...data }));
      inviteRepo.save.mockResolvedValue(pendingInvite());
    };

    it('should create a pending invite when the sender is the challenge creator', async () => {
      arrangeHappyPath();

      const result = await service.create(
        SENDER,
        CHALLENGE,
        RECIPIENT,
        '  join us  ',
      );

      expect(inviteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          challenge_id: CHALLENGE,
          sender_user_id: SENDER,
          recipient_user_id: RECIPIENT,
          status: 'pending',
          message: 'join us',
        }),
      );
      expect(result.status).toBe('pending');
    });

    it('should reject self-invites before touching the database', async () => {
      await expect(service.create(SENDER, CHALLENGE, SENDER)).rejects.toThrow(
        BadRequestException,
      );
      expect(challengeRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the challenge does not exist', async () => {
      challengeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(SENDER, CHALLENGE, RECIPIENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the recipient does not exist or is inactive', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(SENDER, CHALLENGE, RECIPIENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('should forbid senders who are neither creator nor active member', async () => {
      challengeRepo.findOne.mockResolvedValue({
        ...baseChallenge(),
        created_by_user_id: 'someone-else',
      });
      userRepo.findOne.mockResolvedValue({ id: RECIPIENT, username: 'bob' });
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(SENDER, CHALLENGE, RECIPIENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject inviting a user who is already an active member', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      userRepo.findOne.mockResolvedValue({ id: RECIPIENT, username: 'bob' });
      memberRepo.findOne
        .mockResolvedValueOnce(null) // sender (creator, so allowed)
        .mockResolvedValueOnce({ user_id: RECIPIENT, status: 'active' }); // recipient

      await expect(
        service.create(SENDER, CHALLENGE, RECIPIENT),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject a duplicate pending invite', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      userRepo.findOne.mockResolvedValue({ id: RECIPIENT, username: 'bob' });
      memberRepo.findOne.mockResolvedValue(null);
      inviteRepo.findOne.mockResolvedValue(pendingInvite());

      await expect(
        service.create(SENDER, CHALLENGE, RECIPIENT),
      ).rejects.toThrow(ConflictException);
      expect(inviteRepo.save).not.toHaveBeenCalled();
    });

    it('should translate the unique-index race (23505) into a 409', async () => {
      arrangeHappyPath();
      inviteRepo.save.mockRejectedValue(
        Object.assign(new Error('dup'), { code: '23505' }),
      );

      await expect(
        service.create(SENDER, CHALLENGE, RECIPIENT),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('accept', () => {
    const arrangeTransaction = (
      invite: object | null,
      existingMembership: object | null,
    ) => {
      const txInviteRepo = {
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(invite),
        }),
        save: jest.fn().mockImplementation((i: object) => Promise.resolve(i)),
      };
      const txMemberRepo = {
        findOne: jest.fn().mockResolvedValue(existingMembership),
        save: jest.fn().mockImplementation((m: object) => Promise.resolve(m)),
        create: jest.fn().mockImplementation((data: object) => ({ ...data })),
      };
      const manager = {
        getRepository: jest.fn((entity: unknown) =>
          entity === ChallengeInvite ? txInviteRepo : txMemberRepo,
        ),
      };
      dataSource.transaction.mockImplementation(
        async (cb: (m: unknown) => Promise<void>) => cb(manager),
      );
      inviteRepo.findOne.mockResolvedValue({
        ...pendingInvite(),
        status: 'accepted',
      });
      return { txInviteRepo, txMemberRepo };
    };

    it('should mark the invite accepted and add the member inside one transaction', async () => {
      const { txInviteRepo, txMemberRepo } = arrangeTransaction(
        pendingInvite(),
        null,
      );

      const result = await service.accept(INVITE_ID, RECIPIENT);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(txInviteRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'accepted',
          responded_at: expect.any(Date),
        }),
      );
      expect(txMemberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          challenge_id: CHALLENGE,
          user_id: RECIPIENT,
          role: 'participant',
          status: 'active',
        }),
      );
      expect(result.status).toBe('accepted');
    });

    it('should re-activate an existing non-active membership instead of inserting a duplicate', async () => {
      const existing = {
        challenge_id: CHALLENGE,
        user_id: RECIPIENT,
        status: 'left',
      };
      const { txMemberRepo } = arrangeTransaction(pendingInvite(), existing);

      await service.accept(INVITE_ID, RECIPIENT);

      expect(txMemberRepo.create).not.toHaveBeenCalled();
      expect(txMemberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('should forbid anyone other than the recipient from accepting', async () => {
      arrangeTransaction(pendingInvite(), null);

      await expect(service.accept(INVITE_ID, 'intruder')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject accepting an invite that is not pending', async () => {
      arrangeTransaction({ ...pendingInvite(), status: 'declined' }, null);

      await expect(service.accept(INVITE_ID, RECIPIENT)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject accepting an expired invite', async () => {
      arrangeTransaction(
        { ...pendingInvite(), expires_at: new Date(Date.now() - 60_000) },
        null,
      );

      await expect(service.accept(INVITE_ID, RECIPIENT)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException for a missing or inactive invite', async () => {
      arrangeTransaction(null, null);

      await expect(service.accept(INVITE_ID, RECIPIENT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('decline', () => {
    it('should mark a pending invite declined with a response timestamp', async () => {
      inviteRepo.findOne
        .mockResolvedValueOnce(pendingInvite())
        .mockResolvedValueOnce({ ...pendingInvite(), status: 'declined' });
      inviteRepo.save.mockImplementation((i: object) => Promise.resolve(i));

      const result = await service.decline(INVITE_ID, RECIPIENT);

      expect(inviteRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'declined',
          responded_at: expect.any(Date),
        }),
      );
      expect(result.status).toBe('declined');
    });

    it('should forbid the sender from declining their own invite', async () => {
      inviteRepo.findOne.mockResolvedValue(pendingInvite());

      await expect(service.decline(INVITE_ID, SENDER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject double-processing an already declined invite', async () => {
      inviteRepo.findOne.mockResolvedValue({
        ...pendingInvite(),
        status: 'declined',
      });

      await expect(service.decline(INVITE_ID, RECIPIENT)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cancel', () => {
    it('should let the sender cancel a pending invite', async () => {
      inviteRepo.findOne
        .mockResolvedValueOnce(pendingInvite())
        .mockResolvedValueOnce({ ...pendingInvite(), status: 'cancelled' });
      inviteRepo.save.mockImplementation((i: object) => Promise.resolve(i));

      const result = await service.cancel(INVITE_ID, SENDER);

      expect(result.status).toBe('cancelled');
    });

    it('should forbid the recipient from cancelling', async () => {
      inviteRepo.findOne.mockResolvedValue(pendingInvite());

      await expect(service.cancel(INVITE_ID, RECIPIENT)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when the invite does not exist', async () => {
      inviteRepo.findOne.mockResolvedValue(null);

      await expect(service.cancel(INVITE_ID, SENDER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listing', () => {
    it('should scope received invites to the recipient', async () => {
      inviteRepo.find.mockResolvedValue([]);

      await service.listReceived(RECIPIENT);

      expect(inviteRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            recipient_user_id: RECIPIENT,
            is_active: true,
          }),
        }),
      );
    });

    it('should scope sent invites to the sender', async () => {
      inviteRepo.find.mockResolvedValue([]);

      await service.listSent(SENDER);

      expect(inviteRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sender_user_id: SENDER,
            is_active: true,
          }),
        }),
      );
    });

    it('should only return pending invites from listPendingReceived', async () => {
      inviteRepo.find.mockResolvedValue([]);

      await service.listPendingReceived(RECIPIENT);

      expect(inviteRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
        }),
      );
    });
  });
});
