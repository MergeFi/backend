import { GithubStrategy } from './github.strategy';
import { Profile } from 'passport-github2';

describe('GithubStrategy.validate (#594)', () => {
  const strategy = new GithubStrategy({
    get: () => ({
      clientId: 'id',
      clientSecret: 'secret',
      oauthCallbackUrl: 'http://localhost/cb',
    }),
  } as never);

  it('maps the passport-github2 profile into the upsert input', () => {
    const profile = {
      id: 'gh-1',
      username: 'alice',
      emails: [{ value: 'alice@example.com' }],
      photos: [{ value: 'https://avatars/1' }],
    } as unknown as Profile;
    const done = jest.fn();

    strategy.validate('at', 'rt', profile, done);

    expect(done).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        githubId: 'gh-1',
        username: 'alice',
        email: 'alice@example.com',
        avatarUrl: 'https://avatars/1',
        accessToken: 'at',
        refreshToken: 'rt',
      }),
    );
  });

  it('nulls email/avatar when the profile has none', () => {
    const profile = { id: 'gh-2', username: 'bob' } as unknown as Profile;
    const done = jest.fn();
    strategy.validate('at', 'rt', profile, done);
    expect(done).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ email: null, avatarUrl: null }),
    );
  });
});
