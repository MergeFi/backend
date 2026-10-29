import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user && user.userId !== id) {
      throw new ForbiddenException(
        'You may only update your own Stellar address',
      );
    }
    return this.usersService.setStellarAddress(id, dto.stellarAddress);
  }

  // #714: disconnect() was sending PATCH { stellarAddress: null } which the
  // @IsStellarAddress() validator on SetStellarAddressDto always rejects with
  // 400. A dedicated DELETE route accepts no body and sets the column to null,
  // keeping the PATCH route strictly typed for real addresses.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id/stellar-address')
  @HttpCode(HttpStatus.OK)
  clearStellarAddress(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user && user.userId !== id) {
      throw new ForbiddenException(
        'You may only update your own Stellar address',
      );
    }
    return this.usersService.clearStellarAddress(id);
  }
}
