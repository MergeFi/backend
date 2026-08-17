import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class SetStellarAddressDto {
  @IsString()
  stellarAddress: string;
}

@ApiTags('users')
@Controller('users')
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
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id/stellar-address')
  setStellarAddress(
    @Param('id') id: string,
    @Body() dto: SetStellarAddressDto,
    @Req() req: { user: { userId: string } },
  ) {
    return this.usersService.setStellarAddress(
      id,
      dto.stellarAddress,
      req.user.userId,
    );
  }
}
