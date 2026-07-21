import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  let controller: MetricsController;
  let service: {
    findAll: jest.Mock;
    addMetric: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      addMetric: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: service }],
    }).compile();

    controller = module.get(MetricsController);
    jest.clearAllMocks();
  });

  it('returns all metric types from the service', async () => {
    const metricTypes = [{ id: 1, code: 'reps' }];
    service.findAll.mockResolvedValue(metricTypes);

    await expect(controller.findAll()).resolves.toBe(metricTypes);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });

  it('converts the route id and delegates metric data', async () => {
    const body = { metricCode: 'weight', value: 42.5 };
    const saved = { id: 10, valueDecimal: 42.5 };
    service.addMetric.mockResolvedValue(saved);

    await expect(controller.addMetric('7', body)).resolves.toBe(saved);
    expect(service.addMetric).toHaveBeenCalledWith(7, 'weight', 42.5);
  });

  it('propagates service errors', async () => {
    const error = new BadRequestException('Metric not allowed');
    service.addMetric.mockRejectedValue(error);

    await expect(
      controller.addMetric('7', { metricCode: 'weight', value: 10 }),
    ).rejects.toBe(error);
  });
});
