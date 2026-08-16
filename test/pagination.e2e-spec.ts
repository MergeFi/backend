import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { Bounty, Milestone, MaintenancePool, User } from '../src/common/entities';
import {
  BountyStatus,
  MilestoneStatus,
  MaintenancePoolStatus,
  UserRole,
  AssetType,
} from '../src/common/enums';

describe('Pagination (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    dataSource = moduleFixture.get<DataSource>(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up tables before each test
    await dataSource.query('DELETE FROM bounty');
    await dataSource.query('DELETE FROM milestone');
    await dataSource.query('DELETE FROM maintenance_pool');
    await dataSource.query('DELETE FROM "user"');
  });

  describe('GET /bounties', () => {
    it('should return paginated bounties with default page size', async () => {
      // Seed 75 bounties (more than default page size of 50)
      const bountyRepo = dataSource.getRepository(Bounty);
      const bounties: Partial<Bounty>[] = [];
      for (let i = 0; i < 75; i++) {
        bounties.push({
          amount: '10.0000000',
          asset: AssetType.USDC,
          status: BountyStatus.OPEN,
        });
      }
      await bountyRepo.save(bounties);

      const res = await request(app.getHttpServer())
        .get('/bounties')
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.data).toHaveLength(50); // Default page size
      expect(res.body.meta.totalItems).toBe(75);
      expect(res.body.meta.totalPages).toBe(2);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(50);
      expect(res.body.meta.hasNextPage).toBe(true);
      expect(res.body.meta.hasPreviousPage).toBe(false);
    });

    it('should return second page of bounties', async () => {
      const bountyRepo = dataSource.getRepository(Bounty);
      const bounties: Partial<Bounty>[] = [];
      for (let i = 0; i < 75; i++) {
        bounties.push({
          amount: '10.0000000',
          asset: AssetType.USDC,
          status: BountyStatus.OPEN,
        });
      }
      await bountyRepo.save(bounties);

      const res = await request(app.getHttpServer())
        .get('/bounties?page=2&limit=50')
        .expect(200);

      expect(res.body.data).toHaveLength(25); // Remaining items
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.hasNextPage).toBe(false);
      expect(res.body.meta.hasPreviousPage).toBe(true);
    });

    it('should enforce maximum page size of 100', async () => {
      const bountyRepo = dataSource.getRepository(Bounty);
      const bounties: Partial<Bounty>[] = [];
      for (let i = 0; i < 150; i++) {
        bounties.push({
          amount: '10.0000000',
          asset: AssetType.USDC,
          status: BountyStatus.OPEN,
        });
      }
      await bountyRepo.save(bounties);

      // Try to request more than max (should fail validation)
      await request(app.getHttpServer())
        .get('/bounties?limit=150')
        .expect(400);

      // Request exactly max (should succeed)
      const res = await request(app.getHttpServer())
        .get('/bounties?limit=100')
        .expect(200);

      expect(res.body.data).toHaveLength(100);
      expect(res.body.meta.limit).toBe(100);
    });

    it('should filter by status and paginate', async () => {
      const bountyRepo = dataSource.getRepository(Bounty);
      const bounties: Partial<Bounty>[] = [];
      for (let i = 0; i < 60; i++) {
        bounties.push({
          amount: '10.0000000',
          asset: AssetType.USDC,
          status: i < 30 ? BountyStatus.OPEN : BountyStatus.FUNDED,
        });
      }
      await bountyRepo.save(bounties);

      const res = await request(app.getHttpServer())
        .get('/bounties?status=open&limit=20')
        .expect(200);

      expect(res.body.data).toHaveLength(20);
      expect(res.body.meta.totalItems).toBe(30); // Only OPEN bounties
      expect(res.body.data.every((b: Bounty) => b.status === BountyStatus.OPEN)).toBe(true);
    });

    it('should return empty data for page beyond total', async () => {
      const bountyRepo = dataSource.getRepository(Bounty);
      await bountyRepo.save({
        amount: '10.0000000',
        asset: AssetType.USDC,
        status: BountyStatus.OPEN,
      });

      const res = await request(app.getHttpServer())
        .get('/bounties?page=10')
        .expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.totalItems).toBe(1);
      expect(res.body.meta.hasNextPage).toBe(false);
    });
  });

  describe('GET /milestones', () => {
    it('should return paginated milestones with default page size', async () => {
      const milestoneRepo = dataSource.getRepository(Milestone);
      const milestones: Partial<Milestone>[] = [];
      for (let i = 0; i < 75; i++) {
        milestones.push({
          title: `Milestone ${i}`,
          budget: '1000.0000000',
          asset: AssetType.USDC,
          status: MilestoneStatus.OPEN,
        });
      }
      await milestoneRepo.save(milestones);

      const res = await request(app.getHttpServer())
        .get('/milestones')
        .expect(200);

      expect(res.body.data).toHaveLength(50);
      expect(res.body.meta.totalItems).toBe(75);
      expect(res.body.meta.hasNextPage).toBe(true);
    });

    it('should respect custom page size', async () => {
      const milestoneRepo = dataSource.getRepository(Milestone);
      const milestones: Partial<Milestone>[] = [];
      for (let i = 0; i < 30; i++) {
        milestones.push({
          title: `Milestone ${i}`,
          budget: '1000.0000000',
          asset: AssetType.USDC,
          status: MilestoneStatus.OPEN,
        });
      }
      await milestoneRepo.save(milestones);

      const res = await request(app.getHttpServer())
        .get('/milestones?limit=10')
        .expect(200);

      expect(res.body.data).toHaveLength(10);
      expect(res.body.meta.limit).toBe(10);
      expect(res.body.meta.totalPages).toBe(3);
    });
  });

  describe('GET /maintenance-pools', () => {
    it('should return paginated maintenance pools', async () => {
      const poolRepo = dataSource.getRepository(MaintenancePool);
      const pools: Partial<MaintenancePool>[] = [];
      for (let i = 0; i < 75; i++) {
        pools.push({
          name: `Pool ${i}`,
          asset: AssetType.USDC,
          status: MaintenancePoolStatus.ACTIVE,
        });
      }
      await poolRepo.save(pools);

      const res = await request(app.getHttpServer())
        .get('/maintenance-pools')
        .expect(200);

      expect(res.body.data).toHaveLength(50);
      expect(res.body.meta.totalItems).toBe(75);
      expect(res.body.meta.hasNextPage).toBe(true);
    });

    it('should navigate through pages correctly', async () => {
      const poolRepo = dataSource.getRepository(MaintenancePool);
      const pools: Partial<MaintenancePool>[] = [];
      for (let i = 0; i < 25; i++) {
        pools.push({
          name: `Pool ${i}`,
          asset: AssetType.USDC,
          status: MaintenancePoolStatus.ACTIVE,
        });
      }
      await poolRepo.save(pools);

      const page1 = await request(app.getHttpServer())
        .get('/maintenance-pools?limit=10&page=1')
        .expect(200);

      const page2 = await request(app.getHttpServer())
        .get('/maintenance-pools?limit=10&page=2')
        .expect(200);

      expect(page1.body.data).toHaveLength(10);
      expect(page2.body.data).toHaveLength(10);
      expect(page1.body.data[0].id).not.toBe(page2.body.data[0].id); // Different items
      expect(page2.body.meta.hasPreviousPage).toBe(true);
    });
  });

  describe('GET /users', () => {
    it('should return paginated users', async () => {
      const userRepo = dataSource.getRepository(User);
      const users: Partial<User>[] = [];
      for (let i = 0; i < 75; i++) {
        users.push({
          username: `user${i}`,
          email: `user${i}@example.com`,
          roles: [UserRole.CONTRIBUTOR],
        });
      }
      await userRepo.save(users);

      const res = await request(app.getHttpServer())
        .get('/users')
        .expect(200);

      expect(res.body.data).toHaveLength(50);
      expect(res.body.meta.totalItems).toBe(75);
      expect(res.body.meta.hasNextPage).toBe(true);
    });

    it('should handle invalid pagination parameters', async () => {
      // Invalid page (less than 1)
      await request(app.getHttpServer())
        .get('/users?page=0')
        .expect(400);

      // Invalid limit (less than 1)
      await request(app.getHttpServer())
        .get('/users?limit=0')
        .expect(400);

      // Invalid limit (greater than max)
      await request(app.getHttpServer())
        .get('/users?limit=101')
        .expect(400);
    });
  });
});
