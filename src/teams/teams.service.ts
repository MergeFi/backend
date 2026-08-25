import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from '../common/entities/team.entity';
import { User } from '../common/entities/user.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { Bounty } from '../common/entities/bounty.entity';
import { TeamMemberSplit } from '../common/entities/team-member-split.entity';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    @InjectRepository(Bounty)
    private readonly bountyRepo: Repository<Bounty>,
    @InjectRepository(TeamMemberSplit)
    private readonly teamMemberSplitRepo: Repository<TeamMemberSplit>,
  ) {}

  async create(createTeamDto: CreateTeamDto, user: User): Promise<Team> {
    const team = this.teamRepo.create({
      ...createTeamDto,
      ownerId: user.userId,
    });
    return this.teamRepo.save(team);
  }

  async findOne(id: string): Promise<Team> {
    const team = await this.teamRepo.findOne({ where: { id }, relations: ['members'] });
    if (!team) {
      throw new NotFoundException(`Team ${id} not found`);
    }
    return team;
  }

  async assignToBounty(id: string, bountyId: string, user: User): Promise<Team> {
    const team = await this.findOne(id);
    const bounty = await this.bountyRepo.findOne({ where: { id: bountyId } });

    if (!bounty) {
      throw new NotFoundException(`Bounty ${bountyId} not found`);
    }

    // Authorization: only the team owner can assign the team to a bounty
    if (team.ownerId !== user.userId) {
      throw new ForbiddenException('Only the team owner can assign this team to a bounty');
    }

    // Authorization: only the bounty sponsor can accept a team assignment
    // (or the team owner if they're also the sponsor)
    if (bounty.sponsorId !== user.userId && team.ownerId !== bounty.sponsorId) {
      throw new ForbiddenException('Only the bounty sponsor can accept team assignments');
    }

    if (bounty.teamId) {
      throw new BadRequestException('Bounty already has a team assigned');
    }

    bounty.teamId = team.id;
    await this.bountyRepo.save(bounty);

    return team;
  }
}
