import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';

class SetStellarAddressDto {
  @IsStellarAddress()
  stellarAddress: string;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list() {
    return this.usersService.list();
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
