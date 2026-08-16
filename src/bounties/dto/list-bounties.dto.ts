import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { BountyStatus } from '../../common/enums';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ListBountiesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BountyStatus, description: 'Filter bounties by status' })
  @IsOptional()
  @IsEnum(BountyStatus)
  status?: BountyStatus;
}
