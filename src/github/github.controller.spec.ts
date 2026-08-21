import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GithubController } from './github.controller';
import { GithubSyncService } from './github-sync.service';
import { UserRole } from '../common/enums';
import { Repository, User } from '../common/entities';

describe('GithubController', () => {
  let controller: GithubController;
  let syncService: {
    syncRepository: jest.Mock;
    findRepositoryByOwnerAndName: jest.Mock;
  };

  beforeEach(async () => {
    syncService = {
      syncRepository: jest.fn(),
      findRepositoryByOwnerAndName: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GithubController],
      providers: [{ provide: GithubSyncService, useValue: syncService }],
    }).compile();

    controller = module.get<GithubController>(GithubController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('rejects unprivileged user role (e.g. contributor only)', async () => {
    const mockReq = {
      user: {
        id: 'u-1',
        roles: [UserRole.CONTRIBUTOR],
      } as User,
    } as any;

    await expect(
      controller.sync('acme', 'widgets', mockReq),
    ).rejects.toThrow(ForbiddenException);
    expect(syncService.syncRepository).not.toHaveBeenCalled();
  });

  it('rejects sync for untracked repository', async () => {
    const mockReq = {
      user: {
        id: 'u-2',
        roles: [UserRole.MAINTAINER],
      } as User,
    } as any;

    syncService.findRepositoryByOwnerAndName.mockResolvedValue(null);

    await expect(
      controller.sync('torvalds', 'linux', mockReq),
    ).rejects.toThrow(NotFoundException);
    expect(syncService.syncRepository).not.toHaveBeenCalled();
  });

  it('allows maintainer to sync tracked repository', async () => {
    const mockReq = {
      user: {
        id: 'u-2',
        roles: [UserRole.MAINTAINER],
      } as User,
    } as any;

    const mockRepo = { id: 'repo-1', owner: 'acme', name: 'widgets' } as Repository;
    syncService.findRepositoryByOwnerAndName.mockResolvedValue(mockRepo);
    syncService.syncRepository.mockResolvedValue(mockRepo);

    const result = await controller.sync('acme', 'widgets', mockReq);
    expect(result).toEqual(mockRepo);
    expect(syncService.findRepositoryByOwnerAndName).toHaveBeenCalledWith('acme', 'widgets');
    expect(syncService.syncRepository).toHaveBeenCalledWith('acme', 'widgets');
  });

  it('allows sponsor to sync tracked repository', async () => {
    const mockReq = {
      user: {
        id: 'u-3',
        roles: [UserRole.SPONSOR],
      } as User,
    } as any;

    const mockRepo = { id: 'repo-1', owner: 'acme', name: 'widgets' } as Repository;
    syncService.findRepositoryByOwnerAndName.mockResolvedValue(mockRepo);
    syncService.syncRepository.mockResolvedValue(mockRepo);

    const result = await controller.sync('acme', 'widgets', mockReq);
    expect(result).toEqual(mockRepo);
  });
});
