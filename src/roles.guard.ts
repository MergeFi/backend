import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Check if the function or controller has a @Roles() tag attached to it
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required on this function, let the user pass through freely
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 2. Grab the request context and get the user object (populated by your JWT logging system)
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Safety fallback: if no user is found, they are completely unauthorized
    if (!user) {
      throw new ForbiddenException('Authentication session not found.');
    }

    // 3. Compare the user's role against the required roles for this function
    // This safely works whether your database has a single string user.role or an array user.roles
    const hasRole = Array.isArray(user.roles)
      ? requiredRoles.some((role) => user.roles.includes(role))
      : requiredRoles.includes(user.role);

    // If they do not have the right role, throw a strict security error
    if (!hasRole) {
      throw new ForbiddenException('Access denied: Insufficient permissions for this role.');
    }

    return true;
  }
}
