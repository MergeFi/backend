import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AssetType } from '../../common/enums';
import {
  IsMoneyAmount,
  IsSupportedEscrowAsset,
} from '../../common/validators/money.validator';

export class CreateMilestoneDto {
  @ApiProperty()
  @IsUUID()
  repositoryId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  sponsorId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty()
  @IsMoneyAmount()
  budget: string;

  @ApiProperty({ enum: AssetType, default: AssetType.USDC })
  @IsSupportedEscrowAsset()
  asset: AssetType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  deadline?: string;
}
