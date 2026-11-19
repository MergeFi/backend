import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Team, TeamMemberSplit, User } from '../common/entities';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // RolesGuard (used via @UseGuards on TeamsController) needs its own
    // Repository<User> resolvable in this module's DI scope — importing
    // AuthModule alone isn't enough, since exporting a class from another
    // module doesn't re-export that class's own constructor dependencies.
    TypeOrmModule.forFeature([Team, TeamMemberSplit, Bounty, User]),
    AuthModule,
  ],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
