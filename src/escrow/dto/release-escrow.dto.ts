import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';

export class ReleaseEscrowDto {
  @ApiProperty({ description: 'Stellar public key of the recipient' })
  @IsStellarAddress()
  recipientAddress: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}
