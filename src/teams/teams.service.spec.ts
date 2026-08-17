import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TeamsService } from './teams.service';
import { Team, TeamMemberSplit, Bounty, User } from '../common/entities';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('TeamsService', () => {
  let service: TeamsService;
  let teamRepo: any;
  let splitRepo: any;
  let bountyRepo: any;

  beforeEach(async () => {
    teamRepo = {
      create: jest.fn((dto) => ({ id: 'team-uuid', ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'team-uuid', ...entity })),
      findOne: jest.fn(),
    };
    splitRepo = {
      create: jest.fn((dto) => ({ id: 'split-uuid', ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'split-uuid', ...entity })),
    };
    bountyRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: getRepositoryToken(TeamMemberSplit), useValue: splitRepo },
        { provide: getRepositoryToken(Bounty), useValue: bountyRepo },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
  });

  describe('create', () => {
    it('creates a team and its splits when percentages sum to 100', async () => {
      const dto = {
        name: 'Alpha Team',
        createdById: 'user-1',
        members: [
          { userId: 'user-1', percentage: 60, role: 'lead' },
          { userId: 'user-2', percentage: 40, role: 'dev' },
        ],
      };

      const result = await service.create(dto);
      expect(result.name).toBe('Alpha Team');
      expect(result.splits).toHaveLength(2);
      expect(splitRepo.save).toHaveBeenCalledTimes(2);
    });

    it('rejects team creation if splits do not sum to 100', async () => {
      const dto = {
        name: 'Invalid Team',
        members: [
          { userId: 'user-1', percentage: 50 },
          { userId: 'user-2', percentage: 30 },
        ],
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(teamRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns team with splits relation', async () => {
      const mockTeam = { id: 'team-1', name: 'Alpha', splits: [] };
      teamRepo.findOne.mockResolvedValue(mockTeam);

      const res = await service.findOne('team-1');
      expect(res).toBe(mockTeam);
      expect(teamRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        relations: { splits: true },
      });
    });

    it('throws NotFoundException when team does not exist', async () => {
      teamRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignToBounty', () => {
    it('attaches team to bounty', async () => {
      const mockTeam = { id: 'team-1', name: 'Alpha', splits: [] };
      const mockBounty = { id: 'bounty-1', teamId: null };
      teamRepo.findOne.mockResolvedValue(mockTeam);
      bountyRepo.findOne.mockResolvedValue(mockBounty);

      const res = await service.assignToBounty('team-1', 'bounty-1');
      expect(res.teamId).toBe('team-1');
      expect(bountyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-1' }));
    });
  });
});
