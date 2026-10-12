import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { ErrorCode } from '../common/constants/error-code.enum';
import {
  describeExternalError,
  recordExternalCall,
} from '../common/external-call-telemetry';

const MODERATION_MODEL = 'omni-moderation-latest';

/**
 * B11 — reliability settings for the OpenAI SDK, made explicit instead of
 * relying on its defaults. The SDK itself retries (exponential backoff
 * 0.5s → 8s with jitter, honouring Retry-After) on connection errors,
 * timeouts, 408, 409, 429 and 5xx, and never on other 4xx (bad request,
 * invalid key, ...) — so no second retry layer is added here. What changes
 * is the per-attempt timeout: the SDK default is 10 minutes, far too long for
 * the synchronous text-moderation endpoints (comment/challenge/profile), so
 * a hung connection now fails after ~8s per attempt (worst case ≈ 3 attempts
 * × 8s + backoff) and surfaces as the existing fail-closed 503.
 */
export const OPENAI_MAX_RETRIES = 2;
export const OPENAI_TIMEOUT_MS = 8_000;

type ModerationCreateInput = Parameters<
  OpenAI['moderations']['create']
>[0]['input'];

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
  private readonly logger = new Logger(ModerationService.name);

  /**
   * One client per call so `onRetry` can count this call's own retries. The
   * SDK reports each retry through its logger at `info` level (a line such
   * as `[log_x] POST .../moderations failed with status 503 in 120ms -
   * retrying, 1 attempts remaining`): request id, URL and status only — no
   * API key, no request body. Every other SDK info/debug line (per-request
   * success lines, debug request details) is dropped.
   */
  private getClient(onRetry: (sdkMessage: string) => void = () => {}) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new InternalServerErrorException(
        'OPENAI_API_KEY is not configured',
      );
    }

    return new OpenAI({
      apiKey,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: OPENAI_TIMEOUT_MS,
      logLevel: 'info',
      logger: {
        debug: () => {},
        info: (message: string) => {
          if (typeof message === 'string' && message.includes('retrying')) {
            onRetry(message);
          }
        },
        warn: (message: string) =>
          this.logger.warn(`OpenAI SDK: ${String(message)}`),
        error: (message: string) =>
          this.logger.error(`OpenAI SDK: ${String(message)}`),
      },
    });
  }

  /**
   * The single place that talks to OpenAI. Logs each failed attempt the SDK
   * retries, records the call's final outcome (external_call log line +
   * counters, see common/external-call-telemetry.ts) and maps any final
   * failure to the existing fail-closed 503. A flagged verdict is a
   * successful call, never an error.
   */
  private async createModeration(input: ModerationCreateInput) {
    let retries = 0;
    const openai = this.getClient((sdkMessage) => {
      retries += 1;
      this.logger.warn(
        `OpenAI moderation attempt ${retries}/${OPENAI_MAX_RETRIES + 1} failed, retrying: ${sdkMessage}`,
      );
    });
    const startedAt = Date.now();

    try {
      const response = await openai.moderations.create({
        model: MODERATION_MODEL,
        input,
      });
      recordExternalCall(this.logger, {
        service: 'openai',
        operation: 'moderations.create',
        outcome: 'success',
        attempts: retries + 1,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      recordExternalCall(this.logger, {
        service: 'openai',
        operation: 'moderations.create',
        outcome: 'failure',
        attempts: retries + 1,
        durationMs: Date.now() - startedAt,
        error: describeExternalError(error),
      });
      throw new ServiceUnavailableException(SERVICE_UNAVAILABLE_MESSAGE);
    }
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

    const response = await this.createModeration(input);
    const result = response.results?.[0];
    if (!result) {
      throw new ServiceUnavailableException(SERVICE_UNAVAILABLE_MESSAGE);
    }

    return {
      flagged: result.flagged,
      flaggedCategories: this.extractFlaggedCategories(result),
    };
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

    const response = await this.createModeration(texts);

    const flaggedResults = (response.results ?? []).filter((r) => r.flagged);
    const flaggedCategories = [
      ...new Set(
        flaggedResults.flatMap((r) => this.extractFlaggedCategories(r)),
      ),
    ];

    return { flagged: flaggedResults.length > 0, flaggedCategories };
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
