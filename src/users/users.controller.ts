import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiInternalErrorResponse } from '../common/swagger/api-common-responses.decorator';

class SetStellarAddressDto {
  @ApiProperty()
  @IsString()
  stellarAddress: string;
}

@ApiTags('users')
@Controller('users')
@ApiInternalErrorResponse()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  list() {
    return this.usersService.list();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.findById(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id/stellar-address')
  setStellarAddress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetStellarAddressDto,
  ) {
    return this.usersService.setStellarAddress(id, dto.stellarAddress);
  }
}
