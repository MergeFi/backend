import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Team, TeamMemberSplit, User } from '../common/entities';
import { BountyStatus, UserRole } from '../common/enums';
import { CreateTeamDto, TeamMemberSplitDto } from './dto/create-team.dto';
import { validateSplitPercentages } from './team-split.util';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
    @InjectRepository(TeamMemberSplit)
    private readonly splitRepo: Repository<TeamMemberSplit>,
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateTeamDto, callerUserId: string): Promise<Team> {
    validateSplitPercentages(dto.members);

    // Verify all member userIds exist
    for (const member of dto.members) {
      const userExists = await this.userRepo.findOne({
        where: { id: member.userId },
      });
      if (!userExists) {
        throw new NotFoundException(`User ${member.userId} not found`);
      }
    }

    const team = await this.teamRepo.save(
      this.teamRepo.create({
        name: dto.name?.trim() ?? dto.name,
        createdById: callerUserId,
      }),
    );

    // One batched save (inside TypeORM's implicit transaction) rather than
    // N independently-committing INSERTs — a mid-way failure now rolls back
    // to zero splits instead of leaving a partial, invalid set (#150).
    team.splits = await this.splitRepo.save(
      dto.members.map((m) =>
        this.splitRepo.create({
          teamId: team.id,
          userId: m.userId,
          role: m.role ?? null,
          percentage: m.percentage.toFixed(2),
        }),
      ),
    );

    return team;
  }

  async findOne(id: string, callerId?: string): Promise<Team> {
    const team = await this.teamRepo.findOne({
      where: { id },
      relations: { splits: true },
    });
    if (!team) throw new NotFoundException(`Team ${id} not found`);

    if (callerId !== undefined) {
      const isOwner = team.createdById === callerId;
      const isMember = (team.splits ?? []).some(
        (split) => split.userId === callerId,
      );
      if (!isOwner && !isMember) {
        const caller = await this.userRepo.findOne({
          where: { id: callerId },
          select: { roles: true },
        });
        const isMaintainer = !!caller?.roles?.includes(UserRole.MAINTAINER);
        if (!isMaintainer) {
          throw new ForbiddenException(
            'Only the team creator, a team member, or a maintainer can view this team',
          );
        }
      }
    }

    return team;
  }

  /** Replaces all member splits for a team after validating they sum to 100. */
  async updateSplits(
    teamId: string,
    members: TeamMemberSplitDto[],
  ): Promise<Team> {
    const team = await this.findOne(teamId);
    validateSplitPercentages(members);

    // Verify all member userIds exist
    for (const member of members) {
      const userExists = await this.userRepo.findOne({
        where: { id: member.userId },
      });
      if (!userExists) {
        throw new NotFoundException(`User ${member.userId} not found`);
      }
    }

    // Remove existing splits
    await this.splitRepo.delete({ teamId: team.id });

    // Create new splits — one batched save, same rationale as create() (#150).
    team.splits = await this.splitRepo.save(
      members.map((m) =>
        this.splitRepo.create({
          teamId: team.id,
          userId: m.userId,
          role: m.role ?? null,
          percentage: m.percentage.toFixed(2),
        }),
      ),
    );

    return team;
  }

  /** Attaches an existing team to a bounty so its payout is split on merge. */
  async assignToBounty(
    teamId: string,
    bountyId: string,
    callerId: string,
  ): Promise<Bounty> {
    const team = await this.findOne(teamId);
    if (team.splits.length === 0) {
      throw new BadRequestException(
        `Team ${teamId} must have at least one member split`,
      );
    }
    const bounty = await this.bountyRepo.findOne({
      where: { id: bountyId },
      relations: { issue: { repository: true } },
    });
    if (!bounty) throw new NotFoundException(`Bounty ${bountyId} not found`);

    const assignableStatuses: BountyStatus[] = [
      BountyStatus.OPEN,
      BountyStatus.FUNDED,
      BountyStatus.CLAIMED,
    ];
    if (!assignableStatuses.includes(bounty.status)) {
      throw new BadRequestException(
        `Bounty ${bountyId} cannot be assigned in "${bounty.status}" status`,
      );
    }

    const caller = await this.userRepo.findOne({
      where: { id: callerId },
      select: { roles: true },
    });
    // A maintainer may only attach teams to bounties on repositories they
    // maintain (#778). The sponsor may attach a team to their own bounty.
    const isRepoMaintainer =
      !!caller?.roles.includes(UserRole.MAINTAINER) &&
      !!bounty.issue?.repository?.maintainerId &&
      bounty.issue.repository.maintainerId === callerId;
    if (!isRepoMaintainer && bounty.sponsorId !== callerId) {
      throw new ForbiddenException(
        'Only the bounty sponsor or the repository maintainer can assign a team',
      );
    }

    // Once a contributor has claimed the bounty, the team must include them,
    // so reassigning the payout cannot move it away from the claimant (#778).
    if (
      bounty.claimedById &&
      !team.splits.some((split) => split.userId === bounty.claimedById)
    ) {
      throw new BadRequestException(
        'The claimant of this bounty must be a member of the team',
      );
    }

    bounty.teamId = teamId;
    return this.bountyRepo.save(bounty);
  }
}
