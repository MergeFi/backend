import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AssetType, BountyDifficulty, BountyStatus } from '../../common/enums';

export class ListBountiesQueryDto {
  @ApiPropertyOptional({ enum: BountyStatus, description: 'Filter by bounty status' })
  @IsOptional()
  @IsEnum(BountyStatus)
  status?: BountyStatus;

  @ApiPropertyOptional({ enum: BountyDifficulty, description: 'Filter by bounty difficulty' })
  @IsOptional()
  @IsEnum(BountyDifficulty)
  difficulty?: BountyDifficulty;

  @ApiPropertyOptional({ enum: AssetType, description: 'Filter by asset type' })
  @IsOptional()
  @IsEnum(AssetType)
  asset?: AssetType;

  @ApiPropertyOptional({ description: 'Filter by primary programming language of repository' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({ description: 'Filter by repository ID' })
  @IsOptional()
  @IsUUID()
  repositoryId?: string;
}
