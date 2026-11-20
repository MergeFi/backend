import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bounty, Team, TeamMemberSplit, User } from '../common/entities';
import { IdempotencyKey } from '../common/entities/idempotency-key.entity';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // RolesGuard (used via @UseGuards on TeamsController) needs its own
    // Repository<User> resolvable in this module's DI scope — importing
    // AuthModule alone isn't enough, since exporting a class from another
    // module doesn't re-export that class's own constructor dependencies.
    // IdempotencyKey is there for @Idempotent()'s IdempotencyInterceptor on
    // the same grounds (see BountiesModule).
    TypeOrmModule.forFeature([
      Team,
      TeamMemberSplit,
      Bounty,
      User,
      IdempotencyKey,
    ]),
    AuthModule,
  ],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
