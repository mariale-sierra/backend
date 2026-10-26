import { NotFoundException } from '@nestjs/common';
import { SharedContentService } from './shared-content.service';
import { SIGNED_READ_TTL_SECONDS } from '../uploads/uploads.service';

const VIEWER_ID = 'viewer-1';
const POST_ID = 'post-1';

function makeService(rows: unknown[]) {
  const dataSource = {
    query: jest.fn().mockResolvedValue(rows),
    manager: {},
  };
  // B5 — CP4a: identity pass-through by default — real dispatch/TTL logic is
  // asserted explicitly per test via toHaveBeenCalledWith.
  const uploadsService = {
    toCachedSignedReadUrl: jest
      .fn()
      .mockImplementation((url: string | null | undefined) =>
        Promise.resolve(url ? `cached:${url}` : null),
      ),
    toSignedReadUrl: jest
      .fn()
      .mockImplementation((url: string | null | undefined) =>
        Promise.resolve(url ? `signed:${url}` : null),
      ),
  };
  const service = new SharedContentService(
    dataSource as never,
    uploadsService as never,
  );
  return { service, dataSource, uploadsService };
}

function visibleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: POST_ID,
    image_url: 'https://cdn.example/uploads/author-1/p.jpeg',
    caption: 'day 1',
    user_id: 'author-1',
    username: 'alice',
    display_name: 'Alice',
    profile_image_url: 'https://cdn.example/uploads/author-1/avatar.jpeg',
    visibility: 'public',
    visible: true,
    ...overrides,
  };
}

describe('SharedContentService.resolvePosts (B5 — CP4a)', () => {
  it('signs the image (cached, public TTL) and the author photo (cached, profile TTL) for a visible public post', async () => {
    const { service, uploadsService } = makeService([visibleRow()]);

    const result = await service.resolvePosts([POST_ID], VIEWER_ID);
    const preview = result.get(POST_ID)!;

    expect(preview.available).toBe(true);
    expect(preview.imageUrl).toBe(
      'cached:https://cdn.example/uploads/author-1/p.jpeg',
    );
    expect(preview.author?.profileImageUrl).toBe(
      'cached:https://cdn.example/uploads/author-1/avatar.jpeg',
    );
    expect(uploadsService.toCachedSignedReadUrl).toHaveBeenCalledWith(
      'https://cdn.example/uploads/author-1/p.jpeg',
      'author-1',
      SIGNED_READ_TTL_SECONDS.postPublic,
    );
    expect(uploadsService.toCachedSignedReadUrl).toHaveBeenCalledWith(
      'https://cdn.example/uploads/author-1/avatar.jpeg',
      'author-1',
      SIGNED_READ_TTL_SECONDS.profile,
    );
  });

  it('signs a visible private post (shared by its own author) with the UNCACHED path and the private TTL', async () => {
    const { service, uploadsService } = makeService([
      visibleRow({ visibility: 'private' }),
    ]);

    await service.resolvePosts([POST_ID], 'author-1');

    expect(uploadsService.toSignedReadUrl).toHaveBeenCalledWith(
      'https://cdn.example/uploads/author-1/p.jpeg',
      'author-1',
      SIGNED_READ_TTL_SECONDS.postPrivate,
    );
    expect(uploadsService.toCachedSignedReadUrl).not.toHaveBeenCalledWith(
      'https://cdn.example/uploads/author-1/p.jpeg',
      'author-1',
      expect.anything(),
    );
  });

  it('signs a visible followers-visibility post with the UNCACHED path and the followers TTL', async () => {
    const { service, uploadsService } = makeService([
      visibleRow({ visibility: 'followers' }),
    ]);

    await service.resolvePosts([POST_ID], VIEWER_ID);

    expect(uploadsService.toSignedReadUrl).toHaveBeenCalledWith(
      'https://cdn.example/uploads/author-1/p.jpeg',
      'author-1',
      SIGNED_READ_TTL_SECONDS.postFollowers,
    );
  });

  // B5 — CP4a: the critical safety property. The signing/caching layer must
  // never run ahead of (or instead of) the same `available` check the DTO
  // already depends on — see shared-content.service.ts's own comment at the
  // call site this proves.
  describe('when the post is not available to this viewer', () => {
    it('never signs anything for a post SQL excluded entirely (deleted/hidden — not in `rows`)', async () => {
      const { service, uploadsService } = makeService([]); // SQL returned nothing

      const result = await service.resolvePosts([POST_ID], VIEWER_ID);
      const preview = result.get(POST_ID)!;

      expect(preview.available).toBe(false);
      expect(preview.imageUrl).toBeNull();
      expect(preview.author).toBeNull();
      expect(uploadsService.toCachedSignedReadUrl).not.toHaveBeenCalled();
      expect(uploadsService.toSignedReadUrl).not.toHaveBeenCalled();
    });

    it('never signs anything for a row present but marked not visible (private post of someone else, e.g.)', async () => {
      const { service, uploadsService } = makeService([
        visibleRow({ visibility: 'private', visible: false }),
      ]);

      const result = await service.resolvePosts([POST_ID], VIEWER_ID);
      const preview = result.get(POST_ID)!;

      expect(preview.available).toBe(false);
      expect(preview.imageUrl).toBeNull();
      expect(preview.author).toBeNull();
      expect(uploadsService.toCachedSignedReadUrl).not.toHaveBeenCalled();
      expect(uploadsService.toSignedReadUrl).not.toHaveBeenCalled();
    });
  });

  describe('assertPostShareable', () => {
    it('throws NotFoundException (not a 403) when the post is not shareable, without signing anything', async () => {
      const { service, uploadsService } = makeService([]);

      await expect(
        service.assertPostShareable(POST_ID, VIEWER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(uploadsService.toCachedSignedReadUrl).not.toHaveBeenCalled();
      expect(uploadsService.toSignedReadUrl).not.toHaveBeenCalled();
    });

    it('resolves without throwing when the post is shareable', async () => {
      const { service } = makeService([visibleRow()]);

      await expect(
        service.assertPostShareable(POST_ID, 'author-1'),
      ).resolves.toBeUndefined();
    });
  });
});
