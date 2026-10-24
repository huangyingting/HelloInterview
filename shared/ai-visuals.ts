function integer(value: number, minimum: number, maximum: number, name: string) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be a whole number from ${minimum} to ${maximum}.`);
}
function finite(value: number, minimum: number, maximum: number, name: string) {
  if (!Number.isFinite(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be from ${minimum} to ${maximum}.`);
}

export function softmax(logits: readonly number[], temperature = 1): number[] {
  if (!logits.length || logits.length > 64 || logits.some(value => !Number.isFinite(value)))
    throw new RangeError('Use 1-64 finite logits.');
  finite(temperature, 0.05, 5, 'Temperature');
  const maximum = Math.max(...logits);
  const weights = logits.map(value => Math.exp((value - maximum) / temperature));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map(value => value / total);
}

export function causalAttention(scores: readonly (readonly number[])[]): number[][] {
  integer(scores.length, 1, 16, 'Sequence length');
  if (scores.some(row => row.length !== scores.length || row.some(value => !Number.isFinite(value))))
    throw new RangeError('Attention scores must be a square finite matrix.');
  return scores.map((row, query) => [
    ...softmax(row.slice(0, query + 1)), ...Array<number>(row.length - query - 1).fill(0),
  ]);
}

export function samplingDistribution(logits: readonly number[], temperature: number, topK: number, topP: number) {
  const before = softmax(logits, temperature);
  integer(topK, 1, before.length, 'Top k');
  finite(topP, 0.01, 1, 'Top p');
  const ranked = before.map((probability, index) => ({ index, probability }))
    .sort((a, b) => b.probability - a.probability || a.index - b.index).slice(0, topK);
  const topKMass = ranked.reduce((sum, item) => sum + item.probability, 0);
  const selected = new Set<number>();
  let mass = 0;
  for (const item of ranked) {
    if (selected.size && mass >= topP) break;
    selected.add(item.index);
    mass += item.probability / topKMass;
  }
  const retainedMass = before.reduce((sum, value, index) => sum + (selected.has(index) ? value : 0), 0);
  return { before, after: before.map((value, index) => selected.has(index) ? value / retainedMass : 0) };
}

export interface KvShape {
  layers: number; kvHeads: number; headDimension: number; tokens: number; sequences: number; bytesPerElement: number;
}
export function kvCacheBytes(shape: KvShape): number {
  integer(shape.layers, 1, 256, 'Layers');
  integer(shape.kvHeads, 1, 256, 'KV heads');
  integer(shape.headDimension, 1, 512, 'Head dimension');
  integer(shape.tokens, 1, 1048576, 'Cached tokens');
  integer(shape.sequences, 1, 1024, 'Active sequences');
  integer(shape.bytesPerElement, 1, 4, 'Bytes per element');
  const bytes = 2 * shape.layers * shape.kvHeads * shape.headDimension * shape.tokens * shape.sequences * shape.bytesPerElement;
  if (!Number.isSafeInteger(bytes)) throw new RangeError('The KV estimate exceeds safe integer precision.');
  return bytes;
}

export function streamMetrics(queue: number, prefill: number, interval: number, outputTokens: number, deadline: number) {
  finite(queue, 0, 60000, 'Queue milliseconds');
  finite(prefill, 0, 60000, 'Prefill milliseconds');
  finite(interval, 1, 5000, 'Token interval milliseconds');
  integer(outputTokens, 1, 4096, 'Output tokens');
  finite(deadline, 1, 600000, 'Deadline milliseconds');
  const firstToken = queue + prefill;
  const decode = (outputTokens - 1) * interval;
  return { firstToken, decode, total: firstToken + decode, meetsDeadline: firstToken + decode <= deadline };
}

export interface ContextItem { id: string; tokens: number; eligible: boolean }
export function contextBudget(window: number, output: number, instructions: number, history: number, items: readonly ContextItem[]) {
  integer(window, 1, 1048576, 'Context window');
  for (const [name, value] of [['Output reserve', output], ['Instructions', instructions], ['History', history]] as const)
    integer(value, 0, 1048576, name);
  if (items.length > 100) throw new RangeError('Use at most 100 evidence items.');
  const identities = new Set<string>();
  for (const item of items) {
    integer(item.tokens, 0, 1048576, 'Evidence tokens');
    if (!item.id || identities.has(item.id)) throw new RangeError('Evidence IDs must be nonempty and unique.');
    identities.add(item.id);
  }
  const available = window - output - instructions - history;
  let used = 0;
  const selected: string[] = [];
  if (available >= 0) for (const item of items) {
    if (!item.eligible || used + item.tokens > available) continue;
    selected.push(item.id); used += item.tokens;
  }
  return { available, used, selected, remaining: available - used, overcommitted: available < 0 };
}
