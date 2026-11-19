import { readdirSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage, MigrationInterface } from 'typeorm';
import * as entityModule from '../common/entities';
import { entities } from '../common/entities/typeorm-entities';
import { AppDataSource } from './data-source';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Migrations that already share a timestamp on main (#734). TypeORM orders
 * migrations by that timestamp, so their relative order is undefined. They are
 * listed explicitly so no new collision can be added; renaming them is a data
 * change for already-migrated databases and is tracked in #734 — remove this
 * entry once that lands.
 */
const KNOWN_TIMESTAMP_COLLISIONS: Record<string, string[]> = {
  '1785200000000': [
    '1785200000000-AddBountySponsorIdStatusIndex.ts',
    '1785200000000-AddMissingLookupIndexes.ts',
    '1785200000000-AddSplitPercentageChecks.ts',
  ],
};

const MIGRATION_FILE = /^(\d{13})-([A-Za-z][A-Za-z0-9]*)\.ts$/;

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .sort();

type MigrationClass = new () => MigrationInterface;

function loadMigrationClasses(file: string): MigrationClass[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const exported = require(join(MIGRATIONS_DIR, file)) as Record<
    string,
    unknown
  >;
  return Object.values(exported).filter(
    (value): value is MigrationClass => typeof value === 'function',
  );
}

describe('AppDataSource (migration CLI)', () => {
  const { options } = AppDataSource;

  it('targets postgres and never synchronizes the schema', () => {
    expect(options.type).toBe('postgres');
    expect(options.synchronize).toBe(false);
    expect(options.migrationsTableName).toBe('migrations');
  });

  describe('entities', () => {
    it('uses the same entity list the app registers in app.module.ts', () => {
      expect(options.entities).toBe(entities);
    });

    it('registers every export of src/common/entities and nothing else', () => {
      expect(entities).toHaveLength(Object.keys(entityModule).length);
      expect(new Set(entities)).toEqual(new Set(Object.values(entityModule)));
    });

    it('lists only @Entity-decorated classes', () => {
      const tables = new Set(
        getMetadataArgsStorage().tables.map((table) => table.target),
      );
      for (const entity of entities) {
        expect(tables.has(entity as never)).toBe(true);
      }
    });
  });

  describe('migrations', () => {
    it('loads every file in src/database/migrations via its glob', () => {
      expect(options.migrations).toEqual([join(MIGRATIONS_DIR, '*{.ts,.js}')]);
      expect(migrationFiles.length).toBeGreaterThan(0);
    });

    it.each(migrationFiles)(
      '%s is named <13-digit timestamp>-<ClassName>.ts',
      (file) => {
        expect(file).toMatch(MIGRATION_FILE);
      },
    );

    it.each(migrationFiles)(
      '%s exports exactly one migration whose class and name match the file',
      (file) => {
        const [, timestamp, baseName] = MIGRATION_FILE.exec(file) ?? [];
        const classes = loadMigrationClasses(file);

        expect(classes).toHaveLength(1);
        const [Migration] = classes;
        const expectedName = `${baseName}${timestamp}`;
        // TypeORM derives the run order from the trailing timestamp of the
        // class name and records `name` in the migrations table, so both must
        // agree with the file name.
        expect(Migration.name).toBe(expectedName);

        const instance = new Migration();
        expect(instance.name).toBe(expectedName);
        expect(typeof instance.up).toBe('function');
        expect(typeof instance.down).toBe('function');
      },
    );

    // With every timestamp fixed at 13 digits (asserted above), file-name
    // order is TypeORM's run order, so unique timestamps mean the sequence is
    // strictly increasing.
    it('has unique timestamps (apart from the known #734 collisions)', () => {
      const byTimestamp = new Map<string, string[]>();
      for (const file of migrationFiles) {
        const timestamp = file.slice(0, 13);
        byTimestamp.set(timestamp, [
          ...(byTimestamp.get(timestamp) ?? []),
          file,
        ]);
      }

      const collisions = Object.fromEntries(
        [...byTimestamp].filter(([, files]) => files.length > 1),
      );
      expect(collisions).toEqual(KNOWN_TIMESTAMP_COLLISIONS);
    });
  });
});
