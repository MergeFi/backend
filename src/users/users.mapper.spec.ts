import { toPublicUser } from './users.mapper';
import { User } from '../common/entities/user.entity';
import { UserRole } from '../common/enums';

const makeUser = (over: Partial<User> = {}): User =>
  ({
    id: 'u1',
    username: 'dev',
    displayName: 'Dev',
    avatarUrl: 'https://x/y.png',
    roles: [UserRole.CONTRIBUTOR],
    stellarAddress: 'GADDR',
    createdAt: new Date('2024-01-01'),
    // the private fields that must NOT leak
    email: 'dev@secret.com',
    githubAccount: { id: 'g1', accessToken: 'token' },
    ...over,
  }) as unknown as User;

describe('toPublicUser', () => {
  it('maps the public fields through', () => {
    const dto = toPublicUser(makeUser());
    expect(dto.id).toBe('u1');
    expect(dto.username).toBe('dev');
    expect(dto.stellarAddress).toBe('GADDR');
    expect(dto.createdAt).toEqual(new Date('2024-01-01'));
  });

  it('strips the private fields (email, githubAccount)', () => {
    const dto = toPublicUser(makeUser()) as any;
    // #359 — the raw entity leaks email + the nested githubAccount; the public
    // DTO must not carry them.
    expect(dto.email).toBeUndefined();
    expect(dto.githubAccount).toBeUndefined();
  });

  it('only exposes the declared public shape', () => {
    const dto = toPublicUser(makeUser());
    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'username',
        'displayName',
        'avatarUrl',
        'roles',
        'stellarAddress',
        'createdAt',
      ].sort(),
    );
  });
});
