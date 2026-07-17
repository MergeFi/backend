import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { entities } from '../common/entities/typeorm-entities';

/**
 * TypeORM CLI DataSource — used only for `migration:generate`/`migration:run`/
 * `migration:revert` (see package.json scripts). The running application
 * connects via `TypeOrmModule.forRootAsync` in src/app.module.ts instead;
 * the two are kept in sync by importing the same `entities` list.
 *
 * Before this, the app relied entirely on `synchronize` and had no migration
 * history at all (#27) — every schema change (including the exactly-one-
 * parent CHECK constraint this DataSource ships the first migration for)
 * now goes through a reviewable, revertible migration file instead.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/mergefi',
  entities,
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: process.env.DATABASE_LOGGING === 'true',
});
