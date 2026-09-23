import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BountiesController } from './bounties.controller';
import { BountiesService } from './bounties.service';
import { CreateBountyDto } from './dto/create-bounty.dto';
import { ClaimBountyDto } from './dto/claim-bounty.dto';
import { AssetType, BountyDifficulty, BountyStatus } from '../common/enums';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('BountiesController', () => {
  let controller: BountiesController;
  let bountiesService: {
    create: jest.Mock;
    findOne: jest.Mock;
    fund: jest.Mock;
    claim: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    refund: jest.Mock;
    list: jest.Mock;
  };

  beforeEach(async () => {
    bountiesService = {
      create: jest.fn().mockResolvedValue({ id: 'b1', status: BountyStatus.OPEN }),
      findOne: jest.fn().mockResolvedValue({ id: 'b1', status: BountyStatus.OPEN }),
      fund: jest.fn().mockResolvedValue({ id: 'b1', status: BountyStatus.FUNDED }),
      claim: jest.fn().mockResolvedValue({ id: 'b1', status: BountyStatus.CLAIMED }),
      approve: jest.fn().mockResolvedValue({ id: 'b1', status: 'approved' }),
      reject: jest.fn().mockResolvedValue({ id: 'b1', status: 'rejected' }),
      refund: jest.fn().mockResolvedValue({ id: 'b1', status: BountyStatus.REFUNDED }),
      list: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BountiesController],
      providers: [{ provide: BountiesService, useValue: bountiesService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(BountiesController);
  });

  describe('create', () => {
    it('calls bountiesService.create with the provided DTO', async () => {
      const dto = {
        issueId: '00000000-0000-0000-0000-000000000001',
        sponsorId: '00000000-0000-0000-0000-000000000002',
        amount: '100',
        asset: AssetType.USDC,
        difficulty: BountyDifficulty.INTERMEDIATE,
      };

      await controller.create(dto);

      expect(bountiesService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findOne', () => {
    it('calls bountiesService.findOne with the route param', async () => {
      await controller.findOne('b1');

      expect(bountiesService.findOne).toHaveBeenCalledWith('b1');
    });
  });

  describe('fund', () => {
    it('calls bountiesService.fund with id and funderAddress', async () => {
      await controller.fund('b1', { funderAddress: 'GFUNDER' });

      expect(bountiesService.fund).toHaveBeenCalledWith('b1', 'GFUNDER');
    });
  });

  describe('claim', () => {
    it('calls bountiesService.claim with id and contributorId', async () => {
      await controller.claim('b1', { contributorId: 'contributor-1' });

      expect(bountiesService.claim).toHaveBeenCalledWith('b1', 'contributor-1');
    });
  });

  describe('approve', () => {
    it('calls bountiesService.approve with the route param', async () => {
      await controller.approve('b1');

      expect(bountiesService.approve).toHaveBeenCalledWith('b1');
    });
  });

  describe('reject', () => {
    it('calls bountiesService.reject with the route param', async () => {
      await controller.reject('b1');

      expect(bountiesService.reject).toHaveBeenCalledWith('b1');
    });
  });

  describe('refund', () => {
    it('calls bountiesService.refund with the route param', async () => {
      await controller.refund('b1');

      expect(bountiesService.refund).toHaveBeenCalledWith('b1');
    });
  });

  describe('list', () => {
    it('calls bountiesService.list with query params', async () => {
      await controller.list(BountyStatus.OPEN, BountyDifficulty.BEGINNER, AssetType.USDC, 'repo-1', 'TypeScript');

      expect(bountiesService.list).toHaveBeenCalledWith({
        status: BountyStatus.OPEN,
        difficulty: BountyDifficulty.BEGINNER,
        asset: AssetType.USDC,
        repositoryId: 'repo-1',
        primaryLanguage: 'TypeScript',
      });
    });
  });

  describe('CreateBountyDto validation', () => {
    it('rejects a body with no issueId', async () => {
      const dto = plainToInstance(CreateBountyDto, {
        sponsorId: '00000000-0000-0000-0000-000000000001',
        amount: '100',
        asset: AssetType.USDC,
        difficulty: BountyDifficulty.INTERMEDIATE,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a body with no sponsorId', async () => {
      const dto = plainToInstance(CreateBountyDto, {
        issueId: '00000000-0000-0000-0000-000000000001',
        amount: '100',
        asset: AssetType.USDC,
        difficulty: BountyDifficulty.INTERMEDIATE,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a body with no amount', async () => {
      const dto = plainToInstance(CreateBountyDto, {
        issueId: '00000000-0000-0000-0000-000000000001',
        sponsorId: '00000000-0000-0000-0000-000000000002',
        asset: AssetType.USDC,
        difficulty: BountyDifficulty.INTERMEDIATE,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
