import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Route = {
  file: string;
  segments: string[];
  score: number;
};

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string | string[]>> },
) => Response | Promise<Response>;

async function discover(directory: string, segments: string[] = []): Promise<Route[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const routes: Route[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      routes.push(...await discover(path.join(directory, entry.name), [...segments, entry.name]));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      const score = segments.reduce((value, segment) => value +
        (segment.startsWith('[[...') ? 0 : segment.startsWith('[...') ? 1 : segment.startsWith('[') ? 2 : 3), 0);
      routes.push({ file: path.join(directory, entry.name), segments, score });
    }
  }
  return routes;
}

const routes = discover(path.resolve('app/api')).then(values =>
  values.sort((left, right) => right.score - left.score || right.segments.length - left.segments.length));

function match(route: Route, pathname: string) {
  const values = pathname.split('/').filter(Boolean);
  if (values.shift() !== 'api') return null;
  const params: Record<string, string | string[]> = {};
  let index = 0;
  for (const segment of route.segments) {
    const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
    const dynamic = segment.match(/^\[(.+)\]$/);
    if (optionalCatchAll || catchAll) {
      const remaining = values.slice(index);
      if (catchAll && remaining.length === 0) return null;
      params[(optionalCatchAll ?? catchAll)![1]] = remaining;
      index = values.length;
      break;
    }
    if (dynamic) {
      if (index >= values.length) return null;
      params[dynamic[1]] = decodeURIComponent(values[index++]);
      continue;
    }
    if (values[index++] !== segment) return null;
  }
  return index === values.length ? params : null;
}

export async function dispatchNextRoute(request: Request) {
  const pathname = new URL(request.url).pathname;
  for (const route of await routes) {
    const params = match(route, pathname);
    if (!params) continue;
    const module = await import(pathToFileURL(route.file).href) as Record<string, RouteHandler | undefined>;
    const handler = module[request.method];
    if (!handler) return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: Object.keys(module).filter(key => /^[A-Z]+$/.test(key)).join(', ') },
    });
    return handler(request, { params: Promise.resolve(params) });
  }
  return new Response(JSON.stringify({ error: 'Not found.' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
