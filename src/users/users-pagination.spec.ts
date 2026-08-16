import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { GithubAccount, User } from '../common/entities';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../common/dto/pagination.dto';

describe('UsersService list pagination', () => {
  let service: UsersService;
  let userRepo: { findAndCount: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      findAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(GithubAccount), useValue: {} },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('paginates users list with defaults and caps limit', async () => {
    const fakeUsers = Array.from({ length: 15 }, (_, i) => ({
      id: `user-${i}`,
      username: `user_${i}`,
    })) as User[];

    userRepo.findAndCount.mockResolvedValue([fakeUsers, 100]);

    const result = await service.list({ limit: 15, offset: 0 });

    expect(userRepo.findAndCount).toHaveBeenCalledWith({
      take: 15,
      skip: 0,
      order: { createdAt: 'DESC' },
    });

    expect(result.data.length).toBe(15);
    expect(result.total).toBe(100);
    expect(result.hasMore).toBe(true);
  });

  it('caps max limit to MAX_PAGE_LIMIT (100)', async () => {
    userRepo.findAndCount.mockResolvedValue([[], 0]);

    await service.list({ limit: 9999, offset: 0 });

    expect(userRepo.findAndCount).toHaveBeenCalledWith({
      take: MAX_PAGE_LIMIT,
      skip: 0,
      order: { createdAt: 'DESC' },
    });
  });
});
