import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/enums';

export class PublicUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles: UserRole[];

  @ApiProperty({ nullable: true })
  stellarAddress: string | null;

  @ApiProperty()
  createdAt: Date;
}
