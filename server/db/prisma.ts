import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Database, DatabaseRow } from './connection';
import { postgresParameters } from './connection';

const globalPrisma = globalThis as typeof globalThis & {
  studioPrisma?: PrismaClient;
  studioPrismaUrl?: string;
};
const transactionContext = new AsyncLocalStorage<Prisma.TransactionClient>();

function normalizePrismaDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.searchParams.has('schema')) {
      const options = parsed.searchParams.get('options') ?? '';
      const match = options.match(/search_path=([A-Za-z0-9_]+)/);
      if (match?.[1]) {
        parsed.searchParams.set('schema', match[1]);
      }
    }
    return parsed.href;
  } catch {
    return rawUrl;
  }
}

export function prismaClient() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Prisma database access.');
  const url = normalizePrismaDatabaseUrl(process.env.DATABASE_URL);
  if (globalPrisma.studioPrisma && globalPrisma.studioPrismaUrl !== url) {
    void globalPrisma.studioPrisma.$disconnect().catch(() => {});
    delete globalPrisma.studioPrisma;
  }
  if (!globalPrisma.studioPrisma) {
    globalPrisma.studioPrisma = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : [],
    });
    globalPrisma.studioPrismaUrl = url;
  }
  return globalPrisma.studioPrisma;
}

export async function closePrismaConnection() {
  const prisma = globalPrisma.studioPrisma;
  delete globalPrisma.studioPrisma;
  delete globalPrisma.studioPrismaUrl;
  if (prisma) await prisma.$disconnect();
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
    close: closePrismaConnection,
  };
}
