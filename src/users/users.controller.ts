import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { ApiInternalErrorResponse } from '../common/swagger/api-common-responses.decorator';

// Checksum-validated (StrKey), like every other Stellar-address-accepting DTO.
// This value later becomes the on-chain recipient of escrow releases, so a
// malformed address must be rejected here rather than at the Soroban call (#292).
export class SetStellarAddressDto {
  @ApiProperty({ description: 'Stellar public address of the user' })
  @IsStellarAddress()
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

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id/stellar-address')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearStellarAddress(@Param('id', new ParseUUIDPipe()) id: string) {
    // The wallet-disconnect path: PATCH with { stellarAddress: null } was
    // rejected by the address-validator every time, so the backend kept the
    // old address and the wallet "reconnected" on the next sync (#714).
    await this.usersService.setStellarAddress(id, null);
  }
}
