import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AssetType } from '../../common/enums';

export class FundEscrowDto {
  @ApiProperty({ description: 'Amount to lock in the escrow contract' })
  @IsNumberString()
  amount: string;

  @ApiProperty({ enum: AssetType, default: AssetType.USDC })
  @IsEnum(AssetType)
  asset: AssetType;

  @ApiProperty({ description: 'Stellar public key of the funding sponsor' })
  @IsString()
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
