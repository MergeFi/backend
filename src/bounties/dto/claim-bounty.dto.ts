import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ClaimBountyDto {
  @ApiProperty()
  @IsUUID()
  contributorId: string;
}
