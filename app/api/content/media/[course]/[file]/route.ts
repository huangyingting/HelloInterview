import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaContent } from '../../../../../../server/next/content';
import { routeError } from '../../../../../../server/next/response';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ course: string; file: string }> }) {
  try {
    const { course, file } = await context.params;
    const media = await mediaContent(course, file);
    const folder = media.premium ? path.join(process.cwd(), 'private-media') : path.join(process.cwd(), 'public', 'media');
    const body = await readFile(path.join(folder, media.file));
    return new Response(body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': media.file.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'video/webm',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) { return routeError(error, 'content.media.failed'); }
}
