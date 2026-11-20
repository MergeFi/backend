import { swaggerBasicAuth } from './swagger-basic-auth';

function run(credentials: string, authorization?: string) {
  const next = jest.fn();
  const setHeader = jest.fn();
  const end = jest.fn();
  const status = jest.fn(() => ({ end }));
  const req = { headers: authorization ? { authorization } : {} };
  const res = { setHeader, status };

  swaggerBasicAuth(credentials)(req as never, res as never, next);
  return { next, setHeader, status, end };
}

const basic = (value: string) => `Basic ${Buffer.from(value).toString('base64')}`;

describe('swaggerBasicAuth', () => {
  it('passes a request with the right credentials', () => {
    const { next, status } = run('docs:s3cret', basic('docs:s3cret'));
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects a wrong password with a 401 challenge', () => {
    const { next, status, setHeader, end } = run('docs:s3cret', basic('docs:wrong!'));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('Basic realm='),
    );
    expect(end).toHaveBeenCalled();
  });

  it('rejects a missing header', () => {
    const { next, status } = run('docs:s3cret');
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a bearer token and other schemes', () => {
    expect(run('docs:s3cret', 'Bearer docs:s3cret').next).not.toHaveBeenCalled();
  });

  it('rejects a value of a different length without throwing', () => {
    const { next, status } = run('docs:s3cret', basic('d:x'));
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects an empty Basic payload', () => {
    expect(run('docs:s3cret', 'Basic ').next).not.toHaveBeenCalled();
  });
});
