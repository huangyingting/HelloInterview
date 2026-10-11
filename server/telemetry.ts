import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';

export function requestTelemetry(enabled: boolean): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID(), started = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    let logged = false;
    const completed = () => {
      if (!enabled || logged) return;
      logged = true;
      const matched: unknown = req.route?.path;
      console.log(JSON.stringify({
        event: 'request.completed', requestId, method: req.method,
        route: typeof matched === 'string' ? matched : req.path.startsWith('/api/') ? 'unmatched-api' : 'frontend',
        status: res.writableFinished ? res.statusCode : 499, durationMs: Math.round((performance.now() - started) * 100) / 100,
      }));
    };
    res.once('finish', completed);
    res.once('close', completed);
    next();
  };
}
