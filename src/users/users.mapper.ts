import { User } from '../common/entities/user.entity';
import { PublicUserDto } from './dto/public-user.dto';

export const toPublicUser = (user: User): PublicUserDto => {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    roles: user.roles,
    stellarAddress: user.stellarAddress,
    createdAt: user.createdAt,
  };
};
