import { EntitySchema } from 'typeorm';
import * as entityModule from './index';

export type EntityClass = new (...args: unknown[]) => unknown;

/** All entity classes, collected for TypeOrmModule.forRootAsync({ entities }). */
export const entities: (EntityClass | EntitySchema)[] = Object.values(
  entityModule,
) as (EntityClass | EntitySchema)[];
