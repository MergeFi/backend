import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// Fixed Path: Explicitly looks inside the auth decorators folder
import { ROLES_KEY } from './auth/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication session not found.');
    }

    const hasRole = Array.isArray(user.roles)
      ? requiredRoles.some((role) => user.roles.includes(role))
      : requiredRoles.includes(user.role);

    if (!hasRole) {
      throw new ForbiddenException('Access denied: Insufficient permissions for this role.');
    }

    return true;
  }
}
