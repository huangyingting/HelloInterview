import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Database, DatabaseRow } from './connection';
import { postgresParameters } from './connection';

const globalPrisma = globalThis as typeof globalThis & { studioPrisma?: PrismaClient };
const transactionContext = new AsyncLocalStorage<Prisma.TransactionClient>();

export function prismaClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Prisma database access.');
  return globalPrisma.studioPrisma ??= new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function advisoryQuery(sql: string) {
  return /^\s*SELECT\s+pg_advisory_xact_lock\(/i.test(sql)
    ? `SELECT 1 AS locked FROM (${sql}) AS advisory_lock`
    : sql;
}

function deserializableQuery(sql: string) {
  // pg-boss relies on node-postgres type inference that Prisma's text bindings do not provide.
  const regclass = sql.match(/^\s*SELECT\s+to_regclass\((.+)\)\s+as\s+name\s*;?\s*$/is);
  const supported = regclass ? `SELECT to_regclass(${regclass[1]})::text AS name` : sql;
  return /\.job_common\b/i.test(supported)
    ? supported.replace(/\b(id|source_id|source_root_id)\s*=\s*(\$\d+)(?!\s*::)/gi, '$1 = $2::uuid')
    : supported;
}

export function prismaConnection(): Database {
  const prisma = prismaClient();
  const executor = () => transactionContext.getStore() ?? prisma;
  const query = async (sql: string, values: unknown[] = []) =>
    executor().$queryRawUnsafe<DatabaseRow[]>(advisoryQuery(postgresParameters(sql)), ...values);
  return {
    dialect: 'postgres',
    prepare(sql) {
      return {
        get: async (...values) => (await query(sql, values))[0],
        all: (...values) => query(sql, values),
        run: async (...values) => {
          const statement = postgresParameters(sql);
          if (/\bRETURNING\b/i.test(statement)) return (await executor().$queryRawUnsafe<DatabaseRow[]>(statement, ...values)).length;
          return executor().$executeRawUnsafe(statement, ...values);
        },
      };
    },
    exec: async sql => { await executor().$executeRawUnsafe(postgresParameters(sql)); },
    executeSql: async (sql, values = []) => {
      const statement = deserializableQuery(advisoryQuery(sql));
      if (/^\s*(?:SELECT|WITH|SHOW|EXPLAIN|VALUES)\b/i.test(statement) || /\bRETURNING\b/i.test(statement)) {
        return { rows: await executor().$queryRawUnsafe<DatabaseRow[]>(statement, ...values) };
      }
      await executor().$executeRawUnsafe(statement, ...values);
      return { rows: [] };
    },
    transaction: operation => transactionContext.getStore() ? operation() : prisma.$transaction(
      transaction => transactionContext.run(transaction, operation),
      { maxWait: 5000, timeout: 30000 },
    ),
    close: () => prisma.$disconnect(),
  };
}
