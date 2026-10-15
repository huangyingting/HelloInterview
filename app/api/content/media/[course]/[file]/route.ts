import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaContent } from '../../../../../../server/next/content';
import { routeError } from '../../../../../../server/next/response';

export const dynamic = 'force-dynamic';

function byteRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return undefined;
  const requestedStart = match[1] ? Number(match[1]) : null;
  const requestedEnd = match[2] ? Number(match[2]) : null;
  const start = requestedStart ?? Math.max(0, size - (requestedEnd ?? 0));
  const end = requestedStart === null ? size - 1 : Math.min(requestedEnd ?? size - 1, size - 1);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size
    ? { start, end }
    : undefined;
}

export async function GET(request: Request, context: { params: Promise<{ course: string; file: string }> }) {
  try {
    const { course, file } = await context.params;
    const media = await mediaContent(request, course, file);
    const packagedPrivateMedia = path.join(process.cwd(), 'private-media');
    const folder = media.premium
      ? existsSync(packagedPrivateMedia) ? packagedPrivateMedia : path.join(process.cwd(), 'server', 'media')
      : path.join(process.cwd(), 'public', 'media');
    const body = await readFile(path.join(folder, media.file));
    const range = byteRange(request.headers.get('range'), body.length);
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Type': media.file.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'video/webm',
      'X-Content-Type-Options': 'nosniff',
    });
    if (range === undefined) {
      headers.set('Content-Range', `bytes */${body.length}`);
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set('Content-Length', String(range.end - range.start + 1));
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${body.length}`);
      return new Response(body.subarray(range.start, range.end + 1), { status: 206, headers });
    }
    headers.set('Content-Length', String(body.length));
    return new Response(body, { headers });
  } catch (error) { return routeError(error, 'content.media.failed'); }
}
