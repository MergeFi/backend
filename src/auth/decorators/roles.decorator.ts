import { SetMetadata } from '@nestjs/common';

// This is the secret key NestJS will use to track route roles
export const ROLES_KEY = 'roles';

// This allows us to type @Roles('maintainer') above any function
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
