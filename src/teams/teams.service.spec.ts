import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TeamsService } from './teams.service';
import { Bounty, Team, TeamMemberSplit } from '../common/entities';
import { BountyStatus } from '../common/enums';

describe('TeamsService', () => {
  let service: TeamsService;
  let teamRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let splitRepo: { save: jest.Mock; create: jest.Mock };
  let bountyRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    teamRepo = {
      findOne: jest.fn(),
      save: jest.fn((t: Partial<Team>) =>
        Promise.resolve({ id: 'team-1', ...t }),
      ),
      create: jest.fn((data: Partial<Team>) => ({ id: 'team-1', ...data })),
    };
    splitRepo = {
      save: jest.fn((s: Partial<TeamMemberSplit>) =>
        Promise.resolve({ id: 'split-1', ...s }),
      ),
      create: jest.fn((data: Partial<TeamMemberSplit>) => ({
        id: 'split-1',
        ...data,
      })),
    };
    bountyRepo = {
      findOne: jest.fn(),
      save: jest.fn((b: Partial<Bounty>) => Promise.resolve(b)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: getRepositoryToken(TeamMemberSplit), useValue: splitRepo },
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
      ],
    }).compile();

    service = module.get(TeamsService);
  });

  describe('assignToBounty', () => {
    it('assigns a team to an OPEN bounty', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 'team-1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: BountyStatus.OPEN,
        claimedById: null,
      });

      const updated = await service.assignToBounty('team-1', 'bounty-1');
      expect(updated.teamId).toBe('team-1');
      expect(bountyRepo.save).toHaveBeenCalled();
    });

    it('assigns a team to a FUNDED bounty', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 'team-1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: BountyStatus.FUNDED,
        claimedById: null,
      });

      const updated = await service.assignToBounty('team-1', 'bounty-1');
      expect(updated.teamId).toBe('team-1');
      expect(bountyRepo.save).toHaveBeenCalled();
    });

    it('rejects assigning a team to a CLAIMED bounty', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 'team-1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: BountyStatus.CLAIMED,
        claimedById: 'user-1',
      });

      await expect(
        service.assignToBounty('team-1', 'bounty-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects assigning a team to an IN_REVIEW bounty', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 'team-1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: BountyStatus.IN_REVIEW,
        claimedById: 'user-1',
      });

      await expect(
        service.assignToBounty('team-1', 'bounty-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects assigning a team when bounty already has a claimedById', async () => {
      teamRepo.findOne.mockResolvedValue({ id: 'team-1', splits: [] });
      bountyRepo.findOne.mockResolvedValue({
        id: 'bounty-1',
        status: BountyStatus.FUNDED,
        claimedById: 'user-1',
      });

      await expect(
        service.assignToBounty('team-1', 'bounty-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
