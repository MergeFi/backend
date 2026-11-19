import { ApiProperty } from '@nestjs/swagger';

export class ClaimBountyDto {
  // No body needed - contributorId is derived from the authenticated user
  @ApiProperty({ description: 'No body required - contributorId is derived from JWT' })
  _placeholder?: string;
}
