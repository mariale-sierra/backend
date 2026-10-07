import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkoutPostsService } from './workout-posts.service';
import {
  WorkoutPost,
  WorkoutPostModerationStatus,
} from './entities/workout-post.entity';
import { User } from '../users/entities/user.entity';
import { ModerationService } from '../openai/moderation.service';
import { FollowsService } from '../follows/follows.service';
import { WorkoutPostReactionsService } from './workout-post-reactions.service';
import { WorkoutPostCommentsService } from './workout-post-comments.service';
import { encodeCursor } from '../common/pagination.util';

const createMockWorkoutPostRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  // remove()'s (B4) own lookup of the post to soft-delete.
  findOne: jest.fn(),
  update: jest.fn(),
  // processPendingModerationBatch()'s own lookup of still-pending posts.
  find: jest.fn().mockResolvedValue([]),
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
  let reactionsService: {
    getCountsForPosts: jest.Mock;
    getReactedPostIds: jest.Mock;
  };
  let commentsService: { getCountsForPosts: jest.Mock };
  let moderationService: {
    validateWorkoutImage: jest.Mock;
    validateText: jest.Mock;
    assertTextAllowed: jest.Mock;
  };

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
    // Bloque 3 defaults: no reactions/comments on any post unless a test
    // overrides these — matches an empty Map/Set from a real, empty table.
    reactionsService = {
      getCountsForPosts: jest.fn().mockResolvedValue(new Map()),
      getReactedPostIds: jest.fn().mockResolvedValue(new Set()),
    };
    commentsService = {
      getCountsForPosts: jest.fn().mockResolvedValue(new Map()),
    };
    moderationService = {
      validateWorkoutImage: jest.fn(),
      validateText: jest.fn(),
      assertTextAllowed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutPostsService,
        { provide: getRepositoryToken(WorkoutPost), useValue: postRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ModerationService, useValue: moderationService },
        { provide: FollowsService, useValue: followsService },
        { provide: WorkoutPostReactionsService, useValue: reactionsService },
        { provide: WorkoutPostCommentsService, useValue: commentsService },
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
  // Moderation batch — real incident (2026-09): the OpenAI account backing
  // ModerationService started returning 429 for every call, so every post
  // ever uploaded stayed 'pending' forever — invisible to anyone but its
  // own author (getFeed/getUserPosts both require moderation_status =
  // 'approved' for a non-owner viewer). These tests cover the fix: a
  // service failure on a post old enough to be clearly stuck (not just
  // "hasn't had its first attempt yet") auto-approves as a safety valve.
  // ---------------------------------------------------------------------
  describe('create', () => {
    it('should create posts pending, with no synchronous OpenAI call, since the moderation gate is enabled', async () => {
      postRepo.create.mockReturnValue({} as WorkoutPost);
      postRepo.save.mockImplementation((post: WorkoutPost) =>
        Promise.resolve(post),
      );

      const saved = await service.create({
        user_id: 'author-1',
        image_url: 'https://example.com/a.jpg',
      });

      expect(moderationService.validateWorkoutImage).not.toHaveBeenCalled();
      expect(saved).toEqual(
        expect.objectContaining({
          moderationStatus: WorkoutPostModerationStatus.PENDING,
        }),
      );
    });
  });

  // B3 (CP-70): the caption of a photo post is already moderated together
  // with the image by the async batch (validateWorkoutImage) — create() must
  // not also run the synchronous text moderation on it.
  describe('create — no duplicated caption moderation (B3)', () => {
    it('should never call the text moderation when creating a photo post with a caption', async () => {
      postRepo.create.mockReturnValue({} as WorkoutPost);
      postRepo.save.mockImplementation((post: WorkoutPost) =>
        Promise.resolve(post),
      );

      await service.create({
        user_id: 'author-1',
        image_url: 'https://example.com/a.jpg',
        caption: 'día 3',
      });

      expect(moderationService.validateText).not.toHaveBeenCalled();
      expect(moderationService.assertTextAllowed).not.toHaveBeenCalled();
    });
  });

  describe('processPendingModerationBatch', () => {
    function pendingPost(overrides: Partial<WorkoutPost> = {}): WorkoutPost {
      return {
        id: 'post-1',
        workout_log_id: 10,
        user_id: 'author-1',
        image_url: 'https://example.com/a.jpg',
        caption: 'day 1',
        visibility: 'public',
        moderationStatus: WorkoutPostModerationStatus.PENDING,
        created_at: new Date(),
        ...overrides,
      } as WorkoutPost;
    }

    // MODERATION_GATE_ENABLED is true again (moderation re-enabled after the
    // OpenAI rate limit was resolved), so the batch sends each pending post
    // through the real OpenAI-backed moderation.
    it('should moderate each pending post through OpenAI while the moderation gate is enabled', async () => {
      postRepo.find.mockResolvedValue([
        pendingPost({ id: 'post-1', created_at: new Date() }),
      ]);
      moderationService.validateWorkoutImage.mockResolvedValue({
        flagged: false,
        flaggedCategories: [],
      });

      await service.processPendingModerationBatch();

      expect(moderationService.validateWorkoutImage).toHaveBeenCalledWith(
        'https://example.com/a.jpg',
        'day 1',
      );
      expect(postRepo.update).toHaveBeenCalledWith(
        'post-1',
        expect.objectContaining({
          moderationStatus: WorkoutPostModerationStatus.APPROVED,
        }),
      );
    });

    // moderatePostViaAi is exercised directly here to cover its failure paths.
    describe('moderatePostViaAi (preserved for when the gate is re-enabled)', () => {
      it('should auto-approve a post that has been pending for over 2 hours when the moderation service keeps failing', async () => {
        const staleDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h old
        const post = pendingPost({ id: 'stale-1', created_at: staleDate });
        moderationService.validateWorkoutImage.mockRejectedValue(
          new Error('429 Too Many Requests'),
        );

        await (
          service as unknown as {
            moderatePostViaAi: (post: WorkoutPost) => Promise<void>;
          }
        ).moderatePostViaAi(post);

        expect(postRepo.update).toHaveBeenCalledWith(
          'stale-1',
          expect.objectContaining({
            moderationStatus: WorkoutPostModerationStatus.APPROVED,
            moderationReason: expect.stringContaining(
              'Aprobado automáticamente',
            ),
          }),
        );
      });

      it('should NOT auto-approve a recently-uploaded post on its first failed attempt', async () => {
        const post = pendingPost({ id: 'fresh-1', created_at: new Date() });
        moderationService.validateWorkoutImage.mockRejectedValue(
          new Error('429 Too Many Requests'),
        );

        await (
          service as unknown as {
            moderatePostViaAi: (post: WorkoutPost) => Promise<void>;
          }
        ).moderatePostViaAi(post);

        expect(postRepo.update).not.toHaveBeenCalled();
      });

      it('should still reject genuinely flagged content normally, regardless of age', async () => {
        const staleDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const post = pendingPost({ id: 'flagged-1', created_at: staleDate });
        moderationService.validateWorkoutImage.mockResolvedValue({
          flagged: true,
          flaggedCategories: ['violence'],
        });

        await (
          service as unknown as {
            moderatePostViaAi: (post: WorkoutPost) => Promise<void>;
          }
        ).moderatePostViaAi(post);

        expect(postRepo.update).toHaveBeenCalledWith(
          'flagged-1',
          expect.objectContaining({
            moderationStatus: WorkoutPostModerationStatus.REJECTED,
          }),
        );
      });
    });
  });

  // ---------------------------------------------------------------------
  // GET /feed
  // ---------------------------------------------------------------------
  describe('getFeed', () => {
    // No viewerId given is the defensive-default path (never hit by the real
    // controller, which always has one from the global auth guard) — it
    // degrades to the original public-only, unpersonalized rule. See the
    // CP-64 tests below for the real (viewerId given) behavior.
    it("should degrade to visibility='public' AND moderation_status='approved' with no viewerId given (no ternary/degradation)", async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.visibility = 'public'");
      expect(sql).toContain("p.moderation_status = 'approved'");
      // The whole point of the audit fix: this predicate must be present
      // literally in the query text, not conditionally interpolated.
      expect(sql).not.toMatch(/\$\{.*moderation_status.*\}/);
    });

    it('should never bypass moderation for the post owner, with no viewerId given (no OR p.user_id fragment)', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/OR\s+p\.user_id/i);
    });

    // F8 (docs/testing/PLAN-MAESTRO-PRUEBAS.md): a post from a private
    // challenge must never surface in the global Feed, even if its own
    // visibility is 'public' — this is the read-time second layer behind
    // WorkoutLogService.resolvePostVisibility() (write-time downgrade).
    it('should exclude posts whose challenge is private, unconditionally (CP-30)', async () => {
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
      // Bloque 3: no longer a placeholder — 0 with an empty reactions/comments
      // table, not undefined (see the reactions/comments-populated test below).
      expect(posts[0].likes_count).toBe(0);
      expect(posts[0].liked_by_me).toBe(false);
      expect(posts[0].comments_count).toBe(0);
    });

    it('should populate likes_count/comments_count/liked_by_me from the batched reactions/comments lookups (Bloque 3)', async () => {
      postRepo.manager.query.mockResolvedValue([
        feedRow({ id: '1' }),
        feedRow({ id: '2' }),
      ]);
      reactionsService.getCountsForPosts.mockResolvedValue(new Map([['1', 5]]));
      reactionsService.getReactedPostIds.mockResolvedValue(new Set(['2']));
      commentsService.getCountsForPosts.mockResolvedValue(new Map([['2', 3]]));

      const { posts } = await service.getFeed({
        limit: 20,
        viewerId: VIEWER_ID,
      });

      expect(posts[0]).toEqual(
        expect.objectContaining({
          id: '1',
          likes_count: 5,
          liked_by_me: false,
          comments_count: 0,
        }),
      );
      expect(posts[1]).toEqual(
        expect.objectContaining({
          id: '2',
          likes_count: 0,
          liked_by_me: true,
          comments_count: 3,
        }),
      );
      expect(reactionsService.getCountsForPosts).toHaveBeenCalledWith([
        '1',
        '2',
      ]);
      expect(reactionsService.getReactedPostIds).toHaveBeenCalledWith(
        ['1', '2'],
        VIEWER_ID,
      );
      expect(commentsService.getCountsForPosts).toHaveBeenCalledWith([
        '1',
        '2',
      ]);
    });

    it('should skip the per-viewer reacted lookup (leaving liked_by_me false) when no viewerId is given', async () => {
      postRepo.manager.query.mockResolvedValue([feedRow({ id: '1' })]);

      const { posts } = await service.getFeed({ limit: 20 });

      expect(posts[0].liked_by_me).toBe(false);
      expect(reactionsService.getReactedPostIds).not.toHaveBeenCalled();
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

    // CP-64: home feed must surface the viewer's own 'followers'-visibility
    // posts and those of anyone they actively follow, not just 'public' ones
    // (bug: a post created with the app's default per-post visibility never
    // reached the feed, since only 'public' was ever considered).
    it("should also include 'followers'-visibility posts from the viewer or accounts they actively follow, when a viewerId is given (CP-64)", async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20, viewerId: VIEWER_ID });

      const [sql, params] = postRepo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain("p.visibility = 'public'");
      expect(sql).toContain("p.visibility = 'followers'");
      expect(sql).toMatch(/p\.user_id = \$\d+/);
      expect(sql).toMatch(/EXISTS[\s\S]*havit\.user_follows/);
      expect(sql).toMatch(/uf\.follower_user_id = \$\d+/);
      expect(sql).toMatch(/uf\.followed_user_id = p\.user_id/);
      expect(sql).toMatch(/uf\.is_active = true/);
      expect(params).toContain(VIEWER_ID);
    });

    it("should still never surface 'private' posts in the feed, even for their own author, when a viewerId is given (CP-64)", async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20, viewerId: VIEWER_ID });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toMatch(/p\.visibility = 'private'/);
    });

    it("should still require moderation_status='approved' unconditionally, with no owner exception, even when a viewerId is given (CP-64)", async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20, viewerId: VIEWER_ID });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("p.moderation_status = 'approved'");
      expect(sql).not.toMatch(/moderation_status.*OR\s+p\.user_id/i);
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

    // Real bug, verified on live data: a photo logged at 22:25 local time
    // in America/Guatemala (still Sept 1 locally) but already 04:25 the
    // next UTC day got mislabeled "day 4" (UTC's answer) instead of the
    // correct local "day 3" — the same class of bug the cycle-day-info and
    // workout-log timezone fixes already covered, just never wired in here.
    it("should compute the photo's challenge day against the poster's local calendar day, not UTC's", async () => {
      // Joined 2026-08-30T20:18:00Z -> 2026-08-30 14:18 local (Guatemala,
      // UTC-6). Logged 2026-09-02T04:25:00Z -> 2026-09-01 22:25 local —
      // still Sept 1 locally, though already Sept 2 in UTC.
      const row = photoRow({
        joined_at: new Date('2026-08-30T20:18:00.000Z'),
        created_at: new Date('2026-09-02T04:25:00.000Z'),
      });
      postRepo.manager.query.mockResolvedValueOnce([row]); // main query
      postRepo.manager.query.mockResolvedValueOnce([]); // metricsByWorkoutLog: base rows
      postRepo.manager.query.mockResolvedValueOnce([]); // metricsByWorkoutLog: exercise-level metric rows

      const photos = await service.getChallengePhotos(
        'challenge-1',
        VIEWER_ID,
        'America/Guatemala',
      );

      // Local day-diff: Aug 30 -> Sept 1 is 2 days elapsed -> day 3.
      // A UTC-only calc (Aug 30 -> Sept 2, 3 days elapsed) would say day 4.
      expect(photos[0].day).toBe(3);
    });

    it('should default to UTC when no timezone is given, matching the pre-fix behavior', async () => {
      const row = photoRow({
        joined_at: new Date('2026-08-30T20:18:00.000Z'),
        created_at: new Date('2026-09-02T04:25:00.000Z'),
      });
      postRepo.manager.query.mockResolvedValueOnce([row]);
      postRepo.manager.query.mockResolvedValueOnce([]);
      postRepo.manager.query.mockResolvedValueOnce([]);

      const photos = await service.getChallengePhotos('challenge-1', VIEWER_ID);

      expect(photos[0].day).toBe(4);
    });
  });

  // B2: GET /workout-posts/mosaic used to apply no visibility filter at all.
  describe('findMosaicByChallenge (B2 visibility)', () => {
    it('should apply post visibility, followers, challenge-privacy and hidden filters for the viewer', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.findMosaicByChallenge('challenge-1', VIEWER_ID);

      const [sql, params] = postRepo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('wl.challenge_id = $1');
      expect(sql).toContain('p.is_hidden = false');
      expect(sql).toContain("p.visibility != 'private'");
      expect(sql).toContain("p.visibility != 'followers'");
      expect(sql).toContain("c.visibility IS DISTINCT FROM 'private'");
      expect(sql).toMatch(/havit\.challenge_user_map/);
      expect(params[0]).toBe('challenge-1');
      expect(params[1]).toBe(VIEWER_ID);
    });

    it('should keep the legacy response shape', async () => {
      postRepo.manager.query.mockResolvedValue([
        {
          id: 'p1',
          workout_log_id: 7,
          user_id: 'u1',
          image_url: 'https://img',
          caption: null,
          visibility: 'public',
          created_at: new Date('2026-10-01T00:00:00Z'),
          wl_id: 7,
          wl_challenge_id: 'challenge-1',
          wl_routine_id: 3,
          wl_status: 'completed',
          wl_started_at: new Date('2026-10-01T00:00:00Z'),
        },
      ]);

      const result = await service.findMosaicByChallenge(
        'challenge-1',
        VIEWER_ID,
      );

      expect(result.data[0].workoutLog).toMatchObject({
        id: 7,
        challengeId: 'challenge-1',
        routineId: 3,
        status: 'completed',
      });
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
    it('other-view: should exclude posts from a private challenge unless the viewer is a member (CP-31)', async () => {
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

  // ---------------------------------------------------------------------
  // Sprint 9 (B4): an author deletes their own post — soft delete only
  // (is_active = false), and a deleted post disappears from every read path.
  // ---------------------------------------------------------------------
  describe('remove (B4 soft delete)', () => {
    const POST_ID = '5b1e7c1a-0000-4000-8000-000000000001';

    it('should soft-delete the owner’s post: is_active=false via save(), never a physical delete', async () => {
      const post = { id: POST_ID, user_id: VIEWER_ID, is_active: true };
      postRepo.findOne.mockResolvedValue(post);
      postRepo.save.mockImplementation((p: unknown) => Promise.resolve(p));

      const result = await service.remove(POST_ID, VIEWER_ID);

      expect(postRepo.findOne).toHaveBeenCalledWith({
        where: { id: POST_ID, is_active: true },
      });
      expect(postRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: POST_ID, is_active: false }),
      );
      expect(postRepo.update).not.toHaveBeenCalled();
      expect(result).toEqual({ message: 'Workout post deleted' });
    });

    it('should not touch is_hidden (admin moderation is a separate concept)', async () => {
      const post = {
        id: POST_ID,
        user_id: VIEWER_ID,
        is_active: true,
        is_hidden: false,
      };
      postRepo.findOne.mockResolvedValue(post);
      postRepo.save.mockImplementation((p: unknown) => Promise.resolve(p));

      await service.remove(POST_ID, VIEWER_ID);

      expect(postRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false, is_hidden: false }),
      );
    });

    it('should throw ForbiddenException when someone else tries to delete it, without saving', async () => {
      postRepo.findOne.mockResolvedValue({
        id: POST_ID,
        user_id: OTHER_USER_ID,
        is_active: true,
      });

      await expect(service.remove(POST_ID, VIEWER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(postRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a missing or already-deleted post, without saving', async () => {
      postRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(POST_ID, VIEWER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(postRepo.save).not.toHaveBeenCalled();
    });

    it('should exclude soft-deleted posts from the feed', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getFeed({ limit: 20, viewerId: VIEWER_ID });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('p.is_active = true');
    });

    it('should exclude soft-deleted posts from the challenge gallery and /mine', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.getChallengePhotos('challenge-1', VIEWER_ID);
      await service.getUserPhotos(VIEWER_ID);

      for (const [sql] of postRepo.manager.query.mock.calls as Array<
        [string, unknown[]]
      >) {
        expect(sql).toContain('p.is_active = true');
      }
    });

    it('should exclude soft-deleted posts from paginated user posts, even for their own author', async () => {
      userRepo.findOne.mockResolvedValue({ id: VIEWER_ID, is_active: true });
      postRepo.manager.query.mockResolvedValue([]);

      await service.getUserPosts(VIEWER_ID, VIEWER_ID, { limit: 20 });

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('p.is_active = true');
    });

    it('should exclude soft-deleted posts from the challenge mosaic', async () => {
      postRepo.manager.query.mockResolvedValue([]);

      await service.findMosaicByChallenge('challenge-1', VIEWER_ID);

      const [sql] = postRepo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('p.is_active = true');
    });

    it('should not spend a moderation run on soft-deleted pending posts', async () => {
      await service.processPendingModerationBatch();

      const [options] = postRepo.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(options.where).toMatchObject({ is_active: true });
    });
  });
});
