import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

describe('ChatsController', () => {
  let controller: ChatsController;
  let service: {
    findOrCreateDirectConversation: jest.Mock;
    listConversations: jest.Mock;
    listMessages: jest.Mock;
    sendMessage: jest.Mock;
    markConversationRead: jest.Mock;
  };

  const currentUser: AuthenticatedUser = {
    sub: 'user-1',
    email: 'user1@example.com',
    username: 'user1',
  };

  beforeEach(() => {
    service = {
      findOrCreateDirectConversation: jest.fn().mockResolvedValue({}),
      listConversations: jest.fn().mockResolvedValue([]),
      listMessages: jest
        .fn()
        .mockResolvedValue({ messages: [], nextBefore: null }),
      sendMessage: jest.fn().mockResolvedValue({}),
      markConversationRead: jest.fn().mockResolvedValue({ updated: 0 }),
    };

    controller = new ChatsController(service as unknown as ChatsService);
  });

  it('should start a conversation on behalf of the authenticated caller', async () => {
    await controller.createConversation(
      { recipientUserId: 'user-2' },
      currentUser,
    );

    expect(service.findOrCreateDirectConversation).toHaveBeenCalledWith(
      'user-1',
      'user-2',
    );
  });

  it('should list conversations scoped to the authenticated caller', async () => {
    await controller.listConversations(currentUser);

    expect(service.listConversations).toHaveBeenCalledWith('user-1');
  });

  it('should list messages scoped to the authenticated caller, not a trusted path param alone', async () => {
    await controller.listMessages('conv-1', { limit: 10 }, currentUser);

    expect(service.listMessages).toHaveBeenCalledWith('user-1', 'conv-1', {
      limit: 10,
    });
  });

  it('should send a message on behalf of the authenticated caller', async () => {
    await controller.sendMessage('conv-1', { content: 'hola' }, currentUser);

    expect(service.sendMessage).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      'hola',
    );
  });

  it('should mark a conversation as read on behalf of the authenticated caller', async () => {
    await controller.markRead('conv-1', currentUser);

    expect(service.markConversationRead).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
    );
  });
});
