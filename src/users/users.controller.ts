import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IsString } from 'class-validator';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export interface AuthenticatedUser {
  userId: string;
  username: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

class SetStellarAddressDto {
  @IsString()
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
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.user?.userId !== id) {
      throw new ForbiddenException(
        'You are not authorized to update another user stellar address',
      );
    }
    return this.usersService.setStellarAddress(id, dto.stellarAddress);
  }
}
