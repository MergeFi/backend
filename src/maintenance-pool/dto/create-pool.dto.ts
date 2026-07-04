import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AssetType } from '../../common/enums';

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

  @ApiProperty({ enum: AssetType, default: AssetType.USDC })
  @IsEnum(AssetType)
  asset: AssetType;
}
