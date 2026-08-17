import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../common/entities';
import { UserRole } from '../common/enums';

describe('UsersService.setStellarAddress', () => {
  let service: UsersService;
  let userRepo: { findOne: jest.Mock; save: jest.Mock };

  const userA = {
    id: 'a0000000-0000-4000-8000-00000000000a',
    roles: [UserRole.CONTRIBUTOR],
    stellarAddress: null,
  } as unknown as User;

  const userB = {
    id: 'b0000000-0000-4000-8000-00000000000b',
    roles: [UserRole.CONTRIBUTOR],
    stellarAddress: 'OLD',
  } as unknown as User;

  const maintainer = {
    id: 'c0000000-0000-4000-8000-00000000000c',
    roles: [UserRole.CONTRIBUTOR, UserRole.MAINTAINER],
    stellarAddress: null,
  } as unknown as User;

  const byId = new Map<string, unknown>([
    [userA.id, { ...userA }],
    [userB.id, { ...userB }],
    [maintainer.id, { ...maintainer }],
  ]);

  beforeEach(() => {
    byId.set(userA.id, { ...userA });
    byId.set(userB.id, { ...userB });
    byId.set(maintainer.id, { ...maintainer });

    userRepo = {
      findOne: jest.fn(
        ({ where: { id } }: { where: { id: string } }) => byId.get(id) ?? null,
      ),
      save: jest.fn((user: User) => Promise.resolve(user)),
    };

    service = new UsersService(userRepo as never, {} as never);
  });

  it('lets a user set their own address', async () => {
    const saved = await service.setStellarAddress(
      userA.id,
      'GA_NEW_ADDRESS',
      userA.id,
    );

    expect(saved.stellarAddress).toBe('GA_NEW_ADDRESS');
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a contributor overwriting someone else and never writes', async () => {
    await expect(
      service.setStellarAddress(userB.id, 'GA_ATTACKER', userA.id),
    ).rejects.toThrow(ForbiddenException);

    expect(userRepo.save).not.toHaveBeenCalled();
    // The victim's stored address is untouched.
    const stored = byId.get(userB.id) as { stellarAddress: string };
    expect(stored.stellarAddress).toBe('OLD');
  });

  it('allows a maintainer to change another user address', async () => {
    const saved = await service.setStellarAddress(
      userB.id,
      'GA_MAINTAINER_SET',
      maintainer.id,
    );

    expect(saved.stellarAddress).toBe('GA_MAINTAINER_SET');
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('skips the caller lookup entirely for same-id writes', async () => {
    await service.setStellarAddress(userA.id, 'GA_SELF', userA.id);
    // findOne is called once, for the target only — no caller round-trip.
    expect(userRepo.findOne).toHaveBeenCalledTimes(1);
  });
});
