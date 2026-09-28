import { Test, TestingModule } from '@nestjs/testing';
import { DefaultValuePipe, ParseIntPipe, ArgumentMetadata } from '@nestjs/common';
import { GithubController } from './github.controller';
import { GithubSyncService } from './github-sync.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

describe('GithubController', () => {
  let controller: GithubController;
  let syncService: { syncRepository: jest.Mock };

  beforeEach(async () => {
    syncService = {
      syncRepository: jest
        .fn()
        .mockResolvedValue({ repository: { id: 'r1' }, synced: 3 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GithubController],
      providers: [{ provide: GithubSyncService, useValue: syncService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GithubController);
  });

  describe('sync', () => {
    it('delegates to the sync service with owner, repo and page', async () => {
      await controller.sync('acme', 'widgets', 1);

      expect(syncService.syncRepository).toHaveBeenCalledWith(
        'acme',
        'widgets',
        1,
      );
    });

    it('returns the sync service result unchanged', async () => {
      await expect(controller.sync('acme', 'widgets', 2)).resolves.toEqual({
        repository: { id: 'r1' },
        synced: 3,
      });
      expect(syncService.syncRepository).toHaveBeenCalledWith(
        'acme',
        'widgets',
        2,
      );
    });
  });

  describe('guard and role wiring (#62, #313)', () => {
    it('is guarded by JwtAuthGuard and RolesGuard', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        GithubController.prototype.sync,
      );

      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    });

    it('restricts the route to the MAINTAINER role', () => {
      const roles = Reflect.getMetadata(
        ROLES_KEY,
        GithubController.prototype.sync,
      );

      expect(roles).toEqual([UserRole.MAINTAINER]);
    });
  });

  describe('page query pipe behavior (#313)', () => {
    const pageMetadata: ArgumentMetadata = {
      type: 'query',
      metatype: Number,
      data: 'page',
    };

    /** The exact pipe stack the @Query('page', ...) parameter runs. */
    const parsePage = async (value: string | undefined) => {
      const defaultPipe = new DefaultValuePipe(1);
      const intPipe = new ParseIntPipe();
      const withDefault = await defaultPipe.transform(value, pageMetadata);
      return intPipe.transform(withDefault, pageMetadata);
    };

    it('defaults to page 1 when the query param is absent', async () => {
      await expect(parsePage(undefined)).resolves.toBe(1);
    });

    it('parses a valid page number', async () => {
      await expect(parsePage('3')).resolves.toBe(3);
    });

    it('rejects a non-numeric page value', async () => {
      await expect(parsePage('abc')).rejects.toBeInstanceOf(Error);
    });

    // ParseIntPipe only rejects values that parse to NaN, so page=0 is
    // accepted and forwarded to the sync service. Documented here so the
    // behavior is pinned rather than assumed; a stricter bound (page >= 1)
    // would need an explicit pipe rather than the default ParseIntPipe.
    it('accepts page=0, passing it straight through to the sync service', async () => {
      await expect(parsePage('0')).resolves.toBe(0);

      await controller.sync('acme', 'widgets', 0);
      expect(syncService.syncRepository).toHaveBeenCalledWith(
        'acme',
        'widgets',
        0,
      );
    });
  });
});
