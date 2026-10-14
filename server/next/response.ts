import { HttpError } from '../http-error';

export function routeError(error: unknown, event: string) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  console.error(JSON.stringify({ event, reason: error instanceof Error ? error.name : 'unknown' }));
  return Response.json({ error: 'The Studio could not complete this request.' }, {
    status: 500,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export function queryInput(url: string) {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(url).searchParams) {
    const current = values[key];
    values[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  }
  return values;
}
