import { Reflector } from '@nestjs/core';
import { UserRole } from '../../common/enums';
import { ROLES_KEY, Roles } from './roles.decorator';

/** The handler function Nest passes to the Reflector for `cls.prototype[name]`. */
const handlerOf = <T>(cls: new () => T, name: keyof T): object =>
  cls.prototype[name] as object;

/**
 * RolesGuard allows any request whose handler carries no ROLES_KEY metadata,
 * so a decorator that fails to attach it silently disables role checks on
 * every route using it (#838). These read the metadata back through the real
 * Reflector, exactly as the guard does.
 */
describe('@Roles (#838)', () => {
  const reflector = new Reflector();

  @Roles(UserRole.SPONSOR)
  class DecoratedController {
    @Roles(UserRole.MAINTAINER, UserRole.SPONSOR)
    decorated() {}

    inheritsClassRoles() {}
  }

  class PlainController {
    undecorated() {}
  }

  it('is keyed on the token RolesGuard reads', () => {
    expect(ROLES_KEY).toBe('roles');
  });

  it('attaches the given roles to a decorated handler', () => {
    expect(
      reflector.get<UserRole[]>(
        ROLES_KEY,
        handlerOf(DecoratedController, 'decorated'),
      ),
    ).toEqual([UserRole.MAINTAINER, UserRole.SPONSOR]);
  });

  it('leaves an undecorated handler without metadata', () => {
    expect(
      reflector.get(ROLES_KEY, handlerOf(PlainController, 'undecorated')),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [
        handlerOf(PlainController, 'undecorated'),
        PlainController,
      ]),
    ).toBeUndefined();
  });

  it('lets the handler override the class, as the guard resolves it', () => {
    expect(
      reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        handlerOf(DecoratedController, 'decorated'),
        DecoratedController,
      ]),
    ).toEqual([UserRole.MAINTAINER, UserRole.SPONSOR]);
  });

  it('falls back to class-level roles for an undecorated handler', () => {
    expect(
      reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        handlerOf(DecoratedController, 'inheritsClassRoles'),
        DecoratedController,
      ]),
    ).toEqual([UserRole.SPONSOR]);
  });
});
