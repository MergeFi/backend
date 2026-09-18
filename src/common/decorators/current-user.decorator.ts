import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../enums';

export interface AuthenticatedUser {
  userId: string;
  username: string;
  roles: UserRole[];
}

/**
 * Extracts the authenticated caller from the request, as populated by
 * JwtAuthGuard/JwtStrategy. Throws if used without an auth guard so callers
 * don't silently read an undefined user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error('CurrentUser can only be used behind an auth guard');
    }
    return request.user;
  },
);
