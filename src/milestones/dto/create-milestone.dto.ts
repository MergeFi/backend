import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AssetType } from '../../common/enums';

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
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsNumberString()
  budget: string;

  @ApiProperty({ enum: AssetType, default: AssetType.USDC })
  @IsEnum(AssetType)
  asset: AssetType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  deadline?: string;
}
