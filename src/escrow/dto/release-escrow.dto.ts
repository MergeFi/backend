import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ReleaseEscrowDto {
  @ApiProperty({ description: 'Stellar public key of the recipient' })
  @IsString()
  recipientAddress: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}
