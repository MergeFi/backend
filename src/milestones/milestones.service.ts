import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Issue, Milestone } from '../common/entities';
import { MilestoneStatus } from '../common/enums';
import { EscrowService } from '../escrow/escrow.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';

@Injectable()
export class MilestonesService {
  constructor(
    @InjectRepository(Milestone)
    private readonly milestoneRepo: Repository<Milestone>,
    @InjectRepository(Issue) private readonly issueRepo: Repository<Issue>,
    private readonly escrowService: EscrowService,
  ) {}

  async create(dto: CreateMilestoneDto): Promise<Milestone> {
    const milestone = this.milestoneRepo.create({
      repositoryId: dto.repositoryId,
      sponsorId: dto.sponsorId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      budget: dto.budget,
      asset: dto.asset,
      deadline: dto.deadline ? new Date(dto.deadline) : null,
      status: MilestoneStatus.OPEN,
    });
    return this.milestoneRepo.save(milestone);
  }

  async findOne(id: string): Promise<Milestone> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id },
      relations: { issues: true },
    });
    if (!milestone) throw new NotFoundException(`Milestone ${id} not found`);
    return milestone;
  }

  /** Sponsor funds the full milestone budget up front; distributed incrementally per issue. */
  async fund(id: string, funderAddress: string): Promise<Milestone> {
    const milestone = await this.findOne(id);
    if (milestone.status !== MilestoneStatus.OPEN) {
      throw new BadRequestException(
        `Milestone ${id} is not OPEN (current: ${milestone.status})`,
      );
    }

    const escrow = await this.escrowService.fund({
      amount: milestone.budget,
      asset: milestone.asset,
      funderAddress,
      milestoneId: milestone.id,
    });

    milestone.escrow = escrow;
    milestone.escrowId = escrow.id;
    milestone.status = MilestoneStatus.FUNDED;
    return this.milestoneRepo.save(milestone);
  }

  /** Attaches an already-tracked issue to this milestone. */
  async addIssue(milestoneId: string, issueId: string): Promise<Issue> {
    const milestone = await this.findOne(milestoneId);
    const issue = await this.issueRepo.findOne({ where: { id: issueId } });
    if (!issue) throw new NotFoundException(`Issue ${issueId} not found`);
    issue.milestoneId = milestone.id;
    return this.issueRepo.save(issue);
  }

  /**
   * Distributes this milestone's budget proportionally as its issues resolve.
   * TODO: support per-issue weighted budgets; currently splits the remaining
   * budget evenly across still-unresolved issues at the time of each call.
   */
  async resolveIssue(
    milestoneId: string,
    issueId: string,
    recipientAddress: string,
    recipientId?: string,
  ) {
    const milestone = await this.findOne(milestoneId);
    if (!milestone.escrowId) {
      throw new BadRequestException(
        `Milestone ${milestoneId} has not been funded yet`,
      );
    }
    if (
      milestone.status !== MilestoneStatus.FUNDED &&
      milestone.status !== MilestoneStatus.IN_PROGRESS
    ) {
      throw new BadRequestException(
        `Milestone ${milestoneId} is not accepting distributions`,
      );
    }

    const openIssues = milestone.issues.filter((i) => i.state === 'open');
    const unresolvedCount = Math.max(openIssues.length, 1);
    const remainingBudget =
      Number(milestone.budget) - Number(milestone.distributed);
    const share = Math.min(remainingBudget / unresolvedCount, remainingBudget);

    const payment = await this.escrowService.releasePartial(
      milestone.escrowId,
      share.toFixed(7),
      recipientAddress,
      recipientId,
    );

    milestone.distributed = (Number(milestone.distributed) + share).toFixed(7);
    milestone.status =
      Number(milestone.distributed) >= Number(milestone.budget) - 1e-7
        ? MilestoneStatus.COMPLETED
        : MilestoneStatus.IN_PROGRESS;
    await this.milestoneRepo.save(milestone);

    await this.issueRepo.update(issueId, {
      state: 'closed',
      closedAt: new Date(),
    });

    return payment;
  }

  async list(): Promise<Milestone[]> {
    return this.milestoneRepo.find();
  }
}
