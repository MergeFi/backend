import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bounty, Team, TeamMemberSplit } from '../common/entities';
import { CreateTeamDto } from './dto/create-team.dto';
import { validateSplitPercentages } from './team-split.util';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
    @InjectRepository(TeamMemberSplit)
    private readonly splitRepo: Repository<TeamMemberSplit>,
    @InjectRepository(Bounty) private readonly bountyRepo: Repository<Bounty>,
  ) {}

  async create(dto: CreateTeamDto): Promise<Team> {
    validateSplitPercentages(dto.members);

    const team = await this.teamRepo.save(
      this.teamRepo.create({
        name: dto.name,
        createdById: dto.createdById ?? null,
      }),
    );

    team.splits = await Promise.all(
      dto.members.map((m) =>
        this.splitRepo.save(
          this.splitRepo.create({
            teamId: team.id,
            userId: m.userId,
            role: m.role ?? null,
            percentage: m.percentage.toFixed(2),
          }),
        ),
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

  /** Attaches an existing team to a bounty so its payout is split on merge. */
  async assignToBounty(teamId: string, bountyId: string): Promise<Bounty> {
    await this.findOne(teamId); // ensures team exists
    const bounty = await this.bountyRepo.findOne({ where: { id: bountyId } });
    if (!bounty) throw new NotFoundException(`Bounty ${bountyId} not found`);
    bounty.teamId = teamId;
    return this.bountyRepo.save(bounty);
  }
}
