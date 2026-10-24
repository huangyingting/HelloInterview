function whole(value: number, minimum: number, maximum: number, name: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be a whole number from ${minimum} to ${maximum}.`);
}

export function capacityEstimate(daily: number, peakFactor: number, payloadBytes: number, replicas: number) {
  whole(daily, 0, 1000000000, 'Daily operations');
  whole(peakFactor, 1, 100, 'Peak factor');
  whole(payloadBytes, 1, 1000000, 'Payload bytes');
  whole(replicas, 1, 10, 'Replicas');
  const average = daily / 86400, peak = average * peakFactor;
  const storedBytes = daily * payloadBytes * replicas * 30;
  if (!Number.isSafeInteger(storedBytes)) throw new RangeError('The stored payload exceeds safe integer precision.');
  return { average, peak, payloadMbps: peak * payloadBytes * 8 / 1000000, storedGB: storedBytes / 1000000000 };
}

export function queueEstimate(arrivals: number, service: number, seconds: number, initial: number) {
  whole(arrivals, 0, 10000, 'Arrivals per second');
  whole(service, 0, 10000, 'Completions per second');
  whole(seconds, 0, 3600, 'Elapsed seconds');
  whole(initial, 0, 1000000, 'Initial backlog');
  const pending = Math.max(0, initial + (arrivals - service) * seconds);
  return { pending, drainSeconds: pending === 0 ? 0 : service > arrivals ? pending / (service - arrivals) : null };
}

export function cachedRead(ttl: number, readAt: number, invalidate: boolean) {
  whole(ttl, 1, 60, 'TTL seconds');
  whole(readAt, 5, 60, 'Read time');
  const hit = !invalidate && readAt < ttl;
  return { hit, returnedVersion: hit ? 1 : 2, authoritativeVersion: 2, stale: hit };
}

export function tokenBucket(capacity: number, refill: number, waited: number, requests: number) {
  whole(capacity, 1, 100, 'Bucket capacity');
  whole(refill, 0, 100, 'Refill per second');
  whole(waited, 0, 60, 'Wait seconds');
  whole(requests, 1, 200, 'Second burst');
  const replenished = Math.min(capacity, refill * waited);
  const accepted = Math.min(replenished, requests);
  return { replenished, accepted, rejected: requests - accepted, remaining: replenished - accepted };
}

export function versionedWrite(current: { version: number; value: string }, expected: number, next: string) {
  whole(current.version, 1, 1000000, 'Current version');
  whole(expected, 1, 1000000, 'Expected version');
  if (!next.trim() || next.length > 100) throw new RangeError('Use a nonempty value of at most 100 characters.');
  if (current.version >= 1000000) throw new RangeError('Reset the bounded version model.');
  return expected === current.version
    ? { accepted: true, state: { version: current.version + 1, value: next } }
    : { accepted: false, state: { ...current } };
}

export function retrievalMetrics(retrieved: readonly string[], relevant: readonly string[]) {
  if (retrieved.length > 100 || relevant.length > 100 || new Set(retrieved).size !== retrieved.length || new Set(relevant).size !== relevant.length)
    throw new RangeError('Use at most 100 unique retrieved and relevant identities.');
  if ([...retrieved, ...relevant].some(id => !id)) throw new RangeError('Evidence IDs must be nonempty.');
  const truth = new Set(relevant), hits = retrieved.filter(id => truth.has(id)).length;
  const first = retrieved.findIndex(id => truth.has(id));
  return { hits, precision: retrieved.length ? hits / retrieved.length : null, recall: relevant.length ? hits / relevant.length : null, reciprocalRank: first < 0 ? 0 : 1 / (first + 1) };
}

export function featureAvailability(predictionAt: number, availableAt: readonly number[]) {
  whole(predictionAt, 0, 1000, 'Prediction time');
  if (availableAt.length > 100) throw new RangeError('Use at most 100 feature timestamps.');
  for (const timestamp of availableAt) whole(timestamp, 0, 1000, 'Availability time');
  return availableAt.map(timestamp => timestamp <= predictionAt);
}

export function releaseGate(passed: number, total: number, critical: number, latency: number, limit: number) {
  whole(total, 0, 1000, 'Evaluation cases');
  whole(passed, 0, total, 'Passing cases');
  whole(critical, 0, 1000, 'Critical regressions');
  whole(latency, 0, 60000, 'Measured latency');
  whole(limit, 1, 60000, 'Latency limit');
  return { rate: total ? passed / total : null, allowed: total > 0 && passed / total >= 0.95 && critical === 0 && latency <= limit };
}

export function storyBudget(parts: readonly number[], target: number) {
  if (parts.length !== 4) throw new RangeError('Supply context, action, result, and reflection durations.');
  for (const seconds of parts) whole(seconds, 0, 300, 'Section seconds');
  whole(target, 30, 600, 'Target seconds');
  const total = parts.reduce((sum, seconds) => sum + seconds, 0);
  return { total, remaining: target - total, actionShare: total ? parts[1] / total : null };
}

export function vestingEstimate(annualBase: number, units: number, months: number, assumedPrice: number) {
  whole(annualBase, 0, 1000000, 'Annual base');
  whole(units, 0, 1000000, 'Grant units');
  whole(months, 0, 48, 'Completed months');
  whole(assumedPrice, 0, 1000, 'Hypothetical unit price');
  const vestedUnits = months < 12 ? 0 : units * months / 48;
  return { grossBase: annualBase * months / 12, vestedUnits, hypotheticalEquity: vestedUnits * assumedPrice };
}
