import { ApiProperty } from '@nestjs/swagger';
import {
  IsFutureDate,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AssetType } from '../../common/enums';
import {
  IsMoneyAmount,
  IsSupportedEscrowAsset,
} from '../../common/validators/money.validator';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';

export class FundEscrowDto {
  @ApiProperty({ description: 'Amount to lock in the escrow contract' })
  @IsMoneyAmount()
  amount: string;

  @ApiProperty({ enum: AssetType, default: AssetType.USDC })
  @IsSupportedEscrowAsset()
  asset: AssetType;

  @ApiProperty({ description: 'Stellar public key of the funding sponsor' })
  @IsStellarAddress()
  funderAddress: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  bountyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  milestoneId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  maintenancePoolId?: string;

  /**
   * Denormalized sponsor identity stored on the escrow row (#27). Without it a
   * directly-called endpoint produces an escrow with no sponsor attribution,
   * because `EscrowService.fund` can only copy what the caller sends.
   */
  @ApiProperty({
    required: false,
    description:
      'Sponsor id to attribute the escrow to (defaults to null for maintenance-pool escrows)',
  })
  @IsOptional()
  @IsUUID()
  sponsorId?: string;

  /**
   * The `u64` key `escrow::fund` stores this escrow under on-chain (#158).
   * For a bounty this is the linked GitHub issue's numeric id. When omitted,
   * internal milestone/pool funding derives a parent-type-namespaced key.
   * Restricted to digits so a direct caller cannot supply an arbitrary seed.
   */
  @ApiProperty({
    required: false,
    description:
      "The linked GitHub issue's numeric id — the u64 on-chain escrow key (defaults to a derived id when omitted)",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message: 'onChainIssueId must be the linked GitHub issue numeric id (digits only)',
  })
  @MaxLength(20)
  onChainIssueId?: string;

  /**
   * Deadline passed to `escrow::fund`, after which the contract's
   * permissionless refund path opens (#158). Defaults to the configured
   * `stellar.escrowDeadlineSeconds` window when omitted.
   */
  @ApiProperty({
    required: false,
    description:
      'Future ISO 8601 refund-deadline passed to escrow::fund (defaults to the configured window)',
  })
  @IsOptional()
  @IsISO8601()
  @IsFutureDate()
  deadline?: string;
}
