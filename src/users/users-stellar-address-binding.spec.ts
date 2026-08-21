import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { GithubAccount, User } from '../common/entities';

/**
 * #40: funding endpoints take a `funderAddress` in the body. The wallet being
 * debited has to be the caller's own, so the address is checked against the user
 * record rather than trusted.
 */
describe('UsersService.assertOwnsStellarAddress (#40)', () => {
  let service: UsersService;
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(GithubAccount), useValue: {} },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('passes when the address is the one linked to the caller', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-a',
      stellarAddress: 'GMINE',
    });

    await expect(
      service.assertOwnsStellarAddress('user-a', 'GMINE'),
    ).resolves.toBeUndefined();
  });

  it("rejects funding that names someone else's address", async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-a',
      stellarAddress: 'GMINE',
    });

    await expect(
      service.assertOwnsStellarAddress('user-a', 'GTHEIRS'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a caller with no linked address rather than matching anything', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-a',
      stellarAddress: null,
    });

    await expect(
      service.assertOwnsStellarAddress('user-a', 'GANYTHING'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a token whose user no longer exists', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(
      service.assertOwnsStellarAddress('ghost', 'GANYTHING'),
    ).rejects.toThrow(ForbiddenException);
  });
});
