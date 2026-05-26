import {
  BadRequestException,
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

  async validateWorkoutImage(imageUrl: string, caption?: string) {
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

      if (result.flagged) {
        const flaggedCategories = Object.entries(result.categories)
          .filter(([, isFlagged]) => isFlagged)
          .map(([category]) => category);

        throw new BadRequestException({
          message: 'Image or caption was rejected by moderation',
          categories: flaggedCategories,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Content moderation service is not available',
      );
    }
  }
}