import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiQuery } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { User } from '../common/entities';

class SetStellarAddressDto {
  @IsString()
  stellarAddress: string;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query() paginationQuery?: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<User>> {
    const page = paginationQuery?.page || 1;
    const limit = paginationQuery?.limit || 50;
    const { data, total } = await this.usersService.list(page, limit);
    return new PaginatedResponseDto(data, page, limit, total);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id/stellar-address')
  setStellarAddress(
    @Param('id') id: string,
    @Body() dto: SetStellarAddressDto,
  ) {
    return this.usersService.setStellarAddress(id, dto.stellarAddress);
  }
}
