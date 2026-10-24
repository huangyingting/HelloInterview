import type { AlgorithmExperimentKind } from './types';

export interface TraceFrame { title: string; values: string[]; detail: string }
export interface AlgorithmExperiment { input: string; frames: TraceFrame[]; output: string; note: string }
export const algorithmFixtureLabels: Record<AlgorithmExperimentKind, [string, string, string]> = {
  'pair-oracle': ['Several candidates', 'Empty input', 'One occurrence cannot pair with itself'],
  growth: ['n = 4', 'n = 0', 'n = 16'],
  frequency: ['Mixed frequencies', 'Empty input', 'All equal values'],
  prefix: ['Mixed values', 'Empty range', 'Repeated values'],
  intervals: ['Overlapping spans', 'Touching endpoints', 'No intervals'],
  stack: ['Mixed heights', 'Empty input', 'Equal heights'],
  reverse: ['Several nodes', 'Empty chain', 'Equal values, distinct nodes'],
  heap: ['Mixed priorities', 'Empty input', 'Repeated priorities'],
  tree: ['Multiple levels', 'Empty tree', 'A right-only chain'],
  'weighted-graph': ['Cheaper two-edge route', 'Unreachable destination', 'Zero-weight edge'],
  topological: ['Release dependencies', 'Cycle plus isolated vertex', 'Independent vertices'],
  'union-find': ['One component merge twice', 'Duplicate and self links', 'No vertices'],
  subsets: ['Three distinct positions', 'Empty input', 'Equal values, distinct positions'],
  'sequence-dp': ['Equality extends a sequence', 'Empty input', 'All equal values'],
  greedy: ['Long early interval loses', 'Touching endpoints', 'No intervals'],
  trie: ['Prefix ca', 'Missing prefix z', 'Empty prefix'],
  'flood-fill': ['Diagonal contact only', 'One connected region', 'Empty grid'],
  bits: ['13 (binary 1101)', 'Zero', '255 (eight set bits)'],
  oracle: ['Typical pair', 'Empty input', 'Self-pair counterexample'],
};

export function algorithmExperiment(kind: AlgorithmExperimentKind, fixture: number): AlgorithmExperiment {
  if (!Object.hasOwn(algorithmFixtureLabels, kind) || !Number.isInteger(fixture) || fixture < 0 || fixture > 2)
    throw new RangeError('Choose a known algorithm and fixture 0, 1, or 2.');
  const frames: TraceFrame[] = [];
  const frame = (title: string, values: (number | string | null)[], detail: string) => frames.push({ title, values: values.map(value => value === null ? 'unresolved' : String(value)), detail });
  const numbers = fixture === 0 ? [3, 1, 2, 2] : fixture === 1 ? [] : [2, 2, 2];
  const done = (input: unknown, output: unknown, note: string): AlgorithmExperiment => {
    if (!frames.length) frame('Empty input', [], 'No element is processed; return the result defined for the empty input.');
    return { input: JSON.stringify(input), frames, output: JSON.stringify(output), note };
  };
  switch (kind) {
    case 'pair-oracle':
    case 'oracle': {
      const values = fixture === 0 ? [1, 3, 2] : fixture === 1 ? [] : [2], target = 4;
      let exists = false;
      for (let left = 0; left < values.length; left++) for (let right = left + 1; right < values.length; right++) {
        const matches = values[left] + values[right] === target;
        exists ||= matches;
        frame(`Positions ${left} and ${right}`, [values[left], values[right]], `${values[left]} + ${values[right]} ${matches ? '=' : '≠'} ${target}. Distinct positions are required.`);
      }
      if (kind === 'oracle') {
        const set = new Set(values), buggy = values.some(value => set.has(target - value));
        frame('Compare a deliberately flawed candidate', [`Oracle: ${exists}`, `Candidate: ${buggy}`], buggy === exists ? 'These results agree on this fixture; agreement is not a proof for every allowed input.' : 'The candidate reuses the only position as its own partner. This fixture exposes the contract violation.');
        return done({ values, target }, { oracle: exists, buggy, agrees: exists === buggy }, 'The flawed candidate is intentional. The oracle enumerates position pairs, not unique values.');
      }
      return done({ values, target }, exists, 'Quadratic enumeration is a bounded reference, not the optimized implementation.');
    }
    case 'growth': {
      const n = [4, 0, 16][fixture];
      frame('One visit per item', [n], 'A single full scan visits n items under this illustrative operation model.');
      frame('Every unordered position pair', [n * (n - 1) / 2], 'Two distinct positions produce n(n−1)/2 unordered pairs.');
      frame('Every include/exclude subset', [2 ** n], 'Each position contributes two choices; an empty input still has the empty subset.');
      return done({ n }, { scan: n, pairs: n * (n - 1) / 2, subsets: 2 ** n }, 'Counts illustrate growth, not wall-clock timing, implementation overhead, or a benchmark.');
    }
    case 'frequency': {
      const counts = new Map<number, number>();
      for (const value of numbers) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
        frame(`Read ${value}`, [...counts].map(([key, count]) => `${key}: ${count}`), 'Counts now describe exactly the processed prefix. Ranking happens after aggregation.');
      }
      return done(numbers, [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]), 'Return [value,count] entries ordered by descending count, then ascending numeric value.');
    }
    case 'prefix': {
      const values = fixture === 0 ? [3, -1, 2, 4] : numbers, prefix = [0];
      frame('Empty prefix', prefix, 'prefix[0] = 0; prefix[i] sums the first i values.');
      for (const value of values) {
        prefix.push(prefix.at(-1)! + value);
        frame(`Append ${value}`, prefix, 'Add this value to the previous prefix; input values are not mutated.');
      }
      const left = values.length ? 1 : 0, right = Math.min(3, values.length), sum = prefix[right] - prefix[left];
      frame(`Query [${left}, ${right})`, [sum], `Subtract prefix[${left}] from prefix[${right}]. An empty range sums to zero.`);
      return done({ values, left, right }, sum, 'Ranges are left-inclusive and right-exclusive; exact numeric totals stay within safe bounds here.');
    }
    case 'intervals':
    case 'greedy': {
      const intervals = kind === 'greedy'
        ? fixture === 0 ? [[0, 5], [1, 2], [2, 3], [3, 4]] : fixture === 1 ? [[1, 3], [3, 5]] : []
        : fixture === 0 ? [[1, 3], [2, 4], [6, 8]] : fixture === 1 ? [[1, 3], [3, 5]] : [];
      const ordered = intervals.map(pair => [...pair]).sort((a, b) => kind === 'greedy' ? a[1] - b[1] || a[0] - b[0] : a[0] - b[0] || a[1] - b[1]);
      const result: number[][] = [];
      for (const [start, end] of ordered) {
        const previous = result.at(-1);
        if (kind === 'greedy') {
          const accepted = !previous || start >= previous[1];
          if (accepted) result.push([start, end]);
          frame(`${accepted ? 'Choose' : 'Skip'} [${start}, ${end})`, result.map(pair => `[${pair[0]}, ${pair[1]})`), 'Earliest finish maximizes count for this unweighted compatibility contract; touching endpoints are allowed.');
        } else {
          if (previous && start < previous[1]) previous[1] = Math.max(previous[1], end);
          else result.push([start, end]);
          frame(`Inspect [${start}, ${end})`, result.map(pair => `[${pair[0]}, ${pair[1]})`), 'Merge strict overlaps only. Adjacent half-open intervals remain separate under this contract.');
        }
      }
      return done(intervals, result, kind === 'greedy' ? 'This optimizes the number of intervals, not arbitrary weighted rewards.' : 'Merging adjacent spans would be a different, explicitly chosen policy.');
    }
    case 'stack': {
      const stack: number[] = [], output: (number | null)[] = numbers.map(() => null);
      numbers.forEach((value, index) => {
        while (stack.length && numbers[stack.at(-1)!] < value) output[stack.pop()!] = value;
        stack.push(index);
        frame(`Read position ${index}: ${value}`, output, `Unresolved stack positions: ${stack.join(', ')}. Equal values do not resolve strictly-greater queries.`);
      });
      return done(numbers, output, 'null means no strictly greater value exists to the right. Each position is pushed and popped at most once.');
    }
    case 'reverse': {
      const next: (number | null)[] = numbers.map((_, index) => index + 1 < numbers.length ? index + 1 : null);
      let current: number | null = numbers.length ? 0 : null, previous: number | null = null;
      while (current !== null) {
        const following: number | null = next[current];
        next[current] = previous;
        previous = current;
        frame(`Reverse link at node ${current}`, next.map((target, index) => `${index} → ${target === null ? 'null' : target}`), `Completed head: ${previous}; next original node: ${following === null ? 'none' : following}. Save the successor before overwriting a link.`);
        current = following;
      }
      const reversed: number[] = [];
      for (let at = previous; at !== null; at = next[at]) reversed.push(numbers[at]);
      return done(numbers, reversed, 'Node identities are indices. This simulates in-place link updates on a private fixture; it does not change the copy contract of the runnable exercise.');
    }
    case 'heap': {
      const heap: number[] = [], k = 2;
      for (const value of numbers) {
        if (heap.length < k) {
          heap.push(value);
          let at = heap.length - 1;
          while (at > 0) {
            const parent = Math.floor((at - 1) / 2);
            if (heap[parent] <= heap[at]) break;
            [heap[parent], heap[at]] = [heap[at], heap[parent]]; at = parent;
          }
        } else if (value > heap[0]) {
          heap[0] = value;
          let at = 0;
          while (at * 2 + 1 < heap.length) {
            let child = at * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
            if (heap[at] <= heap[child]) break;
            [heap[at], heap[child]] = [heap[child], heap[at]]; at = child;
          }
        }
        frame(`Consider ${value}`, heap, 'A min-heap retains at most two largest values; its root is the weakest retained candidate, not a sorted output.');
      }
      return done({ values: numbers, k }, [...heap].sort((a, b) => b - a), 'Heap cells are level-order storage. Sorting the retained values for the return value is a separate operation.');
    }
    case 'tree': {
      const tree = fixture === 0 ? [3, 1, 2, 4, null, 5] : fixture === 1 ? [] : [2, null, 2, null, null, null, 2];
      const queue = tree.length ? [0] : [], sums: number[] = [];
      let head = 0;
      while (head < queue.length) {
        const end = queue.length, level: number[] = [];
        while (head < end) {
          const index = queue[head++]; level.push(tree[index]!);
          for (const child of [index * 2 + 1, index * 2 + 2]) if (child < tree.length && tree[child] !== null) queue.push(child);
        }
        sums.push(level.reduce((sum, value) => sum + value, 0));
        frame(`Level ${sums.length - 1}`, level, `Level sum: ${sums.at(-1)}. Children appended during this level belong to the next frontier.`);
      }
      return done(tree, sums, 'The array is a fixed binary-tree fixture with null gaps. Queue width and longest path depth are different storage bounds.');
    }
    case 'weighted-graph': {
      const edges = fixture === 2 ? [[0, 1, 0], [1, 2, 2], [0, 2, 5], [2, 3, 1]]
        : [[0, 1, 5], [0, 2, 1], [2, 1, 1], ...(fixture === 1 ? [] : [[1, 3, 1], [2, 3, 10]])];
      const distances = [0, Infinity, Infinity, Infinity], visited = new Set<number>();
      while (true) {
        const next = distances.map((distance, vertex) => ({ distance, vertex })).filter(item => !visited.has(item.vertex) && Number.isFinite(item.distance)).sort((a, b) => a.distance - b.distance || a.vertex - b.vertex)[0];
        if (!next) break;
        visited.add(next.vertex);
        for (const [from, to, weight] of edges) if (from === next.vertex) distances[to] = Math.min(distances[to], next.distance + weight);
        frame(`Settle ${String.fromCharCode(65 + next.vertex)}`, distances.map(value => Number.isFinite(value) ? String(value) : 'unreachable'), 'Relax outgoing costs from the smallest tentative distance. All fixture weights are nonnegative.');
      }
      return done({ edges, start: 'A', destination: 'D' }, Number.isFinite(distances[3]) ? distances[3] : null, 'This small Dijkstra model scans tentative distances; it is not a heap-based performance claim. null means unreachable.');
    }
    case 'topological': {
      const n = fixture === 0 ? 4 : 3, edges = fixture === 0 ? [[0, 2], [1, 2], [2, 3]] : fixture === 1 ? [[0, 1], [1, 0]] : [];
      const degree = Array<number>(n).fill(0);
      for (const [, to] of edges) degree[to]++;
      const queue = degree.flatMap((count, vertex) => count === 0 ? [vertex] : []), order: number[] = [];
      for (let head = 0; head < queue.length; head++) {
        const vertex = queue[head]; order.push(vertex);
        for (const [from, to] of edges) if (from === vertex && --degree[to] === 0) queue.push(to);
        frame(`Release ${vertex}`, degree.map((count, id) => `${id}: ${count}`), `Emitted prefix: ${order.join(', ')}. Only zero-indegree vertices enter the ready queue.`);
      }
      frame(order.length === n ? 'Complete order' : 'Cycle blocks completion', order, `${order.length} of ${n} vertices emitted. A partial prefix is not a successful full order.`);
      return done({ vertices: n, edges }, order.length === n ? order : null, 'FIFO readiness is deterministic here, but the algorithm does not promise the lexicographically smallest valid order.');
    }
    case 'union-find': {
      const n = fixture === 2 ? 0 : 4, edges = fixture === 0 ? [[0, 1], [1, 2], [0, 2]] : fixture === 1 ? [[0, 1], [0, 1], [2, 2]] : [];
      const parent = Array.from({ length: n }, (_, index) => index), size = parent.map(() => 1);
      const find = (vertex: number): number => { while (parent[vertex] !== vertex) { parent[vertex] = parent[parent[vertex]]; vertex = parent[vertex]; } return vertex; };
      let count = n;
      for (const [a, b] of edges) {
        let left = find(a), right = find(b);
        const merged = left !== right;
        if (merged) {
          if (size[left] < size[right]) [left, right] = [right, left];
          parent[right] = left; size[left] += size[right]; count--;
        }
        frame(`${merged ? 'Merge' : 'Already connected'} ${a}, ${b}`, parent.map((_, vertex) => `${vertex} → ${find(vertex)}`), `Components: ${count}. Decrement only when distinct roots are joined.`);
      }
      return done({ vertices: n, edges }, count, 'Undirected connectivity only. Duplicate links and self-links do not create new component merges.');
    }
    case 'subsets': {
      const values = fixture === 0 ? [1, 2, 3] : fixture === 1 ? [] : [2, 2], result: number[][] = [], path: number[] = [];
      const visit = (index: number) => {
        if (index === values.length) { result.push([...path]); frame('Record a copied path', path, 'This complete include/exclude decision belongs to distinct input positions; later backtracking must not mutate its stored copy.'); return; }
        visit(index + 1); path.push(values[index]); visit(index + 1); path.pop();
      };
      visit(0);
      return done(values, result, 'Equal values can produce repeated value arrays because positions are distinct. This is not a unique-value-subsets contract.');
    }
    case 'sequence-dp': {
      const dp = numbers.map(() => 1);
      numbers.forEach((value, index) => {
        for (let earlier = 0; earlier < index; earlier++) if (numbers[earlier] <= value) dp[index] = Math.max(dp[index], dp[earlier] + 1);
        frame(`Best ending at ${index}`, dp.slice(0, index + 1), 'Allow an equal predecessor for a nondecreasing subsequence; each state ends exactly at its own position.');
      });
      return done(numbers, dp.length ? Math.max(...dp) : 0, 'Quadratic reference for a longest nondecreasing subsequence. The state definition is different from a strictly increasing subsequence.');
    }
    case 'trie': {
      interface Node { terminal: boolean; children: Map<string, Node> }
      const node = (): Node => ({ terminal: false, children: new Map() }), root = node(), words = ['cache', 'cat', 'car', 'dog'], prefix = ['ca', 'z', ''][fixture];
      for (const word of words) {
        let at = root;
        for (const character of word) { if (!at.children.has(character)) at.children.set(character, node()); at = at.children.get(character)!; }
        at.terminal = true;
      }
      let at: Node | undefined = root;
      for (const character of prefix) {
        at = at?.children.get(character);
        frame(`Follow ${character}`, at ? [...at.children.keys()].sort() : [], at ? `Prefix path exists; complete-word marker: ${at.terminal}.` : 'The prefix path is missing, so no descendant matches.');
      }
      const result: string[] = [];
      const collect = (current: Node, path: string) => {
        if (current.terminal) result.push(path);
        for (const [character, child] of [...current.children].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) collect(child, path + character);
      };
      if (at) collect(at, prefix);
      frame('Enumerate complete descendants', result, 'A path is not a stored word unless its terminal marker is set. The empty prefix begins at the root.');
      return done({ words, prefix }, result, 'Fixture words use lowercase ASCII and explicit lexicographic traversal; this is not a universal locale or Unicode ordering policy.');
    }
    case 'flood-fill': {
      const grid = fixture === 0 ? [[1, 0], [0, 1]] : fixture === 1 ? [[1, 1], [0, 1]] : [], visited = new Set<string>();
      let count = 0;
      for (let row = 0; row < grid.length; row++) for (let column = 0; column < grid[row].length; column++) {
        const key = `${row},${column}`;
        if (!grid[row][column] || visited.has(key)) continue;
        count++; visited.add(key);
        const queue = [[row, column]];
        for (let head = 0; head < queue.length; head++) {
          const [r, c] = queue[head];
          for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
            const identity = `${nr},${nc}`;
            if (grid[nr]?.[nc] === 1 && !visited.has(identity)) { visited.add(identity); queue.push([nr, nc]); }
          }
        }
        frame(`Component ${count}`, [...visited].sort(), 'Only orthogonal land neighbors connect. Mark positions when scheduling them, and never mutate the supplied grid.');
      }
      return done(grid, count, 'Four-neighbor connectivity; diagonal contact does not join components.');
    }
    case 'bits': {
      const input = [13, 0, 255][fixture];
      let value = input, count = 0;
      frame('Initial bits', [value.toString(2).padStart(8, '0')], 'The fixture is deliberately bounded to nonnegative eight-bit values within Number bitwise semantics.');
      while (value) {
        value &= value - 1; count++;
        frame(`Clear bit ${count}`, [value.toString(2).padStart(8, '0')], 'x & (x−1) removes one lowest set bit; count one transition, not the numeric value removed.');
      }
      return done(input, count, 'This bounded demonstration does not support arbitrary-width Number integers or claim BigInt behavior.');
    }
  }
}
