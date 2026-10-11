import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { Pool, type PoolClient } from 'pg';
import { openDatabase } from '../database';

export type DatabaseRow = Record<string, unknown>;
export interface Statement {
  get(...values: SQLInputValue[]): Promise<DatabaseRow | undefined>;
  all(...values: SQLInputValue[]): Promise<DatabaseRow[]>;
  run(...values: SQLInputValue[]): Promise<number>;
}
export interface Database {
  readonly dialect: 'sqlite' | 'postgres';
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function postgresParameters(sql: string): string {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:\"\"|[^"])*"|\?/g, token => token === '?' ? `$${++index}` : token);
}

export function sqliteConnection(connection: DatabaseSync): Database {
  const context = new AsyncLocalStorage<boolean>();
  let tail: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  function schedule<T>(operation: () => Promise<T> | T): Promise<T> {
    if (context.getStore()) return Promise.resolve().then(operation);
    if (closing) return Promise.reject(new Error('The database is closing.'));
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }
  return {
    dialect: 'sqlite',
    prepare(sql) {
      return {
        get: (...values) => schedule(() => connection.prepare(sql).get(...values)),
        all: (...values) => schedule(() => connection.prepare(sql).all(...values)),
        run: (...values) => schedule(() => Number(connection.prepare(sql).run(...values).changes)),
      };
    },
    exec: sql => schedule(() => connection.exec(sql)),
    transaction: operation => context.getStore() ? operation() : schedule(() => context.run(true, async () => {
      connection.exec('BEGIN IMMEDIATE');
      try {
        const result = await operation();
        connection.exec('COMMIT');
        return result;
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    })),
    close() {
      return closing ??= tail.then(() => { connection.close(); });
    },
  };
}

export function postgresConnection(connectionString: string): Database {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  const context = new AsyncLocalStorage<PoolClient>();
  let closing: Promise<void> | undefined;
  pool.on('error', error => console.error('PostgreSQL idle connection failed:', error.name));
  async function query(sql: string, values: SQLInputValue[] = []) {
    const client = context.getStore();
    if (closing && !client) throw new Error('The database is closing.');
    return (client ?? pool).query<DatabaseRow>(postgresParameters(sql), values);
  }
  return {
    dialect: 'postgres',
    prepare(sql) {
      return {
        get: async (...values) => (await query(sql, values)).rows[0],
        all: async (...values) => (await query(sql, values)).rows,
        run: async (...values) => (await query(sql, values)).rowCount ?? 0,
      };
    },
    exec: async sql => { await query(sql); },
    async transaction(operation) {
      if (context.getStore()) return operation();
      if (closing) throw new Error('The database is closing.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await context.run(client, operation);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close() { return closing ??= pool.end(); },
  };
}

export function localConnection(dataDir: string): Database {
  return sqliteConnection(openDatabase(dataDir));
}
