import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CONTENT_REJECTED_MESSAGE,
  ModerationService,
} from './moderation.service';

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    moderations: { create: mockCreate },
  })),
}));

function result(flagged: boolean, categories: Record<string, boolean> = {}) {
  return { flagged, categories };
}

describe('ModerationService', () => {
  let service: ModerationService;
  const originalKey = process.env.OPENAI_API_KEY;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
    service = new ModerationService();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  describe('validateText (B3)', () => {
    it('should not call OpenAI when every text is empty/whitespace/undefined', async () => {
      await expect(
        service.validateText(['', '   ', undefined, null]),
      ).resolves.toEqual({ flagged: false, flaggedCategories: [] });
      await expect(service.validateText('  ')).resolves.toEqual({
        flagged: false,
        flaggedCategories: [],
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should send only non-empty trimmed texts, in one call, to omni-moderation-latest', async () => {
      mockCreate.mockResolvedValue({
        results: [result(false), result(false)],
      });

      await service.validateText([' Reto 30 días ', undefined, '', 'Corre 5k']);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'omni-moderation-latest',
        input: ['Reto 30 días', 'Corre 5k'],
      });
    });

    it('should return not flagged for accepted content', async () => {
      mockCreate.mockResolvedValue({
        results: [result(false, { harassment: false })],
      });

      await expect(service.validateText('¡Gran progreso!')).resolves.toEqual({
        flagged: false,
        flaggedCategories: [],
      });
    });

    it('should flag when any text is flagged and merge categories without duplicates', async () => {
      mockCreate.mockResolvedValue({
        results: [
          result(false, { harassment: false }),
          result(true, { harassment: true, violence: false }),
          result(true, { harassment: true, 'hate/threatening': true }),
        ],
      });

      const verdict = await service.validateText(['ok', 'bad 1', 'bad 2']);

      expect(verdict.flagged).toBe(true);
      expect(verdict.flaggedCategories.sort()).toEqual([
        'harassment',
        'hate/threatening',
      ]);
    });

    it('should fail closed with 503 when OpenAI errors', async () => {
      mockCreate.mockRejectedValue(new Error('429 quota exceeded'));

      await expect(service.validateText('hola')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw 500 when OPENAI_API_KEY is missing', async () => {
      delete process.env.OPENAI_API_KEY;

      await expect(service.validateText('hola')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('assertTextAllowed (B3)', () => {
    it('should resolve for accepted content', async () => {
      mockCreate.mockResolvedValue({ results: [result(false)] });

      await expect(service.assertTextAllowed('hola')).resolves.toBeUndefined();
    });

    it('should reject flagged content with 400 and the standard CONTENT_REJECTED body', async () => {
      mockCreate.mockResolvedValue({
        results: [result(true, { harassment: true })],
      });

      const error = await service
        .assertTextAllowed('texto ofensivo')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        message: CONTENT_REJECTED_MESSAGE,
        error: 'Bad Request',
        code: 'CONTENT_REJECTED',
      });
    });

    it('should propagate the 503 when OpenAI is unavailable (fail-closed)', async () => {
      mockCreate.mockRejectedValue(new Error('network'));

      await expect(service.assertTextAllowed('hola')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('validateWorkoutImage (unchanged behaviour)', () => {
    it('should still send caption + image as one multimodal input and return the same shape', async () => {
      mockCreate.mockResolvedValue({
        results: [result(true, { sexual: true, violence: false })],
      });

      const verdict = await service.validateWorkoutImage(
        'https://example.com/a.jpg',
        ' día 3 ',
      );

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'omni-moderation-latest',
        input: [
          { type: 'text', text: 'día 3' },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/a.jpg' },
          },
        ],
      });
      expect(verdict).toEqual({ flagged: true, flaggedCategories: ['sexual'] });
    });
  });
});
