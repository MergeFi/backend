import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsUUID,
  IsISO8601,
} from 'class-validator';
import { AssetType, BountyDifficulty } from '../../common/enums';

export class CreateBountyDto {
  @ApiProperty({
    description: 'ID of the tracked Issue this bounty pays out for',
  })
  @IsUUID()
  issueId: string;

  @ApiProperty()
  @IsUUID()
  sponsorId: string;

  @ApiProperty()
  @IsNumberString()
  amount: string;

  @ApiProperty({ enum: AssetType, default: AssetType.USDC })
  @IsEnum(AssetType)
  asset: AssetType;

  @ApiProperty({
    enum: BountyDifficulty,
    default: BountyDifficulty.INTERMEDIATE,
  })
  @IsEnum(BountyDifficulty)
  difficulty: BountyDifficulty;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  deadline?: string;
}
