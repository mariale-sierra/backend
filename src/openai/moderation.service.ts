import {
  BadRequestException,
  HttpException,
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
          message:
            'No se puede publicar este contenido. La imagen o el texto fueron rechazados por moderación.',
          code: 'CONTENT_REJECTED',
          categories: flaggedCategories,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'No se pudo validar el contenido en este momento. Intenta nuevamente más tarde.',
      );
    }
  }
}