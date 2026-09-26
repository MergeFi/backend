import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AssetType } from '../../common/enums';
import { IsFutureDate } from '../../common/validators/date.validator';
import {
  IsMoneyAmount,
  IsSupportedEscrowAsset,
} from '../../common/validators/money.validator';

export class CreateMilestoneDto {
  @ApiProperty()
  @IsUUID()
  repositoryId: string;

  @ApiProperty()
  @IsUUID()
  sponsorId: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ required: false, maxLength: 2000 })
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
  @IsFutureDate()
  deadline?: string;
}
