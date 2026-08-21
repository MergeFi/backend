import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';

export class ReleaseEscrowDto {
  @ApiProperty({ description: 'Stellar public key of the recipient' })
  @IsStellarAddress()
  recipientAddress: string;

  /**
   * Who the resulting `Payment` row is attributed to. When present, the pair is
   * cross-checked server-side in `EscrowService` —
   * `recipientAddress` must equal this user's linked `stellarAddress`, so the
   * ledger cannot name one party while the chain pays another (#40).
   */
  @ApiProperty({
    required: false,
    description:
      'Attributed recipient. Must match the linked Stellar address of this user; a mismatched pair is rejected.',
  })
  @IsOptional()
  @IsUUID()
  recipientId?: string;
}
