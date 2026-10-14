import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { fieldScreens, navigationTypes, normalizeWebVital, webVitalNames, webVitalRating } from '../shared/web-vitals';
import { HttpError } from './http-error';

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

const fieldMetricSchema = z.strictObject({
  metric: z.enum(webVitalNames),
  value: z.number().finite().nonnegative(),
  screen: z.enum(fieldScreens),
  navigation: z.enum(navigationTypes),
});

export function fieldMetricTelemetry(): RequestHandler {
  const limits = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    const parsed = fieldMetricSchema.safeParse(req.body);
    if (!parsed.success) return next(new HttpError(400, 'Invalid field performance metric.'));
    const key = req.ip || 'unknown', now = Date.now(), previous = limits.get(key);
    const current = previous && previous.until > now ? { ...previous, count: previous.count + 1 } : { count: 1, until: now + 60000 };
    limits.set(key, current);
    if (limits.size > 1000) for (const [address, limit] of limits) if (limit.until <= now) limits.delete(address);
    if (current.count > 60) return next(new HttpError(429, 'Field performance metric rate limit exceeded.'));
    const value = normalizeWebVital(parsed.data.metric, parsed.data.value);
    if (value === null) return next(new HttpError(400, 'Invalid field performance metric.'));
    console.log(JSON.stringify({
      event: 'web_vital.observed', metric: parsed.data.metric, value,
      rating: webVitalRating(parsed.data.metric, parsed.data.value),
      screen: parsed.data.screen, navigation: parsed.data.navigation,
    }));
    res.status(204).end();
  };
}
