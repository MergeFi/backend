import { ApiProperty } from '@nestjs/swagger';

/**
 * Metadata for paginated responses, allowing clients to know if
 * more pages exist and how to request them.
 */
export class PaginationMetadata {
  @ApiProperty({ description: 'Current page number (1-indexed)' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of items across all pages' })
  totalItems: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page' })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page' })
  hasPreviousPage: boolean;
}

/**
 * Standard paginated response wrapper for list endpoints.
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of items for the current page' })
  data: T[];

  @ApiProperty({ description: 'Pagination metadata', type: PaginationMetadata })
  meta: PaginationMetadata;

  constructor(
    data: T[],
    page: number,
    limit: number,
    totalItems: number,
  ) {
    this.data = data;
    const totalPages = Math.ceil(totalItems / limit);
    this.meta = {
      page,
      limit,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }
}
