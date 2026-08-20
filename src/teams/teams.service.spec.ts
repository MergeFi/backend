import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { Bounty, Team, TeamMemberSplit } from '../common/entities';

describe('TeamsService', () => {
  let service: TeamsService;
  let teamRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let splitRepo: { save: jest.Mock; create: jest.Mock };
  let bountyRepo: { findOne: jest.Mock; save: jest.Mock };

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
      save: jest.fn((s: Partial<TeamMemberSplit>) =>
        Promise.resolve({ id: `split-${s.userId}`, ...s }),
      ),
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

  describe('create', () => {
    it('rejects via validateSplitPercentages when splits do not sum to 100', async () => {
      await expect(
        service.create({
          name: 'Team A',
          members: [{ userId: 'u1', percentage: 60 }],
        }),
      ).rejects.toThrow('Team split percentages must sum to 100, got 60.00');

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
      expect(splitRepo.save).toHaveBeenCalledTimes(2);
      expect(splitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 't1',
          userId: 'u1',
          role: 'frontend',
          percentage: '60.00',
        }),
      );
      expect(splitRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 't1',
          userId: 'u2',
          role: null,
          percentage: '40.00',
        }),
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
});
