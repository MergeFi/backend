import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AuthenticatedUser, CurrentUser } from './current-user.decorator';

type ParamFactory = (data: unknown, ctx: ExecutionContext) => unknown;

/**
 * Pulls the factory Nest registers for a param decorator, so it can be
 * invoked exactly as the router would invoke it per request.
 */
function getParamFactory(data?: unknown): ParamFactory {
  class Probe {
    handler(@CurrentUser(data) user: AuthenticatedUser): AuthenticatedUser {
      return user;
    }
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<string, { factory: ParamFactory; data: unknown }>;
  const entry = Object.values(args)[0];
  return (d, ctx) => entry.factory(d ?? entry.data, ctx);
}

function contextWithRequest(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser', () => {
  // Exactly what JwtStrategy.validate returns and Passport assigns to req.user.
  const user: AuthenticatedUser = { userId: 'user-1', username: 'alice' };

  it('returns req.user in the { userId, username } shape JwtStrategy.validate produces', () => {
    const factory = getParamFactory();

    const result = factory(undefined, contextWithRequest({ user }));

    expect(result).toBe(user);
    expect(result).toEqual({ userId: 'user-1', username: 'alice' });
  });

  it('ignores a data argument and still returns the whole user (no sub-property selector)', () => {
    // Handlers rely on reading `.userId` off the returned object; passing
    // a selector must not silently turn it into a bare string.
    const factory = getParamFactory('userId');

    expect(factory(undefined, contextWithRequest({ user }))).toEqual(user);
  });

  it.each([
    ['req.user is absent', {}],
    ['req.user is undefined', { user: undefined }],
    ['req.user is null', { user: null }],
  ])(
    'throws instead of returning undefined when %s (route without JwtAuthGuard)',
    (_label, request) => {
      const factory = getParamFactory();

      // Returning undefined would turn every `user.userId === ownerId`
      // check downstream into silent denial or a null owner (#821).
      expect(() => factory(undefined, contextWithRequest(request))).toThrow(
        'CurrentUser can only be used behind an auth guard',
      );
    },
  );
});
