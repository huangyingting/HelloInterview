import { createServer } from 'node:http';

export type FixtureRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  get(name: string): string | undefined;
};

export type FixtureResponse = {
  status(code: number): FixtureResponse;
  json(value: unknown): void;
};

export function createJsonFixtureServer(
  handler: (request: FixtureRequest, response: FixtureResponse) => void | Promise<void>,
) {
  return createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', 'http://fixture.invalid');
    let text = '';
    for await (const chunk of incoming) text += chunk;
    const contentType = incoming.headers['content-type'] ?? '';
    const body: Record<string, unknown> = {};
    if (contentType.startsWith('application/x-www-form-urlencoded')) {
      for (const [key, value] of new URLSearchParams(text)) {
        const tokens = [...key.matchAll(/([^[\]]+)/g)].map(match => match[1]);
        let current: Record<string, unknown> | unknown[] = body;
        for (let index = 0; index < tokens.length; index++) {
          const token = tokens[index];
          const last = index === tokens.length - 1;
          const numeric = Number.isInteger(Number(token)) && Array.isArray(current) ? Number(token) : null;
          if (last) {
            if (numeric === null) (current as Record<string, unknown>)[token] = value;
            else (current as unknown[])[numeric] = value;
            break;
          }
          const nextArray = Number.isInteger(Number(tokens[index + 1]));
          if (numeric === null) {
            const record = current as Record<string, unknown>;
            record[token] ??= nextArray ? [] : {};
            current = record[token] as Record<string, unknown> | unknown[];
          } else {
            const array = current as unknown[];
            array[numeric] ??= nextArray ? [] : {};
            current = array[numeric] as Record<string, unknown> | unknown[];
          }
        }
      }
    }
    let status = 200;
    const response: FixtureResponse = {
      status(code) {
        status = code;
        return response;
      },
      json(value) {
        if (outgoing.writableEnded) return;
        outgoing.writeHead(status, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify(value ?? null));
      },
    };
    try {
      await handler({
        method: incoming.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
        get(name) {
          const value = incoming.headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] : value;
        },
      }, response);
      if (!outgoing.writableEnded) response.json({ error: 'Synthetic fixture produced no response.' });
    } catch (error) {
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      }
      outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Synthetic fixture failed.' }));
    }
  });
}
