import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { ErrorCode } from '../common/constants/error-code.enum';

const MODERATION_MODEL = 'omni-moderation-latest';

/**
 * Message returned to the client when text is rejected. The frontend maps
 * `code: CONTENT_REJECTED` to its own i18n string (es/en); this Spanish text
 * is only the fallback for clients that don't.
 */
export const CONTENT_REJECTED_MESSAGE =
  'Tu contenido no cumple con las normas de la comunidad';

const SERVICE_UNAVAILABLE_MESSAGE =
  'No se pudo validar el contenido en este momento. Intenta nuevamente más tarde.';

type ModerationInputItem =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

export interface ModerationResult {
  flagged: boolean;
  flaggedCategories: string[];
}

@Injectable()
export class ModerationService {
  private getClient() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new InternalServerErrorException(
        'OPENAI_API_KEY is not configured',
      );
    }

    return new OpenAI({ apiKey });
  }

  /**
   * Returns the moderation verdict for a workout post image/caption.
   *
   * Important: a "flagged" (rejected) result is a *successful* moderation
   * call, not a failure — it is returned normally, never thrown. Only a real
   * problem talking to the moderation API (network error, missing API key,
   * rate limiting, etc.) throws. Callers must check `result.flagged` instead
   * of relying on try/catch to distinguish "content rejected" from "service
   * unavailable" — conflating the two previously caused legitimately
   * rejected images to be retried 3 times and then mislabeled as "pending"
   * instead of "rejected".
   */
  async validateWorkoutImage(
    imageUrl: string,
    caption?: string,
  ): Promise<ModerationResult> {
    const openai = this.getClient();

    const input: ModerationInputItem[] = [];

    if (caption && caption.trim().length > 0) {
      input.push({
        type: 'text',
        text: caption.trim(),
      });
    }

    input.push({
      type: 'image_url',
      image_url: {
        url: imageUrl,
      },
    });

    try {
      const response = await openai.moderations.create({
        model: MODERATION_MODEL,
        input,
      });

      const result = response.results[0];

      return {
        flagged: result.flagged,
        flaggedCategories: this.extractFlaggedCategories(result),
      };
    } catch (error) {
      console.error('MODERATION ERROR:', error);

      throw new ServiceUnavailableException(SERVICE_UNAVAILABLE_MESSAGE);
    }
  }

  /**
   * B3 — text-only sibling of validateWorkoutImage(): same model, same
   * `{ flagged, flaggedCategories }` shape, same error semantics (a flagged
   * result is returned normally; only a failure talking to OpenAI throws,
   * as a 503).
   *
   * Accepts one text or several (e.g. a challenge's name + description +
   * instructions) and moderates them in a single API call — OpenAI returns
   * one result per string, which are merged here: flagged if any is
   * flagged, categories de-duplicated. Empty/whitespace-only entries are
   * skipped, and if nothing is left the API isn't called at all.
   *
   * Where it's applied (synchronously, before saving) is documented in
   * docs/moderacion-automatica.md.
   */
  async validateText(
    input: string | Array<string | null | undefined>,
  ): Promise<ModerationResult> {
    const texts = (Array.isArray(input) ? input : [input])
      .map((text) => (typeof text === 'string' ? text.trim() : ''))
      .filter((text) => text.length > 0);

    if (texts.length === 0) {
      return { flagged: false, flaggedCategories: [] };
    }

    const openai = this.getClient();

    try {
      const response = await openai.moderations.create({
        model: MODERATION_MODEL,
        input: texts,
      });

      const flaggedResults = response.results.filter((r) => r.flagged);
      const flaggedCategories = [
        ...new Set(
          flaggedResults.flatMap((r) => this.extractFlaggedCategories(r)),
        ),
      ];

      return { flagged: flaggedResults.length > 0, flaggedCategories };
    } catch (error) {
      console.error('MODERATION ERROR:', error);

      throw new ServiceUnavailableException(SERVICE_UNAVAILABLE_MESSAGE);
    }
  }

  /**
   * Runs validateText() and rejects flagged content with the standard
   * B3 error: 400 `{ message, error, code: 'CONTENT_REJECTED' }` (same
   * global shape HttpExceptionFilter builds for every error). Call it
   * right before persisting user text. Fail-closed: if OpenAI can't be
   * reached, validateText()'s 503 propagates and nothing is saved.
   */
  async assertTextAllowed(
    input: string | Array<string | null | undefined>,
  ): Promise<void> {
    const result = await this.validateText(input);

    if (result.flagged) {
      throw new BadRequestException({
        message: CONTENT_REJECTED_MESSAGE,
        error: 'Bad Request',
        code: ErrorCode.CONTENT_REJECTED,
      });
    }
  }

  private extractFlaggedCategories(result: { categories: object }): string[] {
    return Object.entries(result.categories)
      .filter(([, isFlagged]) => isFlagged === true)
      .map(([category]) => category);
  }
}
