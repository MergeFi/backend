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
import type { Request } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { toPublicUser, PublicUser } from './user-response.mapper';
import { UserRole } from '../common/enums';

class SetStellarAddressDto {
  @IsString()
  stellarAddress: string;
}

interface AuthenticatedUserPayload {
  userId: string;
  username: string;
  roles?: UserRole[];
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@Req() req: Request): Promise<PublicUser[]> {
    const userPayload = req.user as AuthenticatedUserPayload | undefined;
    const users = await this.usersService.list();
    return users.map((user) =>
      toPublicUser(user, { currentUser: userPayload }),
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<PublicUser> {
    const userPayload = req.user as AuthenticatedUserPayload | undefined;
    const user = await this.usersService.findById(id);
    return toPublicUser(user, { currentUser: userPayload });
  }

  @Patch(':id/stellar-address')
  async setStellarAddress(
    @Param('id') id: string,
    @Body() dto: SetStellarAddressDto,
    @Req() req: Request,
  ): Promise<PublicUser> {
    const userPayload = req.user as AuthenticatedUserPayload | undefined;
    const user = await this.usersService.setStellarAddress(
      id,
      dto.stellarAddress,
    );
    return toPublicUser(user, { currentUser: userPayload });
  }
}
