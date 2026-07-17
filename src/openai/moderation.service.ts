import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';

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
        model: 'omni-moderation-latest',
        input,
      });

      const result = response.results[0];

      const flaggedCategories = result.flagged
        ? Object.entries(result.categories)
            .filter(([, isFlagged]) => isFlagged)
            .map(([category]) => category)
        : [];

      return { flagged: result.flagged, flaggedCategories };
    } catch (error) {
      console.error('MODERATION ERROR:', error);

      throw new ServiceUnavailableException(
        'No se pudo validar el contenido en este momento. Intenta nuevamente más tarde.',
      );
    }
  }
}
