import {
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_PUSH_SEND_URL,
  ExpoPushMessage,
  ExpoPushService,
} from './expo-push.service';

const message = (to: string): ExpoPushMessage => ({
  to,
  title: 'Nuevo comentario',
  body: 'Alguien comentó tu publicación.',
  data: { type: 'post_comment', entityType: 'workout_post', entityId: 'p1' },
});

const jsonResponse = (data: unknown, ok = true, status = 200) =>
  Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve({ data }),
  } as unknown as Response);

describe('ExpoPushService', () => {
  let pushTokens: { deactivate: jest.Mock };
  let service: ExpoPushService;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    pushTokens = { deactivate: jest.fn().mockResolvedValue(undefined) };
    service = new ExpoPushService(pushTokens as never);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the messages to Expo and keeps the ticket ids to check receipts', async () => {
    fetchMock.mockReturnValue(jsonResponse([{ status: 'ok', id: 't-1' }]));

    await service.send([message('ExponentPushToken[a]')]);

    expect(fetchMock).toHaveBeenCalledWith(
      EXPO_PUSH_SEND_URL,
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = (fetchMock.mock.calls as [string, { body: string }][])[0];
    const body: unknown = JSON.parse(init.body);
    expect(body).toEqual([message('ExponentPushToken[a]')]);
    expect(service.pendingReceiptCount()).toBe(1);
    expect(pushTokens.deactivate).toHaveBeenCalledWith([]);
  });

  it('splits more than 100 messages into several requests', async () => {
    fetchMock.mockImplementation((_url: string, init: { body: string }) =>
      jsonResponse(
        (JSON.parse(init.body) as unknown[]).map(() => ({ status: 'ok' })),
      ),
    );
    await service.send(
      Array.from({ length: 150 }, (_, i) => message(`ExponentPushToken[${i}]`)),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deactivates a token Expo reports as DeviceNotRegistered in the ticket', async () => {
    fetchMock.mockReturnValue(
      jsonResponse([
        { status: 'ok', id: 't-1' },
        {
          status: 'error',
          message: 'not registered',
          details: { error: 'DeviceNotRegistered' },
        },
      ]),
    );
    await service.send([
      message('ExponentPushToken[good]'),
      message('ExponentPushToken[gone]'),
    ]);
    expect(pushTokens.deactivate).toHaveBeenCalledWith([
      'ExponentPushToken[gone]',
    ]);
  });

  it('does not throw when Expo answers an HTTP error', async () => {
    fetchMock.mockReturnValue(jsonResponse(undefined, false, 500));
    await expect(
      service.send([message('ExponentPushToken[a]')]),
    ).resolves.toBeUndefined();
    expect(pushTokens.deactivate).not.toHaveBeenCalled();
  });

  it('does not throw when the network call itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      service.send([message('ExponentPushToken[a]')]),
    ).resolves.toBeUndefined();
  });

  it('checks receipts later and deactivates tokens that turned out invalid', async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse([
        { status: 'ok', id: 't-1' },
        { status: 'ok', id: 't-2' },
        { status: 'ok', id: 't-3' },
      ]),
    );
    await service.send([
      message('ExponentPushToken[a]'),
      message('ExponentPushToken[b]'),
      message('ExponentPushToken[c]'),
    ]);

    fetchMock.mockReturnValueOnce(
      jsonResponse({
        't-1': { status: 'ok' },
        't-2': { status: 'error', details: { error: 'DeviceNotRegistered' } },
        // t-3 not ready yet
      }),
    );
    await service.checkReceipts();

    expect(fetchMock).toHaveBeenLastCalledWith(
      EXPO_PUSH_RECEIPTS_URL,
      expect.objectContaining({
        body: JSON.stringify({ ids: ['t-1', 't-2', 't-3'] }),
      }),
    );
    expect(pushTokens.deactivate).toHaveBeenLastCalledWith([
      'ExponentPushToken[b]',
    ]);
    // Only the receipt that wasn't ready is kept for the next run.
    expect(service.pendingReceiptCount()).toBe(1);
  });

  it('keeps pending receipts when the receipts call fails', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse([{ status: 'ok', id: 't-1' }]));
    await service.send([message('ExponentPushToken[a]')]);
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(service.checkReceipts()).resolves.toBeUndefined();
    expect(service.pendingReceiptCount()).toBe(1);
  });
});
