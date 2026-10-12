import { z } from 'zod';
import { TerminalJobFailure } from '../jobs';
import { providerId } from './schema';

export type CanonicalRead = <T>(request: () => PromiseLike<T>) => Promise<T>;
export const canonicalPageSchema = z.looseObject({ object: z.literal('list'), has_more: z.boolean(), data: z.array(z.unknown()).max(100) });
export function consistent(value: boolean): asserts value { if (!value) throw new TerminalJobFailure('reconciliation-required'); }
export async function canonicalPages(read: CanonicalRead, first: unknown, next: (cursor: string) => PromiseLike<unknown>) {
  const results: unknown[] = [], ids = new Set<string>();
  let value = first;
  for (let count = 0; count < 5; count++) {
    const page = canonicalPageSchema.parse(value);
    consistent(!page.has_more || page.data.length > 0);
    for (const row of page.data) {
      const id = z.looseObject({ id: providerId }).parse(row).id;
      consistent(!ids.has(id)); ids.add(id); results.push(row);
    }
    if (!page.has_more) return results;
    consistent(count < 4);
    value = await read(() => next(z.looseObject({ id: providerId }).parse(page.data.at(-1)).id));
  }
  throw new TerminalJobFailure('reconciliation-required');
}
