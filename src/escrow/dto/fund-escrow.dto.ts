import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
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

  /**
   * Not permissionless: this endpoint requires a JWT, and the controller
   * asserts this equals the caller's own linked `stellarAddress` before
   * anything is locked. Funding is a debit of the named wallet, so naming
   * someone else's is never a legitimate request (#40).
   */
  @ApiProperty({
    description:
      "Stellar public key of the funding sponsor. Must equal the caller's own linked Stellar address.",
  })
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
}
