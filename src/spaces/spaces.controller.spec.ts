import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

describe('SpacesController', () => {
  let controller: SpacesController;
  let service: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    join: jest.Mock;
    leave: jest.Mock;
    listMembers: jest.Mock;
    listMessages: jest.Mock;
    sendMessage: jest.Mock;
    listJoinRequests: jest.Mock;
    respondToJoinRequest: jest.Mock;
  };

  const currentUser: AuthenticatedUser = {
    sub: 'user-1',
    email: 'user1@example.com',
    username: 'user1',
  };

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({ message: 'ok' }),
      join: jest.fn().mockResolvedValue({}),
      leave: jest.fn().mockResolvedValue({ message: 'ok' }),
      listMembers: jest.fn().mockResolvedValue([]),
      listMessages: jest
        .fn()
        .mockResolvedValue({ messages: [], nextBefore: null }),
      sendMessage: jest.fn().mockResolvedValue({}),
      listJoinRequests: jest.fn().mockResolvedValue([]),
      respondToJoinRequest: jest.fn().mockResolvedValue({}),
    };

    controller = new SpacesController(service as unknown as SpacesService);
  });

  it('should create a space on behalf of the authenticated caller', async () => {
    const dto = { name: 'Gym bros', visibility: 'public' as const };
    await controller.create(dto, currentUser);
    expect(service.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('should list spaces scoped to the authenticated caller', async () => {
    await controller.findAll(currentUser);
    expect(service.findAll).toHaveBeenCalledWith('user-1');
  });

  it('should fetch a single space scoped to the authenticated caller', async () => {
    await controller.findOne('space-1', currentUser);
    expect(service.findOne).toHaveBeenCalledWith('user-1', 'space-1');
  });

  it('should update a space on behalf of the authenticated caller, not a trusted body field', async () => {
    const dto = { name: 'New name' };
    await controller.update('space-1', dto, currentUser);
    expect(service.update).toHaveBeenCalledWith('user-1', 'space-1', dto);
  });

  it('should delete a space on behalf of the authenticated caller', async () => {
    await controller.remove('space-1', currentUser);
    expect(service.remove).toHaveBeenCalledWith('user-1', 'space-1');
  });

  it('should join a space on behalf of the authenticated caller', async () => {
    await controller.join('space-1', currentUser);
    expect(service.join).toHaveBeenCalledWith('user-1', 'space-1');
  });

  it('should leave a space on behalf of the authenticated caller', async () => {
    await controller.leave('space-1', currentUser);
    expect(service.leave).toHaveBeenCalledWith('user-1', 'space-1');
  });

  it('should list members without requiring an owner check', async () => {
    await controller.listMembers('space-1');
    expect(service.listMembers).toHaveBeenCalledWith('space-1');
  });

  it('should list space messages scoped to the authenticated caller (membership check happens in the service)', async () => {
    const query = { limit: 10 };
    await controller.listMessages('space-1', query, currentUser);
    expect(service.listMessages).toHaveBeenCalledWith(
      'user-1',
      'space-1',
      query,
    );
  });

  it('should send a space message on behalf of the authenticated caller', async () => {
    const dto = { content: 'hola equipo' };
    await controller.sendMessage('space-1', dto, currentUser);
    expect(service.sendMessage).toHaveBeenCalledWith(
      'user-1',
      'space-1',
      'hola equipo',
    );
  });

  it('should list join requests scoped to the authenticated caller (owner check happens in the service)', async () => {
    await controller.listJoinRequests('space-1', currentUser);
    expect(service.listJoinRequests).toHaveBeenCalledWith('user-1', 'space-1');
  });

  it('should approve a join request on behalf of the authenticated caller', async () => {
    await controller.approveJoinRequest('space-1', 'req-1', currentUser);
    expect(service.respondToJoinRequest).toHaveBeenCalledWith(
      'user-1',
      'space-1',
      'req-1',
      true,
    );
  });

  it('should reject a join request on behalf of the authenticated caller', async () => {
    await controller.rejectJoinRequest('space-1', 'req-1', currentUser);
    expect(service.respondToJoinRequest).toHaveBeenCalledWith(
      'user-1',
      'space-1',
      'req-1',
      false,
    );
  });
});
