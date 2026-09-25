import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { Bounty, Team, TeamMemberSplit, User } from '../common/entities';
import { BountyStatus, UserRole } from '../common/enums';

describe('TeamsService', () => {
  let service: TeamsService;
  let teamRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let splitRepo: { save: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let bountyRepo: { findOne: jest.Mock; save: jest.Mock };
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    teamRepo = {
      create: jest.fn((t: Partial<Team>) => t),
      save: jest.fn((t: Partial<Team>) =>
        Promise.resolve({ id: 't1', splits: [], ...t }),
      ),
      findOne: jest.fn(),
    };
    splitRepo = {
      create: jest.fn((s: Partial<TeamMemberSplit>) => s),
      save: jest.fn(
        (s: Partial<TeamMemberSplit> | Partial<TeamMemberSplit>[]) =>
          Array.isArray(s)
            ? Promise.resolve(s.map((x) => ({ id: `split-${x.userId}`, ...x })))
            : Promise.resolve({ id: `split-${s.userId}`, ...s }),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    bountyRepo = {
      findOne: jest.fn(),
      save: jest.fn((b: Partial<Bounty>) => Promise.resolve(b)),
    };
    userRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: getRepositoryToken(TeamMemberSplit), useValue: splitRepo },
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(TeamsService);
  });

  describe('create', () => {
    it('rejects via validateSplitPercentages when splits do not sum to 100', async () => {
      await expect(
        service.create({
          name: 'Team A',
          members: [{ userId: 'u1', percentage: 60 }],
        }),
      ).rejects.toThrow(
        'team member split percentages must sum to 100, got 60.00',
      );

      expect(teamRepo.save).not.toHaveBeenCalled();
    });

    it('saves the team and one split per member when percentages sum to 100', async () => {
      const team = await service.create({
        name: 'Team A',
        createdById: 'creator-1',
        members: [
          { userId: 'u1', role: 'frontend', percentage: 60 },
          { userId: 'u2', percentage: 40 },
        ],
      });

      expect(teamRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Team A', createdById: 'creator-1' }),
      );
      // One batched save with the whole array, not one call per member (#150).
      expect(splitRepo.save).toHaveBeenCalledTimes(1);
      expect(splitRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            teamId: 't1',
            userId: 'u1',
            role: 'frontend',
            percentage: '60.00',
          }),
          expect.objectContaining({
            teamId: 't1',
            userId: 'u2',
            role: null,
            percentage: '40.00',
          }),
        ]),
      );
      expect(team.splits).toHaveLength(2);
    });

    it('defaults createdById to null when not provided', async () => {
      await service.create({
        name: 'Team B',
        members: [{ userId: 'u1', percentage: 100 }],
      });

      expect(teamRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ createdById: null }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the team with its splits when found', async () => {
      const team = { id: 't1', name: 'Team A', splits: [] };
      teamRepo.findOne.mockResolvedValue(team);

      await expect(service.findOne('t1')).resolves.toBe(team);
      expect(teamRepo.findOne).toHaveBeenCalledWith({
        where: { id: 't1' },
        relations: { splits: true },
      });
    });

    it('throws NotFoundException when the team does not exist', async () => {
      teamRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assignToBounty', () => {
    it('throws NotFoundException when the team does not exist', async () => {
      teamRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignToBounty('missing-team', 'b1', 'sponsor-1'),
      ).rejects.toThrow(NotFoundException);
      expect(bountyRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the bounty does not exist', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 't1', splits: [] });
      bountyRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignToBounty('t1', 'missing-bounty', 'sponsor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets the bounty.teamId and persists it when both exist and caller is sponsor', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 't1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'b1',
        status: BountyStatus.OPEN,
        sponsorId: 'sponsor-1',
        teamId: null,
      });
      userRepo.findOne.mockResolvedValue({
        id: 'sponsor-1',
        roles: [UserRole.SPONSOR],
      });

      const bounty = await service.assignToBounty('t1', 'b1', 'sponsor-1');

      expect(bounty.teamId).toBe('t1');
      expect(bountyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b1', teamId: 't1' }),
      );
    });

    it('allows a MAINTAINER to assign even if not the sponsor', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 't1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'b1',
        status: BountyStatus.OPEN,
        sponsorId: 'other-sponsor',
        teamId: null,
      });
      userRepo.findOne.mockResolvedValue({
        id: 'maintainer-1',
        roles: [UserRole.MAINTAINER],
      });

      const bounty = await service.assignToBounty('t1', 'b1', 'maintainer-1');
      expect(bounty.teamId).toBe('t1');
    });

    it('throws BadRequestException when bounty status is MERGED', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 't1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'b1',
        status: BountyStatus.MERGED,
        sponsorId: 'sponsor-1',
        teamId: null,
      });
      userRepo.findOne.mockResolvedValue({
        id: 'sponsor-1',
        roles: [UserRole.SPONSOR],
      });

      await expect(
        service.assignToBounty('t1', 'b1', 'sponsor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when caller is not the sponsor and not a maintainer', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 't1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'b1',
        status: BountyStatus.OPEN,
        sponsorId: 'sponsor-1',
        teamId: null,
      });
      userRepo.findOne.mockResolvedValue({
        id: 'outsider',
        roles: [UserRole.CONTRIBUTOR],
      });

      await expect(
        service.assignToBounty('t1', 'b1', 'outsider'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows reassignment to a different team when bounty is OPEN and caller is sponsor', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 't2', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'b1',
        status: BountyStatus.OPEN,
        sponsorId: 'sponsor-1',
        teamId: 't1',
      });
      userRepo.findOne.mockResolvedValue({
        id: 'sponsor-1',
        roles: [UserRole.SPONSOR],
      });

      const bounty = await service.assignToBounty('t2', 'b1', 'sponsor-1');

      expect(bounty.teamId).toBe('t2');
    });
  });
});
