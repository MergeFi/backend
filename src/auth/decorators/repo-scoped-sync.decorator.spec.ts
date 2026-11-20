import { Reflector } from '@nestjs/core';
import {
  REPO_SCOPED_SYNC_KEY,
  RepoScopedSync,
} from './repo-scoped-sync.decorator';

/** The handler function Nest passes to the Reflector for `cls.prototype[name]`. */
const handlerOf = <T>(cls: new () => T, name: keyof T): object =>
  cls.prototype[name] as object;

/**
 * RepoScopeGuard returns true whenever REPO_SCOPED_SYNC_KEY is absent, so a
 * decorator that fails to attach it silently disables per-repository scoping
 * (#838). These read the metadata back through the real Reflector, exactly as
 * the guard does.
 */
describe('@RepoScopedSync (#838)', () => {
  const reflector = new Reflector();

  class SyncController {
    @RepoScopedSync()
    scoped() {}

    unscoped() {}
  }

  @RepoScopedSync()
  class ScopedController {
    inheritsScope() {}
  }

  it('is keyed on the token RepoScopeGuard reads', () => {
    expect(REPO_SCOPED_SYNC_KEY).toBe('repo_scoped_sync');
  });

  it('marks a decorated handler as repo-scoped', () => {
    expect(
      reflector.get(REPO_SCOPED_SYNC_KEY, handlerOf(SyncController, 'scoped')),
    ).toBe(true);
    expect(
      reflector.getAllAndOverride(REPO_SCOPED_SYNC_KEY, [
        handlerOf(SyncController, 'scoped'),
        SyncController,
      ]),
    ).toBe(true);
  });

  it('leaves an undecorated handler without metadata', () => {
    expect(
      reflector.get(
        REPO_SCOPED_SYNC_KEY,
        handlerOf(SyncController, 'unscoped'),
      ),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(REPO_SCOPED_SYNC_KEY, [
        handlerOf(SyncController, 'unscoped'),
        SyncController,
      ]),
    ).toBeUndefined();
  });

  it('applies class-level scoping to every handler', () => {
    expect(
      reflector.getAllAndOverride(REPO_SCOPED_SYNC_KEY, [
        handlerOf(ScopedController, 'inheritsScope'),
        ScopedController,
      ]),
    ).toBe(true);
  });
});
