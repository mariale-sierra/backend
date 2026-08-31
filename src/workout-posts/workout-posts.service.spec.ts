import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { WorkoutPostsService } from './workout-posts.service';
import { WorkoutPost } from './entities/workout-post.entity';
import { User } from '../users/entities/user.entity';
import { ModerationService } from '../openai/moderation.service';
import { FollowsService } from '../follows/follows.service';
import { encodeCursor } from './pagination.util';

const createMockWorkoutPostRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
  // supportsModerationColumns() calls this directly on the repo.
  query: jest.fn(),
  // Every read path (getFeed, fetchPhotos, fetchPaginatedPhotos) goes
  // through the raw manager.query — this is the one that matters most here.
  manager: { query: jest.fn() },
});

const createMockUserRepo = () => ({
  findOne: jest.fn(),
});

describe('WorkoutPostsService', () => {
  let service: WorkoutPostsService;
  let postRepo: ReturnType<typeof createMockWorkoutPostRepo>;
  let userRepo: ReturnType<typeof createMockUserRepo>;
  let followsService: { isActiveFollower: jest.Mock };

  const VIEWER_ID = 'viewer-1';
  const OTHER_USER_ID = 'other-2';

  beforeEach(async () => {
    postRepo = createMockWorkoutPostRepo();
    userRepo = createMockUserRepo();
    // Matches the real, applied moderation migration — every test exercises
    // the real (non-degraded) code path unless a test explicitly overrides this.
    postRepo.query.mockResolvedValue([{ count: 3 }]);
    // Default: viewer does not follow the target — preserves the pre-B3
    // "strangers only see public posts" behavior unless a test says otherwise.
    followsService = { isActiveFollower: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutPostsService,
        { provide: getRepositoryToken(WorkoutPost), useValue: postRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: ModerationService,
          useValue: { validateWorkoutImage: jest.fn() },
        },
        { provide: FollowsService, useValue: followsService },
      ],
    }).compile();

    service = module.get(WorkoutPostsService);
  });

  function feedRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: '1',
      user_id: 'author-1',
      image_url: 'https://example.com/a.jpg',
      caption: 'day 1',
      created_at: new Date('2026-08-16T10:00:00.000Z'),
      workout_log_id: 10,
      challenge_id: 'challenge-1',
      challenge_name: 'Reto de Agosto',
      user_name: 'alice',
      user_avatar_url: null,
      joined_at: new Date('2026-08-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function photoRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: '1',
      image_url: 'https://example.com/a.jpg',
      caption: 'day 1',
      visibility: 'public',
      created_at: new Date('2026-08-16T10:00:00.000Z'),
      moderation_status: 'approved',
      challenge_id: 'challenge-1',
      workout_log_id: 10,
      user_name: 'alice',
      joined_at: new Date('2026-08-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // GET /feed
  // ---------------------------------------------------------------------
  describe('getFeed', () => {
    it("should filter unconditionally on visibility='public' AND moderation_status='approved' (no ternary/degradation)", async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.visibility = 'public'");
      expect(sql).toContain("p.moderation_status = 'approved'");
      // The whole point of the audit fix: this predicate must be present
      // literally in the query text, not conditionally interpolated.
      expect(sql).not.toMatch(/\$\{.*moderation_status.*\}/);
    });

    it('should never bypass moderation/visibility for the post owner (no OR p.user_id fragment)', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/OR\s+p\.user_id/i);
    });

    // F8 (docs/testing/PLAN-MAESTRO-PRUEBAS.md): a post from a private
    // challenge must never surface in the global Feed, even if its own
    // visibility is 'public' — this is the read-time second layer behind
    // WorkoutLogService.resolvePostVisibility() (write-time downgrade).
    it("should exclude posts whose challenge is private, unconditionally (CP-30)", async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("c.visibility != 'private'");
    });

    it('should never populate activity_type (no unambiguous source exists)', async () => {
      postRepo.manager.query.mockResolvedValue([feedRow()]);

      const { posts } = await service.getFeed({ limit: 20 });

      expect(posts[0]).not.toHaveProperty('activity_type', expect.anything());
      expect(posts[0].activity_type).toBeUndefined();
    });

    it('should map rows to the exact FeedPostContract field names', async () => {
      postRepo.manager.query.mockResolvedValue([feedRow()]);

      const { posts } = await service.getFeed({ limit: 20 });

      expect(posts[0]).toEqual(
        expect.objectContaining({
          id: '1',
          user_id: 'author-1',
          user_name: 'alice',
          challenge_id: 'challenge-1',
          challenge_name: 'Reto de Agosto',
          // joined 2026-08-01, posted 2026-08-16 -> day 16 (1-indexed, UTC)
          challenge_day: 16,
          image_url: 'https://example.com/a.jpg',
          caption: 'day 1',
          posted_at: '2026-08-16T10:00:00.000Z',
        }),
      );
      expect(posts[0].user_avatar_url).toBeUndefined();
      expect(posts[0].likes_count).toBeUndefined();
    });

    it('should request limit+1 rows and report a next page when more rows come back than the limit', async () => {
      const rows = [
        feedRow({ id: '3' }),
        feedRow({ id: '2' }),
        feedRow({ id: '1' }),
      ];
      postRepo.manager.query.mockResolvedValue(rows); // limit(2)+1 = 3 rows

      const { posts, nextCursor } = await service.getFeed({ limit: 2 });

      expect(posts).toHaveLength(2);
      expect(nextCursor).toBeDefined();

      const [, params] = postRepo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params[params.length - 1]).toBe(3); // limit + 1
    });

    it('should not return a next cursor on the last page', async () => {
      postRepo.manager.query.mockResolvedValue([feedRow()]); // fewer rows than limit

      const { nextCursor } = await service.getFeed({ limit: 20 });

      expect(nextCursor).toBeUndefined();
    });

    it('should build the next cursor from the last row actually returned to the client, not the lookahead row', async () => {
      const rows = [
        feedRow({ id: '30', created_at: new Date('2026-08-16T12:00:00.000Z') }),
        feedRow({ id: '20', created_at: new Date('2026-08-16T11:00:00.000Z') }),
        feedRow({ id: '10', created_at: new Date('2026-08-16T10:00:00.000Z') }), // lookahead row
      ];
      postRepo.manager.query.mockResolvedValue(rows);

      const { nextCursor } = await service.getFeed({ limit: 2 });

      expect(nextCursor).toBe(
        encodeCursor(new Date('2026-08-16T11:00:00.000Z'), '20'),
      );
    });

    it('should pass the decoded cursor as bound parameters, never string-concatenated into the SQL', async () => {
      postRepo.manager.query.mockResolvedValue([]);
      const maliciousId = "'; DROP TABLE workout_posts; --";

      await service.getFeed({
        limit: 20,
        cursor: { createdAt: '2026-08-16T10:00:00.000Z', id: maliciousId },
      });

      const [sql, params] = postRepo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).not.toContain(maliciousId);
      expect(params).toContain(maliciousId);
    });

    it('should return an empty array with no further queries when nothing matches', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      const result = await service.getFeed({ limit: 20 });

      expect(result).toEqual({ posts: [] });
      expect(postRepo.manager.query).toHaveBeenCalledTimes(1);
    });

    it('should never select email or password_hash', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql.toLowerCase()).not.toContain('email');
      expect(sql.toLowerCase()).not.toContain('password');
    });
  });

  // ---------------------------------------------------------------------
  // GET /workout-posts/challenge/:challengeId (legacy unpaginated gallery)
  // ---------------------------------------------------------------------
  describe('getChallengePhotos', () => {
    it("should require an active follow before exposing a 'followers'-visibility post to a non-owner (same B3 rule as getUserPosts)", async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getChallengePhotos('challenge-1', VIEWER_ID);

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.visibility != 'followers'");
      expect(sql).toMatch(/EXISTS[\s\S]*havit\.user_follows/);
      expect(sql).toMatch(/uf\.is_active = true/);
    });

    it('should still always allow a private post through for its own author', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getChallengePhotos('challenge-1', VIEWER_ID);

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.visibility != 'private'");
      expect(sql).toMatch(/p\.user_id = \$\d+/);
    });

    it('should scope the query to the given challenge', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getChallengePhotos('challenge-42', VIEWER_ID);

      const [sql, params] = postRepo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('wl.challenge_id = $1');
      expect(params[0]).toBe('challenge-42');
    });
  });

  // ---------------------------------------------------------------------
  // GET /workout-posts/challenge/:challengeId/latest
  // ---------------------------------------------------------------------
  describe('getLatestChallengePhoto', () => {
    it('should reuse the same filtered query as getChallengePhotos, scoped to the challenge', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getLatestChallengePhoto('challenge-42', VIEWER_ID);

      const [sql, params] = postRepo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('wl.challenge_id = $1');
      expect(sql).toContain("p.visibility != 'private'");
      expect(params[0]).toBe('challenge-42');
    });

    it('should return only the first (most recent) photo', async () => {
      const rows = [
        photoRow({ id: '2', created_at: new Date('2026-08-17T10:00:00.000Z') }),
        photoRow({ id: '1', created_at: new Date('2026-08-16T10:00:00.000Z') }),
      ];
      postRepo.manager.query.mockResolvedValue(rows);

      const result = await service.getLatestChallengePhoto(
        'challenge-1',
        VIEWER_ID,
      );

      expect(result?.id).toBe('2');
    });

    it('should return null, not an empty array or undefined, when the challenge has no visible photo', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      const result = await service.getLatestChallengePhoto(
        'challenge-1',
        VIEWER_ID,
      );

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // GET /workout-posts/user/:userId
  // ---------------------------------------------------------------------
  describe('getUserPosts', () => {
    it('should throw NotFoundException when the target user does not exist or is inactive', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getUserPosts(OTHER_USER_ID, VIEWER_ID, { limit: 20 }),
      ).rejects.toThrow(NotFoundException);
      expect(postRepo.manager.query).not.toHaveBeenCalled();
    });

    it('should only look up active users (is_active: true in the where clause)', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getUserPosts(OTHER_USER_ID, VIEWER_ID, { limit: 20 }),
      ).rejects.toThrow(NotFoundException);

      expect(userRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ is_active: true }),
        }),
      );
    });

    it('should return [] for an existing user with no posts', async () => {
      userRepo.findOne.mockResolvedValue({
        id: OTHER_USER_ID,
        is_active: true,
      });
      postRepo.manager.query.mockResolvedValue([]);

      const { photos, nextCursor } = await service.getUserPosts(
        OTHER_USER_ID,
        VIEWER_ID,
        { limit: 20 },
      );

      expect(photos).toEqual([]);
      expect(nextCursor).toBeUndefined();
    });

    it('self-view: should use the owner-bypass filter, matching /mine', async () => {
      userRepo.findOne.mockResolvedValue({ id: VIEWER_ID, is_active: true });
      postRepo.manager.query.mockResolvedValue([]);

      await service.getUserPosts(VIEWER_ID, VIEWER_ID, { limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/OR\s+p\.user_id/i);
      expect(sql).toContain("p.visibility != 'private'");
    });

    it("other-view, not a follower: should require visibility='public' AND moderation_status='approved', with no owner bypass", async () => {
      userRepo.findOne.mockResolvedValue({
        id: OTHER_USER_ID,
        is_active: true,
      });
      postRepo.manager.query.mockResolvedValue([]);

      await service.getUserPosts(OTHER_USER_ID, VIEWER_ID, { limit: 20 });

      expect(followsService.isActiveFollower).toHaveBeenCalledWith(
        VIEWER_ID,
        OTHER_USER_ID,
      );
      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.visibility = 'public'");
      expect(sql).toContain("p.moderation_status = 'approved'");
      // No moderation/visibility owner-bypass for a non-owner viewer — the
      // separate challenge-privacy filter (challengePrivacyFilter) does add
      // its own "OR p.user_id" clause, but that's a different, additive
      // safety net (F8: never hide a viewer's own post), not a reintroduced
      // moderation/visibility bypass.
      expect(sql).not.toContain('moderation_status = ANY');
      expect(sql).not.toContain("p.visibility != 'private'");
    });

    it('other-view, active follower: should also allow followers-visibility posts (B3)', async () => {
      userRepo.findOne.mockResolvedValue({
        id: OTHER_USER_ID,
        is_active: true,
      });
      followsService.isActiveFollower.mockResolvedValue(true);
      postRepo.manager.query.mockResolvedValue([]);

      await service.getUserPosts(OTHER_USER_ID, VIEWER_ID, { limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.visibility IN ('public', 'followers')");
      expect(sql).toContain("p.moderation_status = 'approved'");
      expect(sql).not.toContain('moderation_status = ANY');
      expect(sql).not.toContain("p.visibility != 'private'");
    });

    // F8 (docs/testing/PLAN-MAESTRO-PRUEBAS.md): a non-member browsing
    // someone else's public profile must not discover a post from a private
    // challenge, even if the post is marked 'public' — but a fellow member
    // of that same private challenge (or the post's own author) still can.
    it("other-view: should exclude posts from a private challenge unless the viewer is a member (CP-31)", async () => {
      userRepo.findOne.mockResolvedValue({
        id: OTHER_USER_ID,
        is_active: true,
      });
      postRepo.manager.query.mockResolvedValue([]);

      await service.getUserPosts(OTHER_USER_ID, VIEWER_ID, { limit: 20 });

      const [sql, params] = postRepo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain("c.visibility IS DISTINCT FROM 'private'");
      expect(sql).toContain('havit.challenge_user_map cum_viewer');
      expect(sql).toContain('cum_viewer.user_id = $2');
      expect(params).toContain(VIEWER_ID);
    });

    it('self-view: never calls isActiveFollower (owner bypass short-circuits it)', async () => {
      userRepo.findOne.mockResolvedValue({ id: VIEWER_ID, is_active: true });
      postRepo.manager.query.mockResolvedValue([]);

      await service.getUserPosts(VIEWER_ID, VIEWER_ID, { limit: 20 });

      expect(followsService.isActiveFollower).not.toHaveBeenCalled();
    });

    it('other-view: the visibility/moderation predicate is static regardless of cursor/limit input', async () => {
      userRepo.findOne.mockResolvedValue({
        id: OTHER_USER_ID,
        is_active: true,
      });
      postRepo.manager.query.mockResolvedValue([]);

      await service.getUserPosts(OTHER_USER_ID, VIEWER_ID, {
        limit: 50,
        cursor: { createdAt: '2026-08-16T10:00:00.000Z', id: '999' },
      });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.visibility = 'public'");
      expect(sql).toContain("p.moderation_status = 'approved'");
    });

    it('should map rows into the ChallengePhoto shape (same as /mine)', async () => {
      userRepo.findOne.mockResolvedValue({
        id: OTHER_USER_ID,
        is_active: true,
      });
      postRepo.manager.query.mockResolvedValueOnce([photoRow()]); // main query
      postRepo.manager.query.mockResolvedValueOnce([]); // metricsByWorkoutLog: base rows
      postRepo.manager.query.mockResolvedValueOnce([]); // metricsByWorkoutLog: exercise-level metric rows

      const { photos } = await service.getUserPosts(OTHER_USER_ID, VIEWER_ID, {
        limit: 20,
      });

      expect(photos[0]).toEqual(
        expect.objectContaining({
          id: '1',
          challengeId: 'challenge-1',
          userName: 'alice',
          imageUrl: 'https://example.com/a.jpg',
          visibility: 'public',
          description: 'day 1',
        }),
      );
    });
  });

  // ---------------------------------------------------------------------
  // metricsByWorkoutLog (private, exercised via getChallengePhotos) — the
  // photo card's per-exercise metric line ("12 reps" / "20m" / "Logged").
  // ---------------------------------------------------------------------
  describe('metricsByWorkoutLog (photo card metric display)', () => {
    // Matches metricsByWorkoutLog's baseRowsQuery column shape.
    function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        workout_log_id: 10,
        wle_id: 100,
        order_index: 0,
        exercise_name: 'Bench Press',
        total_sets: 3,
        metric_code: null,
        default_unit: null,
        target_value_int: null,
        target_value_decimal: null,
        target_value_seconds: null,
        ...overrides,
      };
    }

    // Matches metricsByWorkoutLog's exerciseMetricRowsQuery column shape.
    function exerciseMetricRow(
      overrides: Partial<Record<string, unknown>> = {},
    ) {
      return {
        workout_log_id: 10,
        wle_id: 200,
        metric_code: null,
        default_unit: null,
        target_value_int: null,
        target_value_decimal: null,
        target_value_seconds: null,
        ...overrides,
      };
    }

    it('formats a real per-set reps value as "N × value" using the first set', async () => {
      postRepo.manager.query.mockResolvedValueOnce([photoRow()]); // main query
      postRepo.manager.query.mockResolvedValueOnce([
        baseRow({ metric_code: 'reps', target_value_int: 12 }),
      ]);
      postRepo.manager.query.mockResolvedValueOnce([]); // no exercise-level metrics

      const photos = await service.getChallengePhotos('challenge-1', VIEWER_ID);

      expect(photos[0].metrics).toEqual([
        { label: 'Bench Press', value: '3 × 12' },
      ]);
    });

    it('formats an exercise-level-only metric (the Brisk Walk shape: no sets) directly, with no "N ×" prefix', async () => {
      postRepo.manager.query.mockResolvedValueOnce([photoRow()]); // main query
      postRepo.manager.query.mockResolvedValueOnce([
        // No sets at all for this exercise — total_sets/metric_code null.
        baseRow({
          wle_id: 200,
          exercise_name: 'Brisk Walk',
          total_sets: null,
          metric_code: null,
        }),
      ]);
      postRepo.manager.query.mockResolvedValueOnce([
        exerciseMetricRow({
          wle_id: 200,
          metric_code: 'time',
          target_value_seconds: 1200,
        }),
      ]);

      const photos = await service.getChallengePhotos('challenge-1', VIEWER_ID);

      expect(photos[0].metrics).toEqual([
        { label: 'Brisk Walk', value: '20m' },
      ]);
    });

    it('falls back to the generic "Logged" label when genuinely neither a per-set nor an exercise-level value exists', async () => {
      postRepo.manager.query.mockResolvedValueOnce([photoRow()]); // main query
      postRepo.manager.query.mockResolvedValueOnce([
        baseRow({ metric_code: null }),
      ]);
      postRepo.manager.query.mockResolvedValueOnce([]);

      const photos = await service.getChallengePhotos('challenge-1', VIEWER_ID);

      expect(photos[0].metrics).toEqual([
        { label: 'Bench Press', value: 'Logged' },
      ]);
    });

    it('reads the real default_unit for a weight value instead of hardcoding a unit', async () => {
      postRepo.manager.query.mockResolvedValueOnce([photoRow()]); // main query
      postRepo.manager.query.mockResolvedValueOnce([
        baseRow({
          metric_code: 'weight',
          target_value_decimal: 45,
          default_unit: 'kg',
        }),
      ]);
      postRepo.manager.query.mockResolvedValueOnce([]);

      const photos = await service.getChallengePhotos('challenge-1', VIEWER_ID);

      expect(photos[0].metrics).toEqual([
        { label: 'Bench Press', value: '3 × 45 kg' },
      ]);
    });
  });
});
