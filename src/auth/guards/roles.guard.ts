import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../../common/entities';
import { UserRole } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/** Requires at least one role declared by @Roles, using roles from the authenticated user when available. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.userId) {
      throw new UnauthorizedException('Authentication is required');
    }

    if (request.user.roles) {
      return requiredRoles.some((role) => request.user!.roles.includes(role));
    }

    const user = await this.userRepo.findOne({
      where: { id: request.user.userId },
      select: { id: true, roles: true },
    });
    if (!user)
      throw new UnauthorizedException('Authenticated user no longer exists');

    return requiredRoles.some((role) => user.roles.includes(role));
  }
}
