import { resolveLogLevels, startupMessage } from './log-levels';

describe('resolveLogLevels', () => {
  it('enables only error when LOG_LEVEL=error, so the log-level banner is suppressed', () => {
    expect(resolveLogLevels('error')).toEqual(['error']);
    expect(resolveLogLevels('error')).not.toContain('log');
  });

  it('is case-insensitive and cumulative', () => {
    expect(resolveLogLevels('DEBUG')).toEqual([
      'error',
      'warn',
      'log',
      'debug',
    ]);
  });

  it('falls back to log for unknown values', () => {
    expect(resolveLogLevels('nonsense')).toEqual(['error', 'warn', 'log']);
  });
});

describe('startupMessage', () => {
  it('omits the docs hint in production', () => {
    expect(startupMessage('production', 3000)).toBe(
      'MergeFi backend listening on port 3000',
    );
  });

  it('mentions /api/docs outside production', () => {
    expect(startupMessage('development', 3000)).toContain('docs at /api/docs');
  });
});
