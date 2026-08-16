import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: `Number of records to return (default: ${DEFAULT_PAGE_LIMIT}, max: ${MAX_PAGE_LIMIT})`,
    default: DEFAULT_PAGE_LIMIT,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({
    description: 'Number of records to skip (default: 0)',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  limit: number = DEFAULT_PAGE_LIMIT,
  offset: number = 0,
): PaginatedResponse<T> {
  return {
    data,
    total,
    limit,
    offset,
    hasMore: offset + data.length < total,
  };
}
