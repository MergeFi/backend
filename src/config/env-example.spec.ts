import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Every environment variable the application reads must be documented in
 * `.env.example`, otherwise operators have no way to discover it (#831).
 */
const SRC_DIR = resolve(__dirname, '..');
const ENV_EXAMPLE = resolve(__dirname, '../../.env.example');

const ENV_READ =
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

function envVarsReadInSrc(): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  for (const file of sourceFiles(SRC_DIR)) {
    for (const match of readFileSync(file, 'utf8').matchAll(ENV_READ)) {
      const name = match[1] ?? match[2];
      const files = reads.get(name) ?? [];
      reads.set(name, [...files, file.slice(SRC_DIR.length + 1)]);
    }
  }
  return reads;
}

function envVarsDocumented(): Set<string> {
  const documented = new Set<string>();
  for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (match) documented.add(match[1]);
  }
  return documented;
}

describe('.env.example', () => {
  const reads = envVarsReadInSrc();
  const documented = envVarsDocumented();

  it('finds process.env reads to check (sanity)', () => {
    expect(reads.size).toBeGreaterThan(0);
    expect(reads.has('RUN_SCHEDULERS')).toBe(true);
  });

  it('documents every environment variable read under src/', () => {
    const undocumented = [...reads.entries()]
      .filter(([name]) => !documented.has(name))
      .map(([name, files]) => `${name} (read in ${files.join(', ')})`);

    expect(undocumented).toEqual([]);
  });

  it.each(['GITHUB_SYNC_ALLOWED_REPOS', 'RUN_SCHEDULERS', 'ENCRYPTION_KEY'])(
    'documents %s',
    (name) => {
      expect(documented.has(name)).toBe(true);
    },
  );
});
