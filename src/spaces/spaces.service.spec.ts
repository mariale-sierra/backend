import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SpacesService } from './spaces.service';
import { Space } from './entities/space.entity';
import { SpaceMember } from './entities/space-member.entity';
import { SpaceJoinRequest } from './entities/space-join-request.entity';
import { SpaceMessage } from './entities/space-message.entity';
import { ExerciseCategory } from '../exercises/entities/exercise-category.entity';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const OWNER = 'owner-uuid';
const MEMBER = 'member-uuid';
const OUTSIDER = 'outsider-uuid';
const SPACE_ID = 'space-uuid';
const REQUEST_ID = '7';

describe('SpacesService', () => {
  let service: SpacesService;
  let spaceRepo: ReturnType<typeof createMockRepo>;
  let memberRepo: ReturnType<typeof createMockRepo>;
  let joinRequestRepo: ReturnType<typeof createMockRepo>;
  let messageRepo: ReturnType<typeof createMockRepo>;
  let categoryRepo: ReturnType<typeof createMockRepo>;
  let dataSource: { transaction: jest.Mock };

  const basePublicSpace = () => ({
    id: SPACE_ID,
    created_by_user_id: OWNER,
    name: 'Public gym bros club',
    description: null,
    image_url: undefined,
    visibility: 'public' as const,
    activity_category_id: null,
    is_active: true,
    created_at: new Date(),
    createdBy: { id: OWNER, username: 'owner', profile: undefined },
    activityCategory: null,
  });

  const basePrivateSpace = () => ({
    ...basePublicSpace(),
    visibility: 'private' as const,
  });

  beforeEach(async () => {
    spaceRepo = createMockRepo();
    memberRepo = createMockRepo();
    joinRequestRepo = createMockRepo();
    messageRepo = createMockRepo();
    categoryRepo = createMockRepo();
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacesService,
        { provide: getRepositoryToken(Space), useValue: spaceRepo },
        { provide: getRepositoryToken(SpaceMember), useValue: memberRepo },
        {
          provide: getRepositoryToken(SpaceJoinRequest),
          useValue: joinRequestRepo,
        },
        { provide: getRepositoryToken(SpaceMessage), useValue: messageRepo },
        {
          provide: getRepositoryToken(ExerciseCategory),
          useValue: categoryRepo,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(SpacesService);

    // findOne()/getActiveSpaceOrThrow() default happy path — overridden per test.
    memberRepo.count.mockResolvedValue(0);
    memberRepo.findOne.mockResolvedValue(null);
    joinRequestRepo.count.mockResolvedValue(0);
  });

  describe('create', () => {
    const arrangeTransaction = () => {
      const txSpaceRepo = {
        create: jest.fn((data: object) => ({ ...data })),
        save: jest.fn((s: { id?: string }) =>
          Promise.resolve({ ...s, id: s.id ?? SPACE_ID }),
        ),
      };
      const txMemberRepo = {
        create: jest.fn((data: object) => ({ ...data })),
        save: jest.fn((m: object) => Promise.resolve(m)),
      };
      const manager = {
        getRepository: jest.fn((entity: unknown) =>
          entity === Space ? txSpaceRepo : txMemberRepo,
        ),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: unknown) => Promise<unknown>) => cb(manager),
      );
      return { txSpaceRepo, txMemberRepo };
    };

    it('should create the space and add the creator as owner in the same transaction', async () => {
      const { txSpaceRepo, txMemberRepo } = arrangeTransaction();
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());

      await service.create(OWNER, {
        name: 'Public gym bros club',
        visibility: 'public',
      });

      expect(txSpaceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          created_by_user_id: OWNER,
          visibility: 'public',
        }),
      );
      expect(txMemberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          space_id: SPACE_ID,
          user_id: OWNER,
          role: 'owner',
        }),
      );
    });

    it('should reject an activityCategoryId that does not exist, before opening a transaction', async () => {
      categoryRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(OWNER, {
          name: 'X',
          visibility: 'public',
          activityCategoryId: 999,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException for a missing or inactive space', async () => {
      spaceRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(OUTSIDER, SPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should report isMember/role false-null for a non-member', async () => {
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());
      memberRepo.findOne.mockResolvedValue(null);
      memberRepo.count.mockResolvedValue(3);

      const result = await service.findOne(OUTSIDER, SPACE_ID);

      expect(result.isMember).toBe(false);
      expect(result.role).toBeNull();
      expect(result.membersCount).toBe(3);
    });

    it('should report the viewer role for an active member', async () => {
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());
      memberRepo.findOne.mockResolvedValue({ role: 'owner' });

      const result = await service.findOne(OWNER, SPACE_ID);

      expect(result.isMember).toBe(true);
      expect(result.role).toBe('owner');
    });

    it('should report a pending join request for a private space', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      memberRepo.findOne.mockResolvedValue(null);
      joinRequestRepo.count.mockResolvedValue(1);

      const result = await service.findOne(OUTSIDER, SPACE_ID);

      expect(result.hasPendingRequest).toBe(true);
    });
  });

  describe('update / remove — ownership', () => {
    it('should reject editing a space you do not own', async () => {
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());
      await expect(
        service.update(OUTSIDER, SPACE_ID, { name: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject deleting a space you do not own', async () => {
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());
      await expect(service.remove(OUTSIDER, SPACE_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should soft-delete (is_active = false) when the owner deletes', async () => {
      const space = basePublicSpace();
      spaceRepo.findOne.mockResolvedValue(space);
      spaceRepo.save.mockResolvedValue(space);

      await service.remove(OWNER, SPACE_ID);

      expect(spaceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false }),
      );
    });
  });

  describe('update — activityCategoryId persistence (stale relation shadowing bug)', () => {
    // getActiveSpaceOrThrow() eager-loads `activityCategory` (SPACE_RELATIONS).
    // When a space already HAS a category (unlike setting one for the first
    // time on a space with none, which has no stale relation to shadow it),
    // that loaded relation object stays attached to the entity even after
    // reassigning the activity_category_id scalar — TypeORM resolves the FK
    // from the relation over the scalar on save(), silently reverting the
    // change. This only reproduces with an ALREADY-set category being
    // changed to a DIFFERENT one.
    it('should clear the stale activityCategory relation so save() persists the new category, not the old one', async () => {
      const oldCategory = { id: 1, code: 'strength', name: 'Strength' };
      const newCategory = {
        id: 2,
        code: 'cardio-intense',
        name: 'Cardio Intense',
      };
      const spaceWithOldCategory = {
        ...basePublicSpace(),
        activity_category_id: oldCategory.id,
        activityCategory: oldCategory,
      };

      spaceRepo.findOne
        .mockResolvedValueOnce(spaceWithOldCategory) // getActiveSpaceOrThrow() inside update()
        .mockResolvedValueOnce({
          // Fresh re-fetch inside this.findOne() after save() — reflects
          // what the DB actually holds once the fix takes effect.
          ...spaceWithOldCategory,
          activity_category_id: newCategory.id,
          activityCategory: newCategory,
        });
      categoryRepo.findOne.mockResolvedValue(newCategory);
      spaceRepo.save.mockResolvedValue(undefined);

      const result = await service.update(OWNER, SPACE_ID, {
        activityCategoryId: newCategory.id,
      });

      // The actual fix: nothing left for TypeORM to fall back to.
      expect(spaceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          activity_category_id: newCategory.id,
          activityCategory: undefined,
        }),
      );
      // The re-read response reflects the new category, not the old one.
      expect(result.activityCategory?.id).toBe(newCategory.id);
    });
  });

  describe('join', () => {
    it('should join a public space instantly', async () => {
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());
      memberRepo.findOne.mockResolvedValueOnce(null); // existingMembership check
      memberRepo.create.mockImplementation((data: object) => ({ ...data }));
      memberRepo.save.mockResolvedValue({});
      memberRepo.findOne.mockResolvedValueOnce(null); // viewer role inside findOne()

      const result = await service.join(OUTSIDER, SPACE_ID);

      expect(memberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          space_id: SPACE_ID,
          user_id: OUTSIDER,
          role: 'member',
        }),
      );
      expect(result.status).toBe('joined');
    });

    it('should file a pending join request for a private space instead of joining directly', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      memberRepo.findOne.mockResolvedValue(null);
      joinRequestRepo.findOne.mockResolvedValue(null);
      joinRequestRepo.create.mockImplementation((data: object) => ({
        ...data,
      }));
      joinRequestRepo.save.mockResolvedValue({});

      const result = await service.join(OUTSIDER, SPACE_ID);

      expect(memberRepo.save).not.toHaveBeenCalled();
      expect(joinRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          space_id: SPACE_ID,
          user_id: OUTSIDER,
          status: 'pending',
        }),
      );
      expect(result.status).toBe('requested');
    });

    it('should reject joining a space the user is already an active member of', async () => {
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());
      memberRepo.findOne.mockResolvedValue({ is_active: true, role: 'member' });

      await expect(service.join(MEMBER, SPACE_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject a second pending request to the same private space', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      memberRepo.findOne.mockResolvedValue(null);
      joinRequestRepo.findOne.mockResolvedValue({ status: 'pending' });

      await expect(service.join(OUTSIDER, SPACE_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(joinRequestRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a nonexistent space', async () => {
      spaceRepo.findOne.mockResolvedValue(null);
      await expect(service.join(OUTSIDER, SPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('leave', () => {
    it('should reject leaving when the caller is not an active member', async () => {
      memberRepo.findOne.mockResolvedValue(null);
      await expect(service.leave(OUTSIDER, SPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject the owner leaving their own space', async () => {
      memberRepo.findOne.mockResolvedValue({ role: 'owner', is_active: true });
      await expect(service.leave(OWNER, SPACE_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should deactivate the membership for a regular member', async () => {
      const membership = { role: 'member', is_active: true };
      memberRepo.findOne.mockResolvedValue(membership);
      memberRepo.save.mockResolvedValue(membership);

      await service.leave(MEMBER, SPACE_ID);

      expect(memberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false }),
      );
    });
  });

  describe('listMembers', () => {
    it('should throw NotFoundException for a nonexistent space', async () => {
      spaceRepo.findOne.mockResolvedValue(null);
      await expect(service.listMembers(SPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return the active members of an existing space', async () => {
      spaceRepo.findOne.mockResolvedValue(basePublicSpace());
      memberRepo.find.mockResolvedValue([
        {
          user: { id: MEMBER, username: 'bob', profile: undefined },
          role: 'member',
          joined_at: new Date(),
        },
      ]);

      const result = await service.listMembers(SPACE_ID);

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('bob');
    });
  });

  describe('listMessages', () => {
    const createMockQueryBuilder = () => {
      const qb: Record<string, jest.Mock> = {};
      ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take'].forEach(
        (method) => {
          qb[method] = jest.fn().mockReturnValue(qb);
        },
      );
      qb.getMany = jest.fn();
      return qb;
    };

    it('should reject a non-member with Forbidden, not NotFound — a space is already public via GET /spaces', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.listMessages(OUTSIDER, SPACE_ID, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return messages oldest-first, with the sender populated, and a nextBefore cursor when there are more rows than the limit', async () => {
      memberRepo.findOne.mockResolvedValue({
        space_id: SPACE_ID,
        user_id: MEMBER,
        role: 'member',
        is_active: true,
      });

      const qb = createMockQueryBuilder();
      // limit=2 requested -> service asks for 3 (limit+1) to detect "hasMore"
      qb.getMany.mockResolvedValue([
        {
          id: 5,
          space_id: SPACE_ID,
          user_id: MEMBER,
          message_text: 'c',
          sent_at: new Date(),
          sender: { id: MEMBER, username: 'bob', profile: undefined },
        },
        {
          id: 4,
          space_id: SPACE_ID,
          user_id: OWNER,
          message_text: 'b',
          sent_at: new Date(),
          sender: { id: OWNER, username: 'alice', profile: undefined },
        },
        {
          id: 3,
          space_id: SPACE_ID,
          user_id: MEMBER,
          message_text: 'a',
          sent_at: new Date(),
          sender: { id: MEMBER, username: 'bob', profile: undefined },
        },
      ]);
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMessages(MEMBER, SPACE_ID, {
        limit: 2,
      });

      expect(qb.take).toHaveBeenCalledWith(3);
      expect(result.messages.map((m) => m.id)).toEqual([4, 5]); // oldest-first, trimmed to limit
      expect(result.nextBefore).toBe(4); // id of the oldest row actually returned
      expect(result.messages[0].sender).toEqual({
        id: OWNER,
        username: 'alice',
        displayName: null,
        profileImageUrl: null,
      });
    });

    it('should return nextBefore null on the last page', async () => {
      memberRepo.findOne.mockResolvedValue({
        space_id: SPACE_ID,
        user_id: MEMBER,
        role: 'member',
        is_active: true,
      });

      const qb = createMockQueryBuilder();
      qb.getMany.mockResolvedValue([
        {
          id: 2,
          space_id: SPACE_ID,
          user_id: MEMBER,
          message_text: 'b',
          sent_at: new Date(),
          sender: { id: MEMBER, username: 'bob', profile: undefined },
        },
        {
          id: 1,
          space_id: SPACE_ID,
          user_id: MEMBER,
          message_text: 'a',
          sent_at: new Date(),
          sender: { id: MEMBER, username: 'bob', profile: undefined },
        },
      ]);
      messageRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listMessages(MEMBER, SPACE_ID, {
        limit: 10,
      });

      expect(result.nextBefore).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('should reject a non-member with Forbidden, not NotFound', async () => {
      memberRepo.findOne.mockResolvedValue(null);

      await expect(
        service.sendMessage(OUTSIDER, SPACE_ID, 'hi'),
      ).rejects.toThrow(ForbiddenException);
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should persist the message tied to the sender and space, and return it with the sender populated', async () => {
      memberRepo.findOne.mockResolvedValue({
        space_id: SPACE_ID,
        user_id: MEMBER,
        role: 'member',
        is_active: true,
      });
      messageRepo.create.mockImplementation((m: object) => m);
      messageRepo.save.mockResolvedValue({ id: 42 });
      messageRepo.findOne.mockResolvedValue({
        id: 42,
        space_id: SPACE_ID,
        user_id: MEMBER,
        message_text: 'hola equipo',
        sent_at: new Date(),
        sender: {
          id: MEMBER,
          username: 'bob',
          profile: { display_name: 'Bob', profile_image_url: null },
        },
      });

      const result = await service.sendMessage(MEMBER, SPACE_ID, 'hola equipo');

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          space_id: SPACE_ID,
          user_id: MEMBER,
          message_text: 'hola equipo',
        }),
      );
      expect(result.id).toBe(42);
      expect(result.content).toBe('hola equipo');
      expect(result.sender).toEqual({
        id: MEMBER,
        username: 'bob',
        displayName: 'Bob',
        profileImageUrl: null,
      });
    });
  });

  describe('listJoinRequests', () => {
    it('should reject a non-owner listing join requests', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      await expect(
        service.listJoinRequests(OUTSIDER, SPACE_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return pending requests for the owner', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      joinRequestRepo.find.mockResolvedValue([
        {
          id: REQUEST_ID,
          status: 'pending',
          user: { id: OUTSIDER, username: 'jane', profile: undefined },
          requested_at: new Date(),
          responded_at: null,
        },
      ]);

      const result = await service.listJoinRequests(OWNER, SPACE_ID);

      expect(result).toHaveLength(1);
      expect(result[0].user.username).toBe('jane');
    });
  });

  describe('respondToJoinRequest', () => {
    const pendingRequest = () => ({
      id: REQUEST_ID,
      space_id: SPACE_ID,
      user_id: OUTSIDER,
      status: 'pending' as const,
      requested_at: new Date(),
      responded_at: null,
      responded_by_user_id: null,
    });

    const arrangeTransaction = (
      request: object | null,
      existingMembership: object | null,
    ) => {
      const txRequestRepo = {
        createQueryBuilder: jest.fn().mockReturnValue({
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(request),
        }),
        save: jest.fn((r: object) => Promise.resolve(r)),
        // A function, not a pre-computed mockResolvedValue: the service
        // mutates `request` (status/responded_at) between getOne() and this
        // final reload, so this must read `request`'s CURRENT state at call
        // time, not a snapshot taken when arrangeTransaction ran.
        findOne: jest.fn().mockImplementation(() =>
          Promise.resolve(
            request
              ? {
                  ...request,
                  user: {
                    id: OUTSIDER,
                    username: 'jane',
                    profile: undefined,
                  },
                }
              : null,
          ),
        ),
      };
      const txMemberRepo = {
        findOne: jest.fn().mockResolvedValue(existingMembership),
        save: jest.fn((m: object) => Promise.resolve(m)),
        create: jest.fn((data: object) => ({ ...data })),
      };
      const manager = {
        getRepository: jest.fn((entity: unknown) =>
          entity === SpaceJoinRequest ? txRequestRepo : txMemberRepo,
        ),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: unknown) => Promise<unknown>) => cb(manager),
      );
      return { txRequestRepo, txMemberRepo };
    };

    it('should reject a non-owner responding to a join request', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      await expect(
        service.respondToJoinRequest(OUTSIDER, SPACE_ID, REQUEST_ID, true),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the request does not exist', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      arrangeTransaction(null, null);

      await expect(
        service.respondToJoinRequest(OWNER, SPACE_ID, REQUEST_ID, true),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject responding to an already-processed request', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      arrangeTransaction({ ...pendingRequest(), status: 'approved' }, null);

      await expect(
        service.respondToJoinRequest(OWNER, SPACE_ID, REQUEST_ID, true),
      ).rejects.toThrow(ConflictException);
    });

    it('should approve a request and add the user as an active member', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      const { txRequestRepo, txMemberRepo } = arrangeTransaction(
        pendingRequest(),
        null,
      );

      const result = await service.respondToJoinRequest(
        OWNER,
        SPACE_ID,
        REQUEST_ID,
        true,
      );

      expect(txRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          responded_by_user_id: OWNER,
        }),
      );
      expect(txMemberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          space_id: SPACE_ID,
          user_id: OUTSIDER,
          role: 'member',
        }),
      );
      expect(result.status).toBe('approved');
    });

    it('should reject a request without touching space_members', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      const { txRequestRepo, txMemberRepo } = arrangeTransaction(
        pendingRequest(),
        null,
      );

      const result = await service.respondToJoinRequest(
        OWNER,
        SPACE_ID,
        REQUEST_ID,
        false,
      );

      expect(txRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'rejected' }),
      );
      expect(txMemberRepo.save).not.toHaveBeenCalled();
      expect(result.status).toBe('rejected');
    });

    it('should reactivate a previous (inactive) membership instead of inserting a duplicate on approval', async () => {
      spaceRepo.findOne.mockResolvedValue(basePrivateSpace());
      const existing = {
        space_id: SPACE_ID,
        user_id: OUTSIDER,
        role: 'member',
        is_active: false,
      };
      const { txMemberRepo } = arrangeTransaction(pendingRequest(), existing);

      await service.respondToJoinRequest(OWNER, SPACE_ID, REQUEST_ID, true);

      expect(txMemberRepo.create).not.toHaveBeenCalled();
      expect(txMemberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: true }),
      );
    });
  });
});
