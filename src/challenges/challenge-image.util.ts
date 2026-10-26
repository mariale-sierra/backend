import { In, Repository } from 'typeorm';
import {
  Challenge,
  ChallengeImageModerationStatus,
} from './entities/challenge.entity';
import {
  SIGNED_READ_TTL_SECONDS,
  UploadsService,
} from '../uploads/uploads.service';

/** What the client gets for a challenge photo: 'none' = the creator didn't add one. */
export type ChallengeImageStatus = 'none' | ChallengeImageModerationStatus;

export interface ChallengeImageFields {
  /** Signed read URL, only for an 'approved' photo; null otherwise. */
  imageUrl: string | null;
  imageStatus: ChallengeImageStatus;
}

export const NO_CHALLENGE_IMAGE: ChallengeImageFields = {
  imageUrl: null,
  imageStatus: 'none',
};

/**
 * Sprint 10 — the photo fields for a set of challenges, in ONE query. The
 * image columns are `select: false` on the entity, so this is the only read
 * path for them: a photo that isn't 'approved' never leaves the backend
 * (the client shows a placeholder), and an approved one is signed for its
 * creator, same as a Space cover.
 */
export async function loadChallengeImages(
  challengeRepo: Repository<Challenge>,
  uploadsService: UploadsService,
  challengeIds: string[],
): Promise<Map<string, ChallengeImageFields>> {
  const result = new Map<string, ChallengeImageFields>();
  const unique = [...new Set(challengeIds)];
  if (unique.length === 0) return result;

  const rows = await challengeRepo.find({
    where: { id: In(unique) },
    select: {
      id: true,
      created_by_user_id: true,
      image_url: true,
      image_moderation_status: true,
    },
  });

  await Promise.all(
    rows.map(async (row) => {
      if (!row.image_url || !row.image_moderation_status) {
        result.set(row.id, NO_CHALLENGE_IMAGE);
        return;
      }
      const imageUrl =
        row.image_moderation_status === 'approved'
          ? await uploadsService.toCachedSignedReadUrl(
              row.image_url,
              row.created_by_user_id,
              SIGNED_READ_TTL_SECONDS.challenge,
            )
          : null;
      result.set(row.id, {
        imageUrl,
        imageStatus: row.image_moderation_status,
      });
    }),
  );
  return result;
}
