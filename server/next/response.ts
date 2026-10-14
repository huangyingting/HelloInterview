import { HttpError } from '../http-error';

export function routeError(error: unknown, event: string) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: { 'Cache-Control': 'private, no-store', ...error.headers },
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

export async function readJson(request: Request, maximum = 16384): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new HttpError(413, 'The request body is too large.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new HttpError(413, 'The request body is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new HttpError(400, 'The request body must contain valid JSON.');
    throw error;
  }
}
