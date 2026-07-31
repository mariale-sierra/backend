import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCategoryMap } from '../challenges/entities/challenge-category-map.entity';
import { ChallengeLocationMap } from '../challenges/entities/challenge-location-map.entity';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof createMockRepo>;
  let profileRepo: ReturnType<typeof createMockRepo>;

  const baseUser = () => ({
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    is_active: true,
  });

  beforeEach(async () => {
    userRepo = createMockRepo();
    profileRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserProfile), useValue: profileRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(WorkoutLog), useValue: createMockRepo() },
        {
          provide: getRepositoryToken(ChallengeCategoryMap),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ChallengeLocationMap),
          useValue: createMockRepo(),
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findById', () => {
    it('should never include password_hash in the response, even if the repository returned it', async () => {
      // Simulate a misconfigured `select` accidentally leaking the hash —
      // the DTO mapping must still strip it.
      userRepo.findOne.mockResolvedValue({
        ...baseUser(),
        password_hash: '$2b$10$leakedhashvalue',
      });

      const result = await service.findById('user-1');

      expect(result).not.toHaveProperty('password_hash');
      expect(JSON.stringify(result)).not.toContain('leakedhash');
      expect(result).toEqual(baseUser());
    });

    it('should query with an explicit select that excludes password_hash', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());

      await service.findById('user-1');

      expect(userRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.arrayContaining(['password_hash']),
        }),
      );
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyProfile', () => {
    it('should fall back to username/defaults when the user has no profile row yet', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue(null);

      const result = await service.getMyProfile('user-1');

      expect(result).toMatchObject({
        id: 'user-1',
        username: 'alice',
        display_name: 'alice',
        bio: null,
        preferred_language: 'en',
        profile_image_url: null,
        is_private: false,
      });
      // Reading must never create a row.
      expect(profileRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for an unknown user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getMyProfile('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProfile', () => {
    it('should create the profile row on first edit and only change sent fields', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue(null);
      profileRepo.create.mockImplementation((data: object) => ({ ...data }));
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', {
        bio: 'Hello there',
      });

      expect(profileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', display_name: 'alice' }),
      );
      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ bio: 'Hello there', display_name: 'alice' }),
      );
      expect(result.bio).toBe('Hello there');
      expect(result.display_name).toBe('alice');
    });

    it('should preserve fields that are not part of the request', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice Original',
        bio: 'existing bio',
        preferred_language: 'es',
        is_private: true,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', {
        display_name: 'Alice Nueva',
      });

      expect(result.display_name).toBe('Alice Nueva');
      expect(result.bio).toBe('existing bio');
      expect(result.preferred_language).toBe('es');
      expect(result.is_private).toBe(true);
    });

    it('should clear the bio with null (not undefined) when an empty string is sent', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice',
        bio: 'old bio',
        preferred_language: 'en',
        is_private: false,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', { bio: '   ' });

      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ bio: null }),
      );
      expect(result.bio).toBeNull();
    });

    it('should normalize a whitespace-only display_name back to the username', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice',
        preferred_language: 'en',
        is_private: false,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', {
        display_name: '   ',
      });

      expect(result.display_name).toBe('alice');
    });

    it('should throw NotFoundException for an unknown user without writing anything', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.updateProfile('nope', { bio: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(profileRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateProfilePhoto', () => {
    it('should persist the new photo URL', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice',
        preferred_language: 'en',
        is_private: false,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const url = 'https://cdn.example.com/uploads/user-1/photo.jpeg';
      const result = await service.updateProfilePhoto('user-1', url);

      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ profile_image_url: url }),
      );
      expect(result.profile_image_url).toBe(url);
    });
  });

  describe('getPublicProfile', () => {
    it('should hide the bio and never expose the email for a private profile', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        bio: 'secret bio',
        preferred_language: 'en',
        profile_image_url: 'https://cdn.example.com/b.jpg',
        is_private: true,
      });

      const result = await service.getPublicProfile('user-2');

      expect(result.bio).toBeNull();
      expect(result.is_private).toBe(true);
      expect(result).not.toHaveProperty('email');
      // Photo and display name stay visible even on private profiles.
      expect(result.display_name).toBe('Bob');
      expect(result.profile_image_url).toBe('https://cdn.example.com/b.jpg');
    });

    it('should expose the bio for a public profile but still no email', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        bio: 'public bio',
        is_private: false,
      });

      const result = await service.getPublicProfile('user-2');

      expect(result.bio).toBe('public bio');
      expect(result).not.toHaveProperty('email');
    });

    it('should throw NotFoundException for inactive or unknown users', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getPublicProfile('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchUsers', () => {
    it('should return an empty list for a blank query without hitting the database', async () => {
      const result = await service.searchUsers('   ', 'user-1');

      expect(result).toEqual([]);
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it('should return safe public shapes for matches', async () => {
      userRepo.find.mockResolvedValue([{ id: 'user-2', username: 'bob' }]);
      profileRepo.find.mockResolvedValue([
        {
          user_id: 'user-2',
          display_name: 'Bob',
          bio: 'bio',
          is_private: false,
        },
      ]);

      const result = await service.searchUsers('bo', 'user-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'user-2',
        username: 'bob',
        display_name: 'Bob',
      });
      expect(result[0]).not.toHaveProperty('email');
      expect(userRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });
});
