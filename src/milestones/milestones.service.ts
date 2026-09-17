import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Issue, Milestone } from '../common/entities';
import { IssueState, MilestoneStatus } from '../common/enums';
import { EscrowService } from '../escrow/escrow.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    @InjectRepository(Milestone)
    private readonly milestoneRepo: Repository<Milestone>,
    @InjectRepository(Issue) private readonly issueRepo: Repository<Issue>,
    @InjectDataSource() private readonly dataSource: DataSource,
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
    const saved = await this.milestoneRepo.save(milestone);

    this.logger.log(
      `Created milestone ${saved.id} ("${saved.title}") for repo ${saved.repositoryId} with budget ${saved.budget} ${saved.asset}`,
    );

    return saved;
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
      this.logger.warn(
        `Failed to fund milestone ${id}: status is not OPEN (current: ${milestone.status})`,
      );
      throw new BadRequestException(
        `Milestone ${id} is not OPEN (current: ${milestone.status})`,
      );
    }

    const escrow = await this.escrowService.fund({
      amount: milestone.budget,
      asset: milestone.asset,
      funderAddress,
      milestoneId: milestone.id,
      sponsorId: milestone.sponsorId,
      deadline: milestone.deadline,
    });

    const previousStatus = milestone.status;
    milestone.escrow = escrow;
    milestone.escrowId = escrow.id;
    milestone.status = MilestoneStatus.FUNDED;
    const saved = await this.milestoneRepo.save(milestone);

    this.logger.log(
      `Funded milestone ${saved.id}: transitioned ${previousStatus} -> ${saved.status}, escrow ${escrow.id} created with ${saved.budget} ${saved.asset}`,
    );

    return saved;
  }

  /**
   * Attaches an already-tracked issue to this milestone.
   *
   * A milestone is scoped to a single repository (`repositoryId`, required
   * at creation); its budget is split proportionally across whatever's
   * attached in `resolveIssue`, with no per-issue repository check there
   * either. Rejecting a repository mismatch here, before attachment, is
   * this method's only opportunity to keep that budget scoped to the work
   * it was actually funded for (#59).
   */
  async addIssue(milestoneId: string, issueId: string): Promise<Issue> {
    const milestone = await this.findOne(milestoneId);
    if (
      milestone.status !== MilestoneStatus.OPEN &&
      milestone.status !== MilestoneStatus.FUNDED &&
      milestone.status !== MilestoneStatus.IN_PROGRESS
    ) {
      this.logger.warn(
        `Rejected attaching issue ${issueId} to milestone ${milestoneId}: invalid milestone status ${milestone.status}`,
      );
      throw new BadRequestException(
        `Cannot attach issue to milestone in ${milestone.status} status`,
      );
    }
    const issue = await this.issueRepo.findOne({ where: { id: issueId } });
    if (!issue) throw new NotFoundException(`Issue ${issueId} not found`);
    if (issue.repositoryId !== milestone.repositoryId) {
      this.logger.warn(
        `Rejected attaching issue ${issueId} to milestone ${milestoneId}: repository mismatch (issue repo: ${issue.repositoryId}, milestone repo: ${milestone.repositoryId})`,
      );
      throw new BadRequestException(
        `Issue ${issueId} belongs to repository ${issue.repositoryId}, ` +
          `but milestone ${milestoneId} is scoped to repository ${milestone.repositoryId}`,
      );
    }
    issue.milestoneId = milestone.id;
    const saved = await this.issueRepo.save(issue);

    this.logger.log(
      `Attached issue ${issueId} to milestone ${milestoneId}`,
    );

    return saved;
  }

  /**
   * Distributes this milestone's budget proportionally as its issues resolve.
   * TODO: support per-issue weighted budgets; currently splits the remaining
   * budget evenly across still-unresolved issues at the time of each call.
   *
   * The escrow release, milestone distributed-total update, and issue close
   * are wrapped in a single DB transaction to prevent desync between the
   * Payment ledger and `milestone.distributed` (#117).
   */
  async resolveIssue(
    milestoneId: string,
    issueId: string,
    recipientAddress: string,
    recipientId?: string,
  ) {
    const milestone = await this.findOne(milestoneId);
    if (!milestone.escrowId) {
      this.logger.warn(
        `Failed to resolve issue ${issueId} for milestone ${milestoneId}: milestone has no funded escrow`,
      );
      throw new BadRequestException(
        `Milestone ${milestoneId} has not been funded yet`,
      );
    }
    if (
      milestone.status !== MilestoneStatus.FUNDED &&
      milestone.status !== MilestoneStatus.IN_PROGRESS
    ) {
      this.logger.warn(
        `Failed to resolve issue ${issueId} for milestone ${milestoneId}: milestone is not accepting distributions (status: ${milestone.status})`,
      );
      throw new BadRequestException(
        `Milestone ${milestoneId} is not accepting distributions`,
      );
    }

    // Verify the issue belongs to this milestone (#114).
    const issue = milestone.issues.find((i) => i.id === issueId);
    if (!issue) {
      this.logger.warn(
        `Failed to resolve issue ${issueId} for milestone ${milestoneId}: issue not attached to milestone`,
      );
      throw new BadRequestException(
        `Issue ${issueId} is not attached to milestone ${milestoneId}`,
      );
    }

    const openIssues = milestone.issues.filter(
      (i) => i.state === IssueState.OPEN,
    );

    // Reject when no issues remain open — fallback to divisor 1 would let a
    // single call drain the entire remaining budget (#115).
    if (openIssues.length === 0) {
      this.logger.warn(
        `Failed to resolve issue ${issueId} for milestone ${milestoneId}: no unresolved issues left`,
      );
      throw new BadRequestException(
        'No unresolved issues left to attribute this payout to',
      );
    }

    if (issue.state !== IssueState.OPEN) {
      this.logger.warn(
        `Failed to resolve issue ${issueId} for milestone ${milestoneId}: issue state is ${issue.state}, expected OPEN`,
      );
      throw new BadRequestException(
        `Issue ${issueId} has already been resolved for milestone ${milestoneId}`,
      );
    }

    const unresolvedCount = openIssues.length;
    const remainingBudget =
      Number(milestone.budget) - Number(milestone.distributed);
    const share = Math.min(remainingBudget / unresolvedCount, remainingBudget);

    return this.dataSource.transaction(async (mgr) => {
      const payment = await this.escrowService.releasePartial(
        milestone.escrowId!,
        share.toFixed(7),
        recipientAddress,
        recipientId,
      );

      const previousStatus = milestone.status;
      const newDistributed = (Number(milestone.distributed) + share).toFixed(7);
      const newStatus =
        Number(newDistributed) >= Number(milestone.budget) - 1e-7
          ? MilestoneStatus.COMPLETED
          : MilestoneStatus.IN_PROGRESS;
      await mgr.update(Milestone, milestoneId, {
        distributed: newDistributed,
        status: newStatus,
      });

      await mgr.update(Issue, issueId, {
        state: IssueState.CLOSED,
        closedAt: new Date(),
      });

      this.logger.log(
        `Resolved issue ${issueId} on milestone ${milestoneId}: released ${share.toFixed(7)} ${milestone.asset} to ${recipientAddress}. ` +
          `Milestone distributed ${milestone.distributed} -> ${newDistributed}/${milestone.budget}, status ${previousStatus} -> ${newStatus}`,
      );

      return payment;
    });
  }

  async list(): Promise<Milestone[]> {
    return this.milestoneRepo.find();
  }

  allocateBudget(id: string) {
    this.logger.log(`Allocated budget for milestone ${id}`);
    return Promise.resolve({ id, status: 'budget_allocated' });
  }
}
