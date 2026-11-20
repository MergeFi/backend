import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../common/entities';

describe('AuthService logging (#366)', () => {
  const user = { id: 'user-1', username: 'octocat' } as User;
  let service: AuthService;
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    const usersService = {
      upsertFromGithub: jest.fn().mockResolvedValue(user),
    } as unknown as UsersService;
    const jwtService = {
      sign: jest.fn().mockReturnValue('secret.jwt.token'),
    } as unknown as JwtService;
    service = new AuthService(usersService, jwtService);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  const allLogged = () =>
    [...logSpy.mock.calls, ...debugSpy.mock.calls].flat().join('\n');

  it('logs a successful GitHub login with the user id, never the token', async () => {
    const { accessToken } = await service.loginWithGithub({} as never);

    expect(accessToken).toBe('secret.jwt.token');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('GitHub login succeeded for user user-1'),
    );
    expect(allLogged()).not.toContain('secret.jwt.token');
  });

  it('logs why a handoff code was rejected without logging the code', () => {
    expect(service.consumeHandoffCode('deadbeef')).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown or already consumed'),
    );

    const code = service.createHandoffCode('tok');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);
    expect(service.consumeHandoffCode(code)).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('expired'));

    expect(allLogged()).not.toContain(code);
    expect(allLogged()).not.toContain('deadbeef');
  });
});
