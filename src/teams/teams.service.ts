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

  async create(dto: CreateTeamDto): Promise<Team> {
    validateSplitPercentages(dto.members);

    // Verify all member userIds exist
    for (const member of dto.members) {
      const userExists = await this.userRepo.findOne({ where: { id: member.userId } });
      if (!userExists) {
        throw new NotFoundException(`User ${member.userId} not found`);
      }
    }

    const team = await this.teamRepo.save(
      this.teamRepo.create({
        name: dto.name,
        createdById: dto.createdById ?? null,
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

  async findOne(id: string): Promise<Team> {
    const team = await this.teamRepo.findOne({
      where: { id },
      relations: { splits: true },
    });
    if (!team) throw new NotFoundException(`Team ${id} not found`);
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
      const userExists = await this.userRepo.findOne({ where: { id: member.userId } });
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
    await this.findOne(teamId); // ensures team exists
    const bounty = await this.bountyRepo.findOne({ where: { id: bountyId } });
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
    if (
      !caller?.roles.includes(UserRole.MAINTAINER) &&
      bounty.sponsorId !== callerId
    ) {
      throw new ForbiddenException(
        'Only the bounty sponsor or a maintainer can assign a team',
      );
    }

    bounty.teamId = teamId;
    return this.bountyRepo.save(bounty);
  }
}
