import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { AssetType } from '../../common/enums';
import {
  IsMoneyAmount,
  IsSupportedEscrowAsset,
} from '../../common/validators/money.validator';

export class CreatePoolDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  repositoryId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  createdById?: string;

  /** The sponsor's standing recurring commitment; deposits never overwrite it (#93). */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsMoneyAmount()
  monthlyDeposit?: string;

  @ApiProperty({ enum: AssetType, default: AssetType.USDC })
  @IsSupportedEscrowAsset()
  asset: AssetType;
}
