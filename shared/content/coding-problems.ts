import type { Problem } from '../types';

const starter = 'function solve(input) {\n  return null;\n}';

export const codingProblems: Problem[] = [
  {
    id: 'alg-pair-load', track: 'code', title: 'Pair Two Calibration Weights', difficulty: 'Easy',
    description: 'A lab keeps calibration weights in ascending order. Return whether two different positions can balance a requested load. Input: {values: number[], target: number}; output: boolean. values is nondecreasing, length 0..100000, with integers in [-1000000,1000000]; target is an integer in [-2000000,2000000]. Equal values at different positions are allowed. Empty and singleton lists return false.',
    requirements: ['Use distinct positions, even when values are equal.', 'Exploit the sorted input without sorting or changing it.', 'Handle negative numbers and unattainable targets.', 'Return only a boolean in linear time with constant auxiliary space.'],
    keywords: [['two pointers', 'left', 'right'], ['sorted', 'monotonic', 'eliminate'], ['distinct positions', 'duplicates', 'pair'], ['linear', 'constant space', 'boundary']],
    starter,
    testCases: [
      { input: { values: [], target: 0 }, expected: false, label: 'No weights' },
      { input: { values: [4], target: 8 }, expected: false, label: 'Cannot reuse one position' },
      { input: { values: [4, 4], target: 8 }, expected: true, label: 'Equal weights at distinct positions' },
      { input: { values: [-7, -2, 0, 3, 9], target: 2 }, expected: true, label: 'Negative and positive pair' },
      { input: { values: [-5, -3, 1, 8], target: 0 }, expected: false, label: 'Target lies between attainable sums' },
      { input: { values: [-1000000, 0, 1000000], target: 0 }, expected: true, label: 'Domain endpoints' },
    ],
    solution: {
      sections: [
        { title: 'Narrow the candidate region', body: 'Place one cursor at the smallest weight and another at the largest weight. Their sum tells us which side of the remaining candidate region cannot help. If the sum is below the target, move the left cursor forward. If it is above the target, move the right cursor backward. Equality immediately establishes a valid pair. The loop condition is strict: the left position must remain smaller than the right position. This represents the requirement for two physical weights rather than two reads of one weight. No copy or sorting step is needed because ascending order is part of the input contract. Compare numeric sums directly; converting weights to strings would destroy the ordering information that makes elimination possible.' },
        { title: 'Why elimination preserves an answer', body: 'The invariant is that any pair not yet ruled out has both positions inside the current closed cursor range. Suppose the endpoint sum is too small. Pairing the current left weight with any other remaining weight gives a sum no larger than this endpoint sum, so every pair using that left position fails. Removing it cannot remove a successful pair. The symmetric argument applies when the endpoint sum is too large: every pair using the right position is at least that large. Each movement therefore discards only impossible pairs. When the cursors meet or cross, no pair of distinct remaining positions exists. These arguments depend on nondecreasing order, not strict order, so repeated weights fit the same proof.' },
        { title: 'Edges, numeric safety, and alternatives', body: 'Empty and singleton arrays fail before any array elements are read. Two equal weights may succeed because their indexes are different. Negative weights need no special branch: the monotonic comparison argument is unchanged. Every possible sum lies between negative two million and positive two million, well inside the safe integer range of JavaScript Number. At least one cursor advances on each unsuccessful iteration, giving linear worst case time and constant auxiliary space; the boolean output also has constant size. A nested pair enumeration is useful as a tiny testing oracle but requires quadratic time. A hash based approach would support unsorted input at the cost of storage, while this sorted contract lets us avoid that cost and its hashing assumptions entirely.' },
      ],
      code: `function solve(input) {
  const { values, target } = input;
  let left = 0;
  let right = values.length - 1;
  while (left < right) {
    const sum = values[left] + values[right];
    if (sum === target) return true;
    if (sum < target) left++;
    else right--;
  }
  return false;
}`,
      timeComplexity: 'O(n) worst case, n = values.length.',
      spaceComplexity: 'O(1) auxiliary and output space.',
      lessonIds: ['two-pointers', 'testing-solutions'], sourceIds: ['mit-algorithms', 'js-number'],
    },
  },
  {
    id: 'alg-window-budget', track: 'code', title: 'Keep a Sensor Burst Within Budget', difficulty: 'Medium',
    description: 'A recorder must retain one uninterrupted burst of samples without exceeding a storage budget. Input: {values: number[], budget: number}; output: the longest contiguous length with sum <= budget. values has length 0..100000 and integer entries 0..1000000; budget is an integer 0..100000000000. Empty input returns 0; the empty window is always permitted.',
    requirements: ['Return a length, not a sum or window.', 'Treat zero samples and a zero budget correctly.', 'Use nonnegativity to shrink an over-budget window.', 'Do not mutate samples; use linear time and constant auxiliary space.'],
    keywords: [['sliding window', 'left', 'right'], ['nonnegative', 'monotone', 'budget'], ['running sum', 'shrink', 'contiguous'], ['maximum length', 'zeros', 'empty']],
    starter,
    testCases: [
      { input: { values: [], budget: 0 }, expected: 0, label: 'Empty recording' },
      { input: { values: [6], budget: 5 }, expected: 0, label: 'Every nonempty window too large' },
      { input: { values: [0, 0, 0], budget: 0 }, expected: 3, label: 'Zero cost duplicates' },
      { input: { values: [2, 1, 4, 1, 1], budget: 6 }, expected: 3, label: 'Several competing windows' },
      { input: { values: [1, 1, 9, 1, 1, 1], budget: 3 }, expected: 3, label: 'Large value splits feasible runs' },
      { input: { values: [1000000, 1000000], budget: 2000000 }, expected: 2, label: 'Exact budget equality' },
    ],
    solution: {
      sections: [
        { title: 'Maintain one feasible suffix', body: 'Scan samples from left to right while maintaining the sum of a contiguous window. Add the newly visited sample to that sum. If the window now exceeds the budget, repeatedly remove its leftmost sample and advance the left boundary. Once feasible, compare its length with the best length observed so far. A sample larger than the budget can make the window empty; the same shrinking loop handles this without a special reset. Zero samples deserve attention because removing them may not reduce the sum, but advancing the boundary still makes progress. The nonnegative domain is essential. With negative costs, removing an earlier positive sample might throw away a longer feasible interval that a later negative sample could rescue.' },
        { title: 'The earliest feasible boundary wins', body: 'After shrinking, the maintained window is the longest feasible window ending at the current right boundary. Earlier left boundaries were discarded only when their sums were too large. Since all future additions are nonnegative, a discarded boundary cannot become feasible at a later right endpoint. Within the current endpoint, each removed prefix is also too expensive, so the first boundary reached by the loop is the earliest acceptable one. This is the central invariant that converts a local suffix calculation into a global optimum. Every contiguous interval has some right endpoint. Considering the longest feasible interval at each endpoint therefore includes an interval at least as long as any possible optimum, while never counting an interval over budget.' },
        { title: 'Amortized work and adversarial checks', body: 'The right cursor visits each position once. The left cursor only moves forward and removes each position at most once, so the nested while loop does not make the algorithm quadratic. The combined work is linear, auxiliary storage is constant, and the returned number uses constant output space. The largest running sum is at most one hundred billion, safely representable as an integer in Number. Empty input returns the initial best length zero. All zeros with a zero budget retain the entire recording; all positive samples above budget leave only empty windows. For independent verification, enumerate all starts and ends on short arrays and sum directly. Include a large separator between two cheap runs to detect implementations that accidentally count noncontiguous samples.' },
      ],
      code: `function solve(input) {
  let left = 0;
  let sum = 0;
  let best = 0;
  for (let right = 0; right < input.values.length; right++) {
    sum += input.values[right];
    while (sum > input.budget) sum -= input.values[left++];
    best = Math.max(best, right - left + 1);
  }
  return best;
}`,
      timeComplexity: 'O(n), amortized across both cursors.',
      spaceComplexity: 'O(1) auxiliary and output space.',
      lessonIds: ['sliding-window', 'complexity'], sourceIds: ['mit-algorithms', 'js-number'],
    },
  },
  {
    id: 'alg-prefix-queries', track: 'code', title: 'Read Totals From a Signed Ledger', difficulty: 'Easy',
    description: 'An analyst asks many inclusive range totals from an immutable ledger. Input: {values: number[], queries: [number, number][]}; output: sums in query order. values has length 0..100000 with integer entries in [-1000000,1000000]; queries has length 0..100000 and each [l,r] satisfies 0 <= l <= r < values.length. Empty values permits only empty queries. No other inputs are valid.',
    requirements: ['Interpret both query endpoints as inclusive.', 'Preserve query order and repeated queries.', 'Build a reusable prefix table without changing either input array.', 'Answer each query in constant time after linear preprocessing.'],
    keywords: [['prefix sum', 'cumulative', 'sentinel'], ['inclusive', 'range', 'off by one'], ['negative', 'safe integer', 'subtraction'], ['preprocessing', 'queries', 'immutable']],
    starter,
    testCases: [
      { input: { values: [], queries: [] }, expected: [], label: 'Empty ledger and no queries' },
      { input: { values: [8], queries: [[0, 0]] }, expected: [8], label: 'Singleton inclusive range' },
      { input: { values: [2, -3, 5, 0], queries: [[0, 3], [1, 2], [3, 3]] }, expected: [4, 2, 0], label: 'Signed totals and last position' },
      { input: { values: [4, 4, 4], queries: [[0, 1], [0, 1], [1, 2]] }, expected: [8, 8, 8], label: 'Repeated entries and queries' },
      { input: { values: [-1000000, -1000000, 1000000], queries: [[0, 2], [0, 1]] }, expected: [-1000000, -2000000], label: 'Large negative prefix' },
      { input: { values: [9, -9], queries: [] }, expected: [], label: 'Nonempty ledger without questions' },
    ],
    solution: {
      sections: [
        { title: 'Index prefixes by boundary, not element', body: 'Create a prefix array with one more entry than the ledger. Entry zero is zero, representing the empty prefix. For each ledger index i, store the sum through that position at prefix index i plus one. This boundary convention makes a query from l through r equal to prefix at r plus one minus prefix at l. It also avoids a special branch for queries beginning at zero. Allocate a separate result array and append answers in the order queries arrive. Neither the ledger nor the nested query pairs need modification. The extra sentinel is a deliberate modeling choice: ledger positions describe entries, whereas prefix positions describe cuts between entries, including the two outer cuts.' },
        { title: 'Cancellation gives exact inclusive sums', body: 'The prefix invariant says that prefix at boundary b is the sum of exactly the entries with indexes smaller than b. It holds at boundary zero because there are no earlier entries, and adding the next ledger value maintains it inductively. In a query, the prefix at r plus one contains all entries from zero through r. The prefix at l contains precisely the unwanted entries preceding l. Subtraction cancels that common segment and leaves the requested inclusive range. This proof does not require positive entries, so negative balances and zeros are handled identically. Repeated ranges yield repeated answers because each query is a pure lookup against the same completed table, with no destructive accumulation between queries.' },
        { title: 'Costs and contract boundaries', body: 'For n entries and q queries, building the table takes linear time in n and answering queries takes linear time in q, giving total time proportional to their sum. Auxiliary space is linear in n for the prefix table, while output space is linear in q and should be counted separately. Under the declared bounds, every prefix and every range sum has magnitude at most one hundred billion, below the safe integer limit. Empty values with empty queries produce an empty answer array; the contract intentionally excludes an index into an empty ledger. Directly summing each queried range is a useful oracle but can require n times q work. A mutable ledger would call for a different structure, such as a tree of partial sums.' },
      ],
      code: `function solve(input) {
  const prefix = [0];
  for (const value of input.values) prefix.push(prefix[prefix.length - 1] + value);
  return input.queries.map(([left, right]) => prefix[right + 1] - prefix[left]);
}`,
      timeComplexity: 'O(n + q), n entries and q queries.',
      spaceComplexity: 'O(n) auxiliary; O(q) output.',
      lessonIds: ['prefix-sum', 'arrays-hashing'], sourceIds: ['mit-algorithms', 'js-number'],
    },
  },
  {
    id: 'alg-merge-slots', track: 'code', title: 'Consolidate Observatory Access Windows', difficulty: 'Medium',
    description: 'Combine overlapping or touching observatory access windows into a canonical union. Input: {intervals: [number, number][]}; output: merged [start,end] pairs sorted by start. There are 0..100000 intervals; endpoints are integers in [-1000000,1000000] and start <= end. Intervals are closed, so touching endpoints merge. Zero-length intervals and duplicates are valid. Return new pairs without changing nested input.',
    requirements: ['Sort numerically by start with a deterministic end tie break.', 'Merge overlaps, containment, and touching endpoints.', 'Preserve isolated zero-length intervals.', 'Copy interval pairs before sorting and return an independent union.'],
    keywords: [['intervals', 'union', 'overlap'], ['touching', 'closed', 'endpoint'], ['sort', 'numeric comparator', 'copy'], ['sweep', 'invariant', 'containment']],
    starter,
    testCases: [
      { input: { intervals: [] }, expected: [], label: 'No access windows' },
      { input: { intervals: [[3, 3]] }, expected: [[3, 3]], label: 'Isolated point window' },
      { input: { intervals: [[5, 7], [1, 3], [3, 5]] }, expected: [[1, 7]], label: 'Unsorted touching chain' },
      { input: { intervals: [[1, 9], [2, 4], [1, 9]] }, expected: [[1, 9]], label: 'Containment and duplicate windows' },
      { input: { intervals: [[8, 10], [-4, -1], [1, 2]] }, expected: [[-4, -1], [1, 2], [8, 10]], label: 'Separated signed windows' },
      { input: { intervals: [[0, 0], [0, 2], [2, 2], [4, 4]] }, expected: [[0, 2], [4, 4]], label: 'Points touching a longer window' },
    ],
    solution: {
      sections: [
        { title: 'Sort copies, then sweep', body: 'First copy every interval pair into a new array and sort that array by numeric start, using numeric end as a tie breaker. A shallow copy of only the outer array would protect sorting order but would not protect endpoints if we later extended an interval. Copying each pair prevents that subtle mutation. Sweep from earliest start to latest start while keeping a result array. Compare the next interval with the last result pair. If the next start is no greater than the last end, extend that end to the larger of the two ends. Otherwise append a new pair. Using no greater than, instead of strictly less than, encodes the stated rule that touching closed windows are connected.' },
        { title: 'Only the last union can change', body: 'After each sweep step, the result is the sorted union of all intervals already processed, with a strict gap between adjacent result pairs. Earlier result pairs cannot overlap a newly arriving interval: their ends are below the start of the final result pair, and every new start is at least that final pair start. Thus only the final pair can need extension. If the new start lies within that pair or at its endpoint, their union remains a single closed interval. Taking the larger end also handles complete containment without shrinking coverage. If the new start is beyond the end, there is a genuine uncovered gap that requires a separate result pair. These facts maintain the invariant until all original windows have been represented.' },
        { title: 'Sorting assumptions and boundary behavior', body: 'An empty collection produces an empty union. A point window stays a point unless another window reaches its coordinate. Duplicate intervals add no coverage, and negative endpoints remain ordinary numeric values. Comparators must subtract numeric endpoints rather than rely on the default string ordering. Under a comparison sort model, time is O(n log n) and the sweep is O(n); JavaScript does not mandate an Array.sort time or workspace bound. More precisely, the implementation costs the runtime sort time plus a linear pass and uses a linear copied array plus its sort workspace. Output holds at most n pairs. A pairwise merging approach can be much slower and harder to prove, because repeatedly extending one interval may create new overlaps elsewhere in an unsorted collection.' },
      ],
      code: `function solve(input) {
  const ordered = input.intervals.map(([start, end]) => [start, end]);
  ordered.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const result = [];
  for (const [start, end] of ordered) {
    const last = result[result.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}`,
      timeComplexity: 'T_sort(n) + O(n); O(n log n) under a comparison-sort model, not an ECMAScript guarantee.',
      spaceComplexity: 'O(n) auxiliary copies + S_sort(n) runtime workspace; O(m) output for m merged intervals.',
      lessonIds: ['intervals', 'complexity'], sourceIds: ['mit-algorithms', 'js-sort'],
    },
  },
  {
    id: 'alg-balanced-signals', track: 'code', title: 'Validate Nested Control Signals', difficulty: 'Easy',
    description: 'A compact controller emits opening and closing bracket signals. Input: {signals: string}; output: whether every opener closes with its matching kind in properly nested order. signals contains only ASCII characters ()[]{} and has length 0..100000. Empty signals is valid and returns true. This is bracket validation, not parsing arbitrary text.',
    requirements: ['Enforce matching bracket kinds and nesting order.', 'Reject unmatched closers and leftover openers.', 'Accept empty input and sequential balanced groups.', 'Use a stack without changing the input string.'],
    keywords: [['stack', 'push', 'pop'], ['nesting', 'LIFO', 'matching'], ['opening', 'closing', 'brackets'], ['empty', 'invariant', 'linear']],
    starter,
    testCases: [
      { input: { signals: '' }, expected: true, label: 'Empty signal stream' },
      { input: { signals: '(' }, expected: false, label: 'Unclosed opener' },
      { input: { signals: ']' }, expected: false, label: 'Closing without an opener' },
      { input: { signals: '([]{}){}' }, expected: true, label: 'Nested and sequential groups' },
      { input: { signals: '([)]' }, expected: false, label: 'Counts match but nesting crosses' },
      { input: { signals: '((()))[[]]{{}}' }, expected: true, label: 'Repeated bracket kinds' },
    ],
    solution: {
      sections: [
        { title: 'Remember the expected closers', body: 'A stack records what must close next. On an opening parenthesis, square bracket, or brace, push its corresponding closing character. On a closing character, pop the stack and require equality. A mismatch fails immediately, including the case where the stack was empty and pop returned undefined. At the end, accept only an empty stack. Recording expected closers rather than opening characters makes the comparison direct and keeps the mapping local to the opener branches. The domain promises bracket characters only, so the final branch can treat every other allowed character as a closer. It is not a fallback parser for arbitrary text; adding letters to the valid domain would require an explicit policy and a changed implementation.' },
        { title: 'Nesting is a last-in first-out rule', body: 'After processing any accepted prefix, the stack lists exactly the unmatched opening obligations, with the most recently opened group at the top. Opening a group adds one new obligation above older obligations. Closing a group must satisfy that newest obligation before any earlier one, which is precisely proper nesting. Matching and popping preserves the invariant. A mismatching closer cannot be repaired by a later character, since it already closed the wrong group. Finishing with obligations still present means some group never closed. Conversely, when every closer has matched and the final stack is empty, each opener has exactly one corresponding closer in the required order. Counting bracket types alone would miss crossed groups, so it cannot establish this invariant.' },
        { title: 'Depth, early exits, and testing', body: 'Each character performs a constant amount of work, so time is linear in stream length, with early termination possible on a mismatch. Auxiliary space is proportional to the maximum nesting depth, which can equal the entire length for a stream of opening brackets. The output is one boolean and therefore constant space. Empty input begins and ends with an empty stack and is accepted naturally. A single opener fails at the final check, whereas a single closer fails immediately. Repeated groups such as several nested parentheses exercise depth rather than alphabet variety. For robust examples, contrast balanced sequential groups with crossing groups that have identical character counts. No recursion is required, avoiding a call stack limit even for deeply nested valid signals.' },
      ],
      code: `function solve(input) {
  const stack = [];
  for (const signal of input.signals) {
    if (signal === '(') stack.push(')');
    else if (signal === '[') stack.push(']');
    else if (signal === '{') stack.push('}');
    else if (stack.pop() !== signal) return false;
  }
  return stack.length === 0;
}`,
      timeComplexity: 'O(n), n = signals.length.',
      spaceComplexity: 'O(d) auxiliary for maximum nesting depth d; O(1) output.',
      lessonIds: ['stacks', 'testing-solutions'], sourceIds: ['nist-algorithms'],
    },
  },
  {
    id: 'alg-next-higher', track: 'code', title: 'Locate the Next Stronger Reading', difficulty: 'Medium',
    description: 'For each sensor reading, find the first later reading that is strictly higher. Input: {values: number[]}; output: an array of the same length containing those values, or null where none exists. There are 0..100000 integer readings in [-1000000,1000000]. Equal readings do not count as higher, and the result contains values, not distances or indexes.',
    requirements: ['Find the first qualifying position to the right.', 'Use strict comparison so equal readings remain unresolved.', 'Return null for each unresolved position.', 'Use a monotonic stack and preserve the original readings.'],
    keywords: [['monotonic stack', 'indexes', 'pending'], ['strictly greater', 'duplicates', 'comparison'], ['next', 'right', 'first'], ['amortized', 'linear', 'null']],
    starter,
    testCases: [
      { input: { values: [] }, expected: [], label: 'Empty readings' },
      { input: { values: [7] }, expected: [null], label: 'Singleton has no later reading' },
      { input: { values: [2, 2, 3] }, expected: [3, 3, null], label: 'Equal readings wait together' },
      { input: { values: [9, 7, 5, 1] }, expected: [null, null, null, null], label: 'Descending adversary' },
      { input: { values: [-4, -2, -3, 0] }, expected: [-2, 0, 0, null], label: 'First later higher, not largest' },
      { input: { values: [1, 4, 2, 3, 5] }, expected: [4, 5, 3, 5, null], label: 'One reading resolves several positions' },
    ],
    solution: {
      sections: [
        { title: 'Keep unresolved positions in order', body: 'Initialize every answer to null, then scan readings from left to right. A stack holds indexes whose next higher reading has not yet arrived. Before pushing the current index, compare its value with the value at the top pending index. While the current value is strictly larger, pop that index and write the current value into its answer slot. Continue because one strong reading can resolve several weaker pending readings. Then push the current index as another unresolved position. Storing indexes rather than just values preserves the correct output location when duplicate values occur. The comparison must remain strict: an equal reading is not a solution and therefore leaves the earlier index waiting beneath the new one.' },
        { title: 'Why the first resolution is the nearest', body: 'Pending values are nonincreasing from the bottom of the stack to its top. If a new value cannot exceed the top value, it cannot exceed any value below that top either. If it does exceed the top, resolving and removing that top exposes the next possible candidate. Every pending index has survived all intermediate readings without encountering a strictly higher one, because any such reading would already have popped it. Thus the reading that finally pops an index is the first qualifying reading to its right, not merely some qualifying reading. Pushing the current index after resolutions restores the monotonic order. Indexes left pending at the end have no later qualifying value and correctly retain their initialized null answers.' },
        { title: 'Linear work despite the inner loop', body: 'Every reading index enters the stack once and leaves it at most once. Counting those events across the entire scan bounds total stack work by a linear number, even when a final large reading empties a long stack. Time is O(n), auxiliary stack space is O(n) in a descending or equal sequence, and output space is separately O(n). Empty input produces an empty result, and a singleton produces one null. Negative values work because only ordinary numeric order matters. A brute force oracle can scan rightward from each position until the first greater value appears, requiring quadratic worst case time on descending data. That adversary is especially useful for distinguishing the reference stack strategy from a superficially correct but inefficient nested scan.' },
      ],
      code: `function solve(input) {
  const result = Array(input.values.length).fill(null);
  const pending = [];
  for (let i = 0; i < input.values.length; i++) {
    while (pending.length && input.values[pending[pending.length - 1]] < input.values[i]) {
      result[pending.pop()] = input.values[i];
    }
    pending.push(i);
  }
  return result;
}`,
      timeComplexity: 'O(n) amortized.',
      spaceComplexity: 'O(n) auxiliary stack; O(n) output.',
      lessonIds: ['stacks', 'complexity'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-chain-reverse', track: 'code', title: 'Rebuild a Dispatch Chain Backward', difficulty: 'Easy',
    description: 'A dispatcher needs a backward copy of a saved chain, while the original remains available. Input: {head: Node | null}, where Node is exactly {value: number, next: Node | null}; output: the reversed head in the same shape. The acyclic chain has 0..1000 nodes with integer values in [-1000000,1000000]. Return newly allocated nodes, including for a singleton; null returns null.',
    requirements: ['Reverse node order rather than merely negating values.', 'Allocate new nodes and never rewire the original chain.', 'Preserve duplicate values and explicit null termination.', 'Use an iterative traversal with constant non-output workspace.'],
    keywords: [['linked list', 'head', 'next'], ['reverse', 'prepend', 'traversal'], ['immutable', 'new nodes', 'aliasing'], ['iterative', 'null', 'duplicates']],
    starter,
    testCases: [
      { input: { head: null }, expected: null, label: 'Null chain' },
      { input: { head: { value: 5, next: null } }, expected: { value: 5, next: null }, label: 'Singleton must still be copied' },
      { input: { head: { value: 1, next: { value: 2, next: null } } }, expected: { value: 2, next: { value: 1, next: null } }, label: 'Two-node direction' },
      { input: { head: { value: 3, next: { value: 3, next: { value: 8, next: null } } } }, expected: { value: 8, next: { value: 3, next: { value: 3, next: null } } }, label: 'Duplicate nodes remain distinct' },
      { input: { head: { value: -1, next: { value: 0, next: { value: 4, next: null } } } }, expected: { value: 4, next: { value: 0, next: { value: -1, next: null } } }, label: 'Signed values and zero' },
      { input: { head: { value: 1000000, next: { value: -1000000, next: null } } }, expected: { value: -1000000, next: { value: 1000000, next: null } }, label: 'Value bounds are preserved' },
    ],
    solution: {
      sections: [
        { title: 'Prepend a fresh node for each visit', body: 'Traverse the original chain with a cursor and maintain a separate result head, initially null. For every visited node, allocate a new object holding its value and pointing to the current result head. Replace the result head with that new object, then advance the traversal cursor through the original next link. Prepending reverses the order incrementally. Importantly, the cursor follows only original nodes and every result next link points only to another result node. This separation avoids accidental aliasing between the saved chain and the returned chain. The input object itself is not a list node; its head property merely supplies the starting cursor. No writes to that property or to any original next property are necessary.' },
        { title: 'A reversed prefix invariant', body: 'Before each iteration, the result contains a reversed copy of exactly the original nodes already visited. The remaining cursor points to the first unvisited original node. This invariant is true initially because both the visited prefix and the result are empty. Prepending a copy of the next visited value places that value ahead of the reversed earlier prefix, producing the reverse of the newly extended prefix. Advancing the cursor keeps the two portions aligned. At null, every original node has been visited, so the result is the reverse of the entire chain. Equal values do not collapse nodes: each visit performs a distinct allocation. The original null terminator becomes the terminator of the oldest newly created result node.' },
        { title: 'Output allocation is not constant total space', body: 'The loop visits each node once, giving linear time. Only two references are needed apart from newly allocated nodes, so auxiliary workspace excluding the result is constant. The result itself requires linear space; describing this copying reversal as constant total space would be incorrect. A singleton is returned as a fresh object, not the original head, even though its JSON representation is unchanged. Null requires no allocation. The acyclic contract guarantees termination without a visited set. Recursive construction could also work but would add a linear call stack and expose recursion limits unnecessarily. In tests, comparing serialized values establishes order, while checking object identity or mutating the returned copy separately establishes that fresh nodes were actually allocated rather than borrowed from the input.' },
      ],
      code: `function solve(input) {
  let cursor = input.head;
  let result = null;
  while (cursor !== null) {
    result = { value: cursor.value, next: result };
    cursor = cursor.next;
  }
  return result;
}`,
      timeComplexity: 'O(n), n nodes in the chain.',
      spaceComplexity: 'O(1) auxiliary excluding O(n) newly allocated output nodes.',
      lessonIds: ['linked-lists', 'testing-solutions'], sourceIds: ['nist-algorithms'],
    },
  },
  {
    id: 'alg-chain-cycle', track: 'code', title: 'Detect a Loop in an Indexed Handoff Chain', difficulty: 'Medium',
    description: 'A JSON snapshot represents links as indexes, allowing cycles without circular JSON. Input: {values: number[], next: number[], head: number}; output: whether following next from head reaches a cycle. values and next have equal length n in 0..100000; values are integers in [-1000000,1000000]. Each next entry and head is -1 or an index 0..n-1; for n=0 head must be -1. -1 ends traversal. Disconnected cycles do not count.',
    requirements: ['Consider only nodes reachable from head.', 'Treat -1 as termination, never as an array index.', 'Use two cursors with different speeds and constant workspace.', 'Handle self-loops and disconnected nodes without mutating arrays.'],
    keywords: [['cycle', 'reachable', 'self loop'], ['slow fast', 'Floyd', 'two pointers'], ['index links', 'sentinel', 'termination'], ['constant space', 'disconnected', 'invariant']],
    starter,
    testCases: [
      { input: { values: [], next: [], head: -1 }, expected: false, label: 'Empty snapshot' },
      { input: { values: [7], next: [-1], head: 0 }, expected: false, label: 'Single terminal node' },
      { input: { values: [7], next: [0], head: 0 }, expected: true, label: 'Self-loop' },
      { input: { values: [1, 2, 3, 4], next: [1, 2, 3, 1], head: 0 }, expected: true, label: 'Tail enters a cycle' },
      { input: { values: [9, 9, 9], next: [-1, 2, 1], head: 0 }, expected: false, label: 'Disconnected cycle and duplicate values' },
      { input: { values: [1, 2], next: [1, 0], head: -1 }, expected: false, label: 'No reachable nodes despite stored cycle' },
    ],
    solution: {
      sections: [
        { title: 'Walk indexes at two speeds', body: 'The next array is a compact functional graph: each node has exactly one outgoing link or the termination marker. Start slow and fast cursors at head. On each iteration move slow once and fast twice, but check that fast and its next link are not the termination marker before taking those steps. After moving, equal indexes reveal a cycle. Equality must be tested after movement, because both cursors initially share the head even in an acyclic chain. Node values are irrelevant to detection; repeated values do not imply repeated nodes. The integer indexes provide identity. Starting both cursors at head also means unrelated components in the snapshot are never inspected or incorrectly counted as reachable cycles.' },
        { title: 'Meeting inside a cycle is inevitable', body: 'If traversal terminates, the fast cursor eventually encounters the termination marker, causing the loop to stop and return false. If traversal never terminates in a finite set of nodes, some index must recur and the route consists of a finite tail followed by a cycle. Once both cursors are inside that cycle, their relative position changes by one edge each iteration because fast advances one extra edge. Modulo the cycle length, this relative position must eventually become zero. They then meet at the same node index. Conversely, a meeting after positive movement on this deterministic chain means an index is reachable at two different step counts, so repeated traversal cannot terminate before recurring. That establishes both detection and the absence of false positives.' },
        { title: 'Sentinels, identity, and costs', body: 'An empty snapshot or a head of negative one returns false without indexing either array. A one-node self-loop meets on the first iteration, whereas a terminal singleton exits through the guard. The guard prevents reading next at negative one, which would be an unrelated JavaScript property rather than a valid link. Neither values nor links are rewritten. The number of iterations is linear in the reachable tail length plus cycle length, and never exceeds a constant multiple of the total node count. Auxiliary and output space are constant. A visited Set of indexes is an easier alternative to explain and can provide the entry location, but it uses linear auxiliary storage and introduces expected hashing costs that the two-cursor method avoids.' },
      ],
      code: `function solve(input) {
  let slow = input.head;
  let fast = input.head;
  while (fast !== -1 && input.next[fast] !== -1) {
    slow = input.next[slow];
    fast = input.next[input.next[fast]];
    if (slow === fast) return true;
  }
  return false;
}`,
      timeComplexity: 'O(r), r reachable nodes; O(n) worst case.',
      spaceComplexity: 'O(1) auxiliary and output space.',
      lessonIds: ['linked-lists', 'two-pointers'], sourceIds: ['nist-algorithms'],
    },
  },
  {
    id: 'alg-first-threshold', track: 'code', title: 'Find the First Qualifying Meter Reading', difficulty: 'Easy',
    description: 'An ordered archive needs the earliest reading at or above a threshold. Input: {values: number[], threshold: number}; output: the first qualifying index, or values.length if absent. values is nondecreasing, length 0..100000, with integers in [-1000000,1000000]; threshold is an integer in [-2000000,2000000]. Duplicates are valid; empty input returns 0.',
    requirements: ['Return the first qualifying duplicate, not any matching index.', 'Use the length sentinel for absence and empty input.', 'Maintain a half-open binary-search interval.', 'Do not sort or change the already ordered input.'],
    keywords: [['binary search', 'lower bound', 'half open'], ['threshold', 'first', 'duplicates'], ['invariant', 'partition', 'sentinel'], ['logarithmic', 'midpoint', 'sorted']],
    starter,
    testCases: [
      { input: { values: [], threshold: 4 }, expected: 0, label: 'Empty length sentinel' },
      { input: { values: [3], threshold: 3 }, expected: 0, label: 'Singleton equals threshold' },
      { input: { values: [3], threshold: 4 }, expected: 1, label: 'Singleton below threshold' },
      { input: { values: [-5, 2, 2, 2, 9], threshold: 2 }, expected: 1, label: 'First among repeated equal readings' },
      { input: { values: [-8, -2, 4], threshold: -10 }, expected: 0, label: 'Every reading qualifies' },
      { input: { values: [-8, -2, 4, 10], threshold: 5 }, expected: 3, label: 'Threshold falls in a gap' },
    ],
    solution: {
      sections: [
        { title: 'Search for a partition boundary', body: 'The desired answer is the boundary between readings below the threshold and readings at least as large as the threshold. Represent the search interval with left inclusive and right exclusive, initially zero and the array length. Inspect the midpoint using floor on half the interval width. If the midpoint value qualifies, the boundary can be at that midpoint or earlier, so move right to midpoint. Otherwise the midpoint and everything before it fail, so move left to midpoint plus one. Continue until the boundaries coincide and return left. This routine is a lower-bound search rather than a search for equality; a reading larger than the threshold is just as qualifying as an equal reading.' },
        { title: 'The boundary remains enclosed', body: 'Throughout the search, every index strictly before left is known to fail, and every index at or beyond right that exists is known to qualify. Initially those claims are vacuous. Sorted order makes each update preserve them: a failing midpoint implies all smaller positions fail, while a qualifying midpoint implies all larger positions qualify. The unknown partition boundary therefore remains between the two boundaries, including the length sentinel. Because a qualifying midpoint is retained as a possible boundary rather than skipped, duplicates cannot cause a later qualifying position to be returned accidentally. When left equals right, no uncertain indexes remain. The common boundary is the first qualifying position, or the length when the failing partition covers the entire array.' },
        { title: 'Termination and implementation choices', body: 'Each iteration strictly reduces the interval width: either right moves to a midpoint below its old value, or left advances beyond a midpoint at least as large as its old value. Repeated halving yields logarithmic time, with constant auxiliary and output space. Empty input starts with equal boundaries and returns zero immediately. Singleton cases demonstrate both endpoint outcomes. Computing the midpoint from the interval width avoids overflow patterns seen in fixed width integer languages; JavaScript Number safely represents every index in this domain anyway. No bitwise midpoint trick is needed, so there is no hidden signed thirty-two-bit coercion. A linear scan is a straightforward testing oracle but would discard the key benefit of an already sorted archive when the array is large.' },
      ],
      code: `function solve(input) {
  let left = 0;
  let right = input.values.length;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (input.values[middle] >= input.threshold) right = middle;
    else left = middle + 1;
  }
  return left;
}`,
      timeComplexity: 'O(log(n + 1)).',
      spaceComplexity: 'O(1) auxiliary and output space.',
      lessonIds: ['binary-search', 'testing-solutions'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-peak-workload', track: 'code', title: 'Size a Sequential Cargo Shuttle', difficulty: 'Medium',
    description: 'Cargo loads must ship in their listed order, with each day taking a contiguous block and each indivisible load fitting the shuttle. Input: {loads: number[], days: number}; output: the minimum integer daily capacity that ships everything within days. loads has length 0..100000 with integer loads 1..1000000; days is an integer 1..1000000. Days may be unused, including days > loads.length. Empty loads returns 0.',
    requirements: ['Preserve order and never split a load.', 'Use a greedy feasibility check for a proposed capacity.', 'Binary search the minimum feasible integer capacity.', 'Handle empty cargo and excess days without mutating loads.'],
    keywords: [['binary search', 'answer space', 'monotone'], ['capacity', 'feasible', 'days'], ['greedy', 'contiguous', 'partition'], ['safe integer', 'bounds', 'minimum']],
    starter,
    testCases: [
      { input: { loads: [], days: 1 }, expected: 0, label: 'No cargo' },
      { input: { loads: [7], days: 5 }, expected: 7, label: 'Extra days cannot split a load' },
      { input: { loads: [1, 2, 3, 4], days: 1 }, expected: 10, label: 'One day needs the total' },
      { input: { loads: [3, 3, 3, 3], days: 2 }, expected: 6, label: 'Repeated loads fill capacity exactly' },
      { input: { loads: [8, 1, 1, 8], days: 2 }, expected: 9, label: 'Order prevents arbitrary balancing' },
      { input: { loads: [2, 9, 2], days: 10 }, expected: 9, label: 'More days than loads' },
    ],
    solution: {
      sections: [
        { title: 'Separate feasibility from optimization', body: 'For a proposed capacity, simulate shipment by filling the current day until the next load would exceed that capacity. Then start another day and place that load there. Count days rather than constructing partitions. The search lower bound is the largest individual load, since loads cannot split. The upper bound is the sum of all loads, which always works in one day. Binary search this closed integer range: a feasible midpoint moves the upper bound down, while an infeasible midpoint moves the lower bound to midpoint plus one. Compute the largest load with a loop instead of spreading a large array into Math.max, which could exceed argument limits. Empty cargo returns zero before forming the bounds.' },
        { title: 'Greedy feasibility and monotone answers', body: 'At a fixed capacity, greedy packing ends each day at the furthest position reachable from that day start. Any valid schedule can end its first day no later. Inductively, after the same number of days, greedy has shipped at least as many loads as any other valid schedule: starting at least as far along cannot reduce the reachable ending position when all loads are positive. Therefore greedy uses the minimum possible number of days for that capacity. Increasing capacity cannot invalidate a working schedule, so feasibility changes only from false to true across the integer search range. Binary search retains the minimum feasible capacity and converges to it. Allowing unused days means the check is at most the requested number, not exactly that number.' },
        { title: 'Bounds, exact arithmetic, and verification', body: 'One feasibility pass costs linear time in the number of loads. If the initial integer range width is R, binary search needs O(log(R plus one)) passes, with constant auxiliary workspace and a scalar output. All sums are at most one hundred billion, so integer addition and the floored midpoint remain exact in Number. Excess days reduce the answer to the largest load, but never below it. A one-day request yields the total. Equality with capacity must stay within the current day; using greater-than-or-equal for the overflow test would overcount days. For a small independent oracle, enumerate contiguous partition cut positions, compute each partition maximum sum, and minimize over schedules using no more than the allowed days. This checks both optimization and order preservation.' },
      ],
      code: `function solve(input) {
  if (input.loads.length === 0) return 0;
  let low = 0;
  let high = 0;
  for (const load of input.loads) {
    low = Math.max(low, load);
    high += load;
  }
  while (low < high) {
    const capacity = low + Math.floor((high - low) / 2);
    let used = 1;
    let current = 0;
    for (const load of input.loads) {
      if (current + load > capacity) {
        used++;
        current = 0;
      }
      current += load;
    }
    if (used <= input.days) high = capacity;
    else low = capacity + 1;
  }
  return low;
}`,
      timeComplexity: 'O(n log(R + 1)), R = sum(loads) - max(loads); O(1) for empty input.',
      spaceComplexity: 'O(1) auxiliary and output space.',
      lessonIds: ['binary-search', 'greedy'], sourceIds: ['mit-algorithms', 'js-number'],
    },
  },
  {
    id: 'alg-top-priorities', track: 'code', title: 'Retain the Highest Dispatch Priorities', difficulty: 'Medium',
    description: 'A dispatch board has room for only its highest priority entries. Input: {values: number[], k: number}; output: the min(k,values.length) largest values in descending numeric order, retaining duplicate occurrences. values has length 0..100000 with integers in [-1000000,1000000]; k is an integer 0..1000000. Empty values or k=0 returns []. Use a bounded min-heap, not a full input sort.',
    requirements: ['Retain duplicates as separate entries.', 'Keep a min-heap of at most min(k,n) values.', 'Return descending output using heap extraction or a bounded output sort.', 'Do not reorder input; handle k larger than the array length.'],
    keywords: [['min heap', 'sift up', 'sift down'], ['top k', 'bounded', 'selection'], ['duplicates', 'descending', 'numeric'], ['root', 'replacement', 'invariant']],
    starter,
    testCases: [
      { input: { values: [], k: 4 }, expected: [], label: 'Empty priority stream' },
      { input: { values: [8, 2], k: 0 }, expected: [], label: 'No board slots' },
      { input: { values: [5], k: 3 }, expected: [5], label: 'Requested count exceeds available entries' },
      { input: { values: [3, 9, 9, 1, 8], k: 3 }, expected: [9, 9, 8], label: 'Duplicate leaders' },
      { input: { values: [-3, -8, -1, -1], k: 2 }, expected: [-1, -1], label: 'All priorities negative' },
      { input: { values: [1, 2, 3, 4, 5, 6], k: 1 }, expected: [6], label: 'Every later entry replaces the root' },
    ],
    solution: {
      sections: [
        { title: 'Keep only the best bounded candidates', body: 'Let the heap limit be the smaller of k and the number of entries. Return immediately if that limit is zero. Insert incoming values until the heap reaches its limit, sifting each new leaf upward to preserve the min-heap order. Once full, the root is the smallest retained priority. An incoming value no larger than that root cannot improve the selected multiset, so skip it. A larger value replaces the root and is sifted downward. The implementation compares children numerically and swaps toward the smaller child. After scanning, repeatedly remove the minimum and write it from the end of a preallocated result array toward the beginning. This produces descending output without sorting the original input or the heap.' },
        { title: 'Selection and heap order are separate invariants', body: 'The heap order invariant ensures each parent is no greater than its children, so its root exposes the weakest retained entry. The selection invariant says that after any prefix, the heap contains the largest limit entries of that prefix, or all entries when the prefix is shorter. Insertion establishes this while filling. Once full, replacing the weakest entry with a stronger newcomer produces exactly the best multiset for the extended prefix. Ignoring an equal newcomer is safe because occurrences of the same numeric value are interchangeable, while the heap still retains the required number of occurrences. Sift operations change positions only, not the chosen multiset. Extraction subsequently orders that already selected multiset without affecting the correctness of which priorities were retained.' },
        { title: 'Costs depend on the retained count', body: 'For n entries and h equal to min(k,n), scanning costs O(n log(h plus one)) in the worst case and extraction costs O(h log(h plus one)). Since h does not exceed n, their sum has the same stated bound for nonempty output. Heap storage is O(h) auxiliary space and the returned array separately uses O(h) output space. When h is one, all heap maintenance is constant work per entry. With h zero, the early return is constant time. Negative priorities require no alternate handling. A full descending sort can serve as a small test oracle, but presenting that as a heap solution would conceal its different storage and work profile. Ascending arrivals are a useful adversary because every later value can force replacement.' },
      ],
      code: `function solve(input) {
  const limit = Math.min(input.k, input.values.length);
  if (limit === 0) return [];
  const heap = [];
  function down(index) {
    while (2 * index + 1 < heap.length) {
      let child = 2 * index + 1;
      if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
      if (heap[index] <= heap[child]) break;
      [heap[index], heap[child]] = [heap[child], heap[index]];
      index = child;
    }
  }
  for (const value of input.values) {
    if (heap.length < limit) {
      heap.push(value);
      let index = heap.length - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (heap[parent] <= heap[index]) break;
        [heap[parent], heap[index]] = [heap[index], heap[parent]];
        index = parent;
      }
    } else if (value > heap[0]) {
      heap[0] = value;
      down(0);
    }
  }
  const result = Array(limit);
  for (let index = limit - 1; index >= 0; index--) {
    result[index] = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      down(0);
    }
  }
  return result;
}`,
      timeComplexity: 'O(n log(h + 1)), h = min(k,n) > 0; O(1) when h = 0.',
      spaceComplexity: 'O(h) auxiliary heap; O(h) output.',
      lessonIds: ['heaps', 'complexity'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-tree-depth', track: 'code', title: 'Measure a Branching Review Hierarchy', difficulty: 'Easy',
    description: 'A review hierarchy is a binary tree. Input: {root: Node | null}, where Node is exactly {value: number, left: Node | null, right: Node | null}; output: maximum depth measured in nodes, so a leaf has depth 1 and an empty tree has depth 0. The finite acyclic tree has 0..100000 distinct nodes, depth at most 1000, and integer values in [-1000000,1000000]. No shared child nodes occur.',
    requirements: ['Measure node count along the longest root-to-leaf path.', 'Handle null children and a null root.', 'Traverse iteratively without altering tree nodes.', 'Do not confuse node values with depths.'],
    keywords: [['tree', 'depth', 'root to leaf'], ['DFS', 'stack', 'iterative'], ['null', 'leaf', 'node count'], ['height', 'invariant', 'immutable']],
    starter,
    testCases: [
      { input: { root: null }, expected: 0, label: 'Empty hierarchy' },
      { input: { root: { value: 42, left: null, right: null } }, expected: 1, label: 'One node counts as depth one' },
      { input: { root: { value: 1, left: { value: 1, left: null, right: null }, right: { value: 1, left: null, right: null } } }, expected: 2, label: 'Equal-valued sibling leaves' },
      { input: { root: { value: 0, left: { value: -2, left: { value: 8, left: null, right: null }, right: null }, right: null } }, expected: 3, label: 'Left-only chain' },
      { input: { root: { value: 4, left: null, right: { value: 3, left: null, right: { value: 2, left: null, right: null } } } }, expected: 3, label: 'Right-only chain' },
      { input: { root: { value: 6, left: { value: 7, left: null, right: null }, right: { value: 8, left: { value: 9, left: null, right: { value: 10, left: null, right: null } }, right: null } } }, expected: 4, label: 'Deeper branch is not the first branch' },
    ],
    solution: {
      sections: [
        { title: 'Carry depth with each pending node', body: 'If the root is null, return zero immediately. Otherwise place the root and depth one on an explicit traversal stack. Repeatedly remove one pending pair, compare its depth with the largest depth seen, and push each nonnull child with depth increased by one. Either child visitation order is acceptable because the result is a maximum rather than a traversal listing. Tracking depth alongside each node is clearer than trying to infer it from the number of processed nodes or the current stack length. Values are deliberately ignored: a negative value or a repeated value changes neither connectivity nor depth. An explicit stack gives direct control of traversal storage and does not depend on JavaScript recursive call capacity.' },
        { title: 'Every stored depth names a real path', body: 'The traversal invariant is that each pending pair contains a node and the exact number of nodes on its path from the root. It holds for the initial root pair. If a parent has depth d, its child path extends that unique parent path by one node, so assigning depth d plus one preserves the invariant. Since the structure is a tree with no shared children, each node is pushed and removed exactly once. Updating the maximum on every visit therefore considers all real root-to-node paths. A deepest node is necessarily a leaf, because an existing child would have greater depth. Consequently the maximum visited depth equals the longest root-to-leaf path requested by the contract, including asymmetric trees.' },
        { title: 'Height space and boundary conventions', body: 'Visiting n nodes takes O(n) time. In a binary depth-first traversal, the pending stack contains at most a constant number of entries per active path level, so auxiliary space is O(h) for height h, not necessarily O(n) for every shape. The scalar output is constant space. A chain may have height n but almost no pending sibling entries; O(h) remains a correct worst case bound. Empty trees return zero and leaves return one because depth is measured in nodes rather than edges. A recursive maximum of the two child depths plus one is a useful alternative explanation, but its call stack also uses O(h) and can overflow on less tightly bounded input. Neither method needs sorting, arithmetic on values, or a visited set under the declared tree contract.' },
      ],
      code: `function solve(input) {
  if (input.root === null) return 0;
  const stack = [[input.root, 1]];
  let maximum = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    maximum = Math.max(maximum, depth);
    if (node.left !== null) stack.push([node.left, depth + 1]);
    if (node.right !== null) stack.push([node.right, depth + 1]);
  }
  return maximum;
}`,
      timeComplexity: 'O(n), n tree nodes.',
      spaceComplexity: 'O(h) auxiliary DFS stack for tree height h; O(1) output.',
      lessonIds: ['trees', 'stacks'], sourceIds: ['nist-algorithms'],
    },
  },
  {
    id: 'alg-level-sums', track: 'code', title: 'Total Budgets by Review Level', difficulty: 'Medium',
    description: 'A binary review tree assigns a signed budget to every node. Input: {root: Node | null}, with Node exactly {value: number, left: Node | null, right: Node | null}; output: sums for successive levels, starting at the root. The finite acyclic tree has 0..100000 distinct nodes, depth at most 1000, no shared children, and integer values in [-1000000,1000000]. Empty root returns [].',
    requirements: ['Group nodes by their distance from the root.', 'Keep signed values and duplicate values in the totals.', 'Use a queue head index rather than repeated Array.shift.', 'Return sums without writing to the input tree.'],
    keywords: [['BFS', 'queue', 'head index'], ['level', 'frontier', 'sum'], ['tree', 'signed values', 'null'], ['linear', 'safe integer', 'boundary']],
    starter,
    testCases: [
      { input: { root: null }, expected: [], label: 'Empty budget tree' },
      { input: { root: { value: -5, left: null, right: null } }, expected: [-5], label: 'Negative root alone' },
      { input: { root: { value: 2, left: { value: 3, left: null, right: null }, right: { value: 4, left: null, right: null } } }, expected: [2, 7], label: 'Sibling sum' },
      { input: { root: { value: 1, left: { value: 1, left: { value: 1, left: null, right: null }, right: null }, right: { value: 1, left: null, right: null } } }, expected: [1, 2, 1], label: 'Duplicates on uneven levels' },
      { input: { root: { value: 0, left: { value: -8, left: null, right: null }, right: { value: 8, left: null, right: { value: -2, left: null, right: null } } } }, expected: [0, 0, -2], label: 'Cancellation preserves a zero level' },
      { input: { root: { value: 1000000, left: { value: 1000000, left: null, right: null }, right: { value: 1000000, left: null, right: null } } }, expected: [1000000, 2000000], label: 'Large exact sums' },
    ],
    solution: {
      sections: [
        { title: 'Freeze the end of each level', body: 'Breadth-first traversal naturally groups tree nodes by level. Start a queue containing the root and a head index of zero. Before processing a level, capture the current queue length as an exclusive end boundary. Read queue entries while head is below that boundary, adding their values and appending their nonnull children. Newly appended children lie beyond the captured boundary, so they belong to the next level rather than the current sum. Append the completed sum and repeat until head reaches the queue length. Keeping a head index avoids repeatedly shifting all remaining array elements. This particular queue retains processed references, a detail that matters when stating its memory usage rather than claiming only frontier storage.' },
        { title: 'Queue order separates generations', body: 'At the beginning of every outer iteration, all unprocessed queue entries belong to one tree level. This holds initially for the root. Processing those entries appends only their children, all of which are exactly one level deeper. Since the existing level boundary was frozen first, none of those children can enter the current total. When the current entries are exhausted, the remaining suffix is precisely the next level, maintaining the invariant. Each node has one parent in the declared tree, so it is appended once and contributes to exactly one sum. Null children append nothing. Signed values may cancel, but that does not erase a level: output is determined by tree structure, not by whether its sum happens to be zero.' },
        { title: 'Actual queue storage and numeric bounds', body: 'Each node is enqueued and read once, giving O(n) time. Although the live frontier might be much narrower, this append-only array keeps all visited entries and therefore uses O(n) auxiliary storage. The result has one number per level, using O(h) output space for height h. A queue implementation that reclaims consumed slots could instead bound live storage by width, but that is not what this reference code does. Empty root returns an empty list, while a singleton returns its signed value. Any level sum has magnitude at most one hundred billion under the node and value bounds, so Number arithmetic stays exact. A depth-first alternative could accumulate into a level-indexed array, but would need explicit depth bookkeeping and a different auxiliary stack analysis.' },
      ],
      code: `function solve(input) {
  if (input.root === null) return [];
  const queue = [input.root];
  const result = [];
  let head = 0;
  while (head < queue.length) {
    const end = queue.length;
    let sum = 0;
    while (head < end) {
      const node = queue[head++];
      sum += node.value;
      if (node.left !== null) queue.push(node.left);
      if (node.right !== null) queue.push(node.right);
    }
    result.push(sum);
  }
  return result;
}`,
      timeComplexity: 'O(n), n tree nodes.',
      spaceComplexity: 'O(n) auxiliary append-only queue; O(h) output for h levels.',
      lessonIds: ['trees', 'graph-search'], sourceIds: ['mit-algorithms', 'js-number'],
    },
  },
  {
    id: 'alg-network-route', track: 'code', title: 'Count Hops Through a Relay Network', difficulty: 'Medium',
    description: 'Find the fewest directed relay hops between two stations. Input: {vertices: number, edges: [number, number][], start: number, goal: number}; output: minimum hop count, or -1 when unreachable. vertices is an integer 1..100000, identifying stations 0..vertices-1; edges has length 0..200000, each [from,to] uses valid station indexes. start and goal are valid indexes. Self-loops and repeated directed edges are allowed. start=goal returns 0.',
    requirements: ['Respect edge direction and count edges, not visited vertices.', 'Use breadth-first search for the shortest unweighted route.', 'Mark a station visited when enqueuing it.', 'Handle self-loops, duplicate edges, and unreachable destinations without mutation.'],
    keywords: [['BFS', 'shortest path', 'unweighted'], ['directed', 'adjacency list', 'edges'], ['distance', 'visited', 'enqueue'], ['unreachable', 'self loop', 'duplicates']],
    starter,
    testCases: [
      { input: { vertices: 1, edges: [], start: 0, goal: 0 }, expected: 0, label: 'Already at destination' },
      { input: { vertices: 2, edges: [], start: 0, goal: 1 }, expected: -1, label: 'No route' },
      { input: { vertices: 2, edges: [[1, 0]], start: 0, goal: 1 }, expected: -1, label: 'Reverse edge is not usable' },
      { input: { vertices: 4, edges: [[0, 1], [1, 2], [2, 3], [0, 3]], start: 0, goal: 3 }, expected: 1, label: 'Shortcut beats a longer chain' },
      { input: { vertices: 4, edges: [[0, 0], [0, 1], [0, 1], [1, 2], [2, 1], [2, 3]], start: 0, goal: 3 }, expected: 3, label: 'Loops and duplicate edges' },
      { input: { vertices: 5, edges: [[3, 4], [4, 2], [0, 1]], start: 3, goal: 2 }, expected: 2, label: 'Nonzero start and disconnected component' },
    ],
    solution: {
      sections: [
        { title: 'Build outgoing neighbors and expand layers', body: 'Construct a fresh adjacency array with one neighbor list per station. For every directed edge, append only its destination to its source list. Initialize all distances to negative one, assign distance zero to start, and enqueue start. Read the queue with a head index. For each outgoing neighbor not yet discovered, assign the current station distance plus one and enqueue that neighbor. The goal can be returned when removed from the queue, because its first discovery already determines its shortest distance. Start equal to goal returns zero immediately, even without building adjacency. All writes go to local arrays. The input edge pairs are read but never sorted, reversed, or marked with traversal state.' },
        { title: 'First discovery certifies minimum hops', body: 'The breadth-first queue processes stations in nondecreasing distance order. Initially it contains only distance zero. Removing a station at distance d appends undiscovered neighbors at distance d plus one behind all previously discovered entries. Thus no distance d plus two station can be processed before the remaining distance d plus one stations. Suppose a neighbor had a shorter route than its assigned distance. Its predecessor on that shorter route would have been processed earlier and would already have discovered it, contradicting its undiscovered status. Marking distance at enqueue time prevents duplicate edges or converging routes from adding repeated queue entries. Self-loops find an already discovered station and have no effect. This establishes minimum edge counts even in cyclic directed graphs.' },
        { title: 'Unreachable results and graph-sized work', body: 'If the queue empties without reaching goal, every station reachable from start has been expanded, so returning negative one is justified. Station labels are numeric identities, not array values to compare by content. Building adjacency costs O(V plus E), and traversal reads each reachable adjacency entry at most once, giving the same worst case time bound overall. The adjacency structure, distance array, and append-only queue use O(V plus E) auxiliary space; the scalar output is constant. A depth-first search can establish reachability but does not generally produce minimum hops without additional work. For an independent oracle on small graphs, repeatedly relax edge distances or use a matrix shortest-path computation. Include reversed one-way edges to catch accidental conversion to an undirected graph.' },
      ],
      code: `function solve(input) {
  if (input.start === input.goal) return 0;
  const adjacent = Array.from({ length: input.vertices }, () => []);
  for (const [from, to] of input.edges) adjacent[from].push(to);
  const distance = Array(input.vertices).fill(-1);
  distance[input.start] = 0;
  const queue = [input.start];
  let head = 0;
  while (head < queue.length) {
    const vertex = queue[head++];
    if (vertex === input.goal) return distance[vertex];
    for (const next of adjacent[vertex]) {
      if (distance[next] !== -1) continue;
      distance[next] = distance[vertex] + 1;
      queue.push(next);
    }
  }
  return -1;
}`,
      timeComplexity: 'O(V + E) worst case; O(1) when start = goal.',
      spaceComplexity: 'O(V + E) auxiliary; O(1) output.',
      lessonIds: ['graph-search', 'graphs'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-release-order', track: 'code', title: 'Publish Modules in the Smallest Valid Order', difficulty: 'Hard',
    description: 'Modules have numeric indexes and directed prerequisite edges. Input: {vertices: number, edges: [number, number][]}; an edge [a,b] requires a before b. Output: the numerically lexicographically smallest topological ordering, always selecting the smallest currently available index, or [] if any cycle exists. vertices is an integer 0..100000, indexes are 0..vertices-1; edges has length 0..200000 with valid indexes. Duplicate edges and self-loops are allowed; an empty graph returns [].',
    requirements: ['Track incoming prerequisite counts including repeated edge occurrences.', 'Use a min-heap to select the smallest currently available index.', 'Return all vertices only for an acyclic graph; discard partial order on cycles.', 'Preserve all input edges and include isolated vertices.'],
    keywords: [['topological sort', 'indegree', 'Kahn'], ['min heap', 'lexicographic', 'available'], ['cycle', 'prerequisite', 'DAG'], ['isolated', 'duplicates', 'adjacency']],
    starter,
    testCases: [
      { input: { vertices: 0, edges: [] }, expected: [], label: 'Empty graph' },
      { input: { vertices: 1, edges: [] }, expected: [0], label: 'Single available module' },
      { input: { vertices: 4, edges: [[0, 2], [1, 2]] }, expected: [0, 1, 2, 3], label: 'New smaller candidate beats an older larger candidate' },
      { input: { vertices: 3, edges: [[2, 1], [1, 0]] }, expected: [2, 1, 0], label: 'Prerequisites override label order' },
      { input: { vertices: 3, edges: [[0, 1], [0, 1]] }, expected: [0, 1, 2], label: 'Repeated prerequisites counted consistently' },
      { input: { vertices: 3, edges: [[0, 1], [1, 0]] }, expected: [], label: 'Cycle discards an isolated partial result' },
      { input: { vertices: 1, edges: [[0, 0]] }, expected: [], label: 'Self prerequisite is a cycle' },
    ],
    solution: {
      sections: [
        { title: 'Schedule only zero-indegree modules', body: 'Build outgoing adjacency lists and count every incoming edge. A module is available when its remaining incoming count is zero. Insert all initially available indexes into a min-heap. Repeatedly extract the smallest available index, append it to the order, and decrement the counts of its outgoing neighbors. Insert a neighbor exactly when its count becomes zero. Heap insertion sifts upward; removing the root moves the final leaf to the root and sifts toward the smaller child. This supplies the minimum available index without sorting the entire frontier after each release. Count duplicate edge occurrences in both adjacency and indegree so their increments and decrements balance. No prerequisite count is stored in the original edges or module input.' },
        { title: 'Why greedy choice is lexicographically optimal', body: 'Every next module in a valid topological order must have no remaining predecessor among unscheduled modules. Conversely, any zero-indegree module can be chosen next without violating a prerequisite. Therefore all valid continuations share the same set of legal next choices represented by the heap. Choosing the smallest index makes the earliest possible differing position no larger than any other valid continuation. Applying this argument after each choice proves numeric lexicographic minimality inductively. For cycle detection, if unscheduled modules remain but the heap is empty, their remaining graph has no zero-indegree vertex and must contain a cycle. The result length reveals this condition even when isolated modules were already scheduled. Returning an empty array rather than that partial prefix honors the all-or-nothing contract.' },
        { title: 'Heap costs and ambiguous empty results', body: 'Each vertex enters and leaves the heap at most once. Each edge is examined once during construction and once during decrementing. Time is O(E plus V log(V plus one)), with no language-specific sorting assumptions because this implementation performs explicit heap operations. Auxiliary adjacency, counts, and heap storage total O(V plus E); output is O(V) for a valid ordering. A cyclic graph and an empty graph both return an empty array by definition, not because the algorithm silently repairs invalid input. Self-loops are valid graph inputs that necessarily produce the cycle result. A queue-based version would compute some topological order but could miss the smallest order when a newly available low index should precede an older high index. Tiny exhaustive permutation checks can independently validate both feasibility and lexicographic choice.' },
      ],
      code: `function solve(input) {
  const adjacent = Array.from({ length: input.vertices }, () => []);
  const incoming = Array(input.vertices).fill(0);
  for (const [from, to] of input.edges) {
    adjacent[from].push(to);
    incoming[to]++;
  }
  const heap = [];
  function push(value) {
    heap.push(value);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent] <= heap[index]) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  }
  function pop() {
    const value = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let index = 0;
      while (2 * index + 1 < heap.length) {
        let child = 2 * index + 1;
        if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
        if (heap[index] <= heap[child]) break;
        [heap[index], heap[child]] = [heap[child], heap[index]];
        index = child;
      }
    }
    return value;
  }
  for (let vertex = 0; vertex < input.vertices; vertex++) {
    if (incoming[vertex] === 0) push(vertex);
  }
  const order = [];
  while (heap.length) {
    const vertex = pop();
    order.push(vertex);
    for (const next of adjacent[vertex]) {
      incoming[next]--;
      if (incoming[next] === 0) push(next);
    }
  }
  return order.length === input.vertices ? order : [];
}`,
      timeComplexity: 'O(E + V log(V + 1)).',
      spaceComplexity: 'O(V + E) auxiliary; O(V) successful output, O(1) returned cycle output.',
      lessonIds: ['topological-sort', 'heaps', 'graphs'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-cluster-count', track: 'code', title: 'Count Connected Field Teams', difficulty: 'Medium',
    description: 'Undirected links join field stations into communication clusters. Input: {vertices: number, edges: [number, number][]}; output: component count, including isolated stations. vertices is an integer 0..100000, labeling stations 0..vertices-1; edges has length 0..200000 with valid indexes. Self-links and duplicate links are permitted; empty vertices implies empty edges and returns 0.',
    requirements: ['Count isolated vertices as components.', 'Use union-find with path compression and union by size.', 'Reduce the count only when joining different components.', 'Treat edge direction as irrelevant and preserve input.'],
    keywords: [['union find', 'disjoint set', 'component'], ['path compression', 'root', 'find'], ['union by size', 'merge', 'inverse Ackermann'], ['isolated', 'undirected', 'duplicates']],
    starter,
    testCases: [
      { input: { vertices: 0, edges: [] }, expected: 0, label: 'Empty field' },
      { input: { vertices: 1, edges: [] }, expected: 1, label: 'One isolated station' },
      { input: { vertices: 5, edges: [] }, expected: 5, label: 'All stations isolated' },
      { input: { vertices: 5, edges: [[0, 1], [1, 2], [3, 4]] }, expected: 2, label: 'Two connected teams' },
      { input: { vertices: 3, edges: [[0, 0], [0, 1], [1, 0], [0, 1]] }, expected: 2, label: 'Repeated and self links do not overmerge' },
      { input: { vertices: 4, edges: [[0, 1], [2, 3], [1, 2], [3, 0]] }, expected: 1, label: 'Bridge joins two existing groups' },
    ],
    solution: {
      sections: [
        { title: 'Begin with one set per station', body: 'Allocate a parent array where every station is its own root, a size array initialized to one, and a component counter initialized to the number of vertices. For each link, find the roots of its endpoints. If those roots already match, the link changes nothing. Otherwise attach the smaller root tree under the larger one, update the larger size, and decrement the component counter. The find operation first walks to a root and then walks the original path again, redirecting its parent pointers to that root. This two-pass compression is iterative and writes only to the local parent array, not to the input edge representation. Adjacency lists are unnecessary because the task asks connectivity rather than routes.' },
        { title: 'Sets represent exactly processed connectivity', body: 'After any processed edge prefix, two stations share a union-find root exactly when they are connected by links in that prefix. Initially every singleton is its own connected component. A new link between stations already sharing a root introduces no new connectivity relation. A link between distinct roots connects those entire two groups, so one union and one counter decrement describe precisely the new component structure. The orientation chosen for the parent link does not change membership, which is why union by size can optimize performance without changing results. Path compression likewise changes only how membership is represented. At the end, the counter equals the graph component count. Self-links and repeated links fit the already-connected case and cannot reduce the count again.' },
        { title: 'Amortized bounds and isolated vertices', body: 'Initialization costs O(V). With path compression and union by size, the sequence of find and union operations takes O(E times alpha(V)) amortized time, where alpha is the extremely slow-growing inverse Ackermann function. This is not a claim that each individual find is always constant. Total auxiliary storage is O(V) for parents and sizes, and output storage is constant. Isolated stations never participate in a successful union and therefore remain counted. Zero stations yield zero naturally. A traversal-based component count is a reasonable alternative with O(V plus E) time and adjacency storage, but union-find can process the edge list directly. Small random tests can compare against a separate flood-fill over an undirected adjacency graph, especially with duplicate links and bridges between previously formed components.' },
      ],
      code: `function solve(input) {
  const parent = Array.from({ length: input.vertices }, (_, index) => index);
  const size = Array(input.vertices).fill(1);
  let components = input.vertices;
  function find(vertex) {
    let root = vertex;
    while (parent[root] !== root) root = parent[root];
    while (parent[vertex] !== vertex) {
      const next = parent[vertex];
      parent[vertex] = root;
      vertex = next;
    }
    return root;
  }
  for (const [from, to] of input.edges) {
    let first = find(from);
    let second = find(to);
    if (first === second) continue;
    if (size[first] < size[second]) [first, second] = [second, first];
    parent[second] = first;
    size[first] += size[second];
    components--;
  }
  return components;
}`,
      timeComplexity: 'O(V + E alpha(max(1,V))) amortized with compression and union by size.',
      spaceComplexity: 'O(V) auxiliary; O(1) output.',
      lessonIds: ['union-find', 'graphs'], sourceIds: ['mit-algorithms', 'nist-algorithms'],
    },
  },
  {
    id: 'alg-subset-loads', track: 'code', title: 'List Every Optional Cargo Bundle', difficulty: 'Medium',
    description: 'An expedition may choose any subset of distinct optional cargo labels. Input: {values: number[]}; output: all subsets, each internally ascending and the outer array in numeric lexicographic order, with a shorter prefix before its extensions. values has length 0..15, distinct integers in [-1000000,1000000], in any order. Empty input returns [[]]. Include the empty subset first and do not change the input.',
    requirements: ['Include every subset exactly once, including the empty subset.', 'Sort a copy numerically before enumerating.', 'Emit a prefix before recursing into its extensions.', 'Copy the active path into output so later backtracking does not alter results.'],
    keywords: [['backtracking', 'DFS', 'subsets'], ['lexicographic', 'prefix first', 'sorted copy'], ['push pop', 'snapshot', 'distinct'], ['exponential', 'output space', 'recursion']],
    starter,
    testCases: [
      { input: { values: [] }, expected: [[]], label: 'Empty set has one subset' },
      { input: { values: [5] }, expected: [[], [5]], label: 'One optional item' },
      { input: { values: [2, 1] }, expected: [[], [1], [1, 2], [2]], label: 'Unsorted labels' },
      { input: { values: [0, -2] }, expected: [[], [-2], [-2, 0], [0]], label: 'Negative numeric order' },
      { input: { values: [3, 1, 2] }, expected: [[], [1], [1, 2], [1, 2, 3], [1, 3], [2], [2, 3], [3]], label: 'Prefix precedes longer extension' },
      { input: { values: [10, 2] }, expected: [[], [2], [2, 10], [10]], label: 'Numeric order differs from string order' },
    ],
    solution: {
      sections: [
        { title: 'Traverse a tree of increasing prefixes', body: 'Sort a fresh copy of the distinct labels with a numeric comparator. Maintain a mutable local path and a recursive visit function accepting the first index still eligible for selection. On entry, append a copy of the path to the result. Then try each eligible index in ascending order: push its value, recurse with the following index, and pop on return. Emitting on entry ensures a shorter prefix appears before all its extensions. Requiring later indexes for extensions keeps each path internally sorted and prevents permutations of the same subset. The empty initial path is emitted by the first call, so no separate empty-subset patch is needed. Only the local path is mutated; neither the original values nor stored output paths are changed.' },
        { title: 'Unique subsets and natural lexicographic order', body: 'Every subset of distinct sorted labels corresponds to exactly one increasing sequence of indexes. At each recursive level the algorithm chooses the next index from all allowable later positions, so every such sequence is reached and none is reached twice. For ordering, descendants of a path share that path as a prefix and are emitted after the prefix itself. Between two different next choices, all subsets using the smaller next label appear before any using the larger next label. This matches numeric lexicographic comparison at the first differing position. These local ordering properties combine over the recursion tree to establish the outer order without an additional output sort. Distinctness is a contract condition; permitting repeated labels would require a separate decision about duplicate subsets.' },
        { title: 'The result dominates the cost', body: 'There are two to the n subsets, and copying all their elements costs Theta(n times two to the n) for positive n. That same quantity describes the total output element storage, in addition to one array header per subset. The sorted input copy, active path, and recursion stack require O(n) auxiliary storage, plus the runtime sorting workspace. JavaScript does not guarantee Array.sort complexity; its runtime sort cost is added to the enumeration cost, commonly O(n log n) under a comparison-sort model. At n zero, one empty array still exists, so a general bound can use O((n plus one) times two to the n). The bound of fifteen labels keeps enumeration deliberate and finite. A bitmask oracle followed by an explicit numeric lexicographic sort independently checks both coverage and order.' },
      ],
      code: `function solve(input) {
  const values = [...input.values].sort((a, b) => a - b);
  const result = [];
  const path = [];
  function visit(start) {
    result.push([...path]);
    for (let index = start; index < values.length; index++) {
      path.push(values[index]);
      visit(index + 1);
      path.pop();
    }
  }
  visit(0);
  return result;
}`,
      timeComplexity: 'T_sort(n) + O((n + 1) 2^n), including path copies; comparison-sort model adds O(n log n).',
      spaceComplexity: 'O(n) auxiliary path, sorted copy, and recursive stack + S_sort(n); O((n + 1) 2^n) output.',
      lessonIds: ['backtracking', 'complexity'], sourceIds: ['mit-algorithms', 'js-sort'],
    },
  },
  {
    id: 'alg-min-coins', track: 'code', title: 'Buy an Exact Transit Credit Pack', difficulty: 'Medium',
    description: 'A transit kiosk sells unlimited packs of specified positive credit sizes. Input: {denominations: number[], target: number}; output: the fewest packs totaling target, or -1 if impossible. denominations has length 0..1000, integer values 1..1000000, with duplicates allowed; target is an integer 0..10000. target=0 returns 0, including with no denominations. Packs cannot be split and no overpayment is allowed.',
    requirements: ['Find a minimum count, not the first reachable count.', 'Allow each denomination an unlimited number of times.', 'Define impossible positive targets as -1 and zero target as 0.', 'Use amount-based dynamic programming without mutating denominations.'],
    keywords: [['dynamic programming', 'amount', 'minimum'], ['unbounded', 'coins', 'denominations'], ['unreachable', 'base case', 'transition'], ['optimal substructure', 'positive', 'duplicates']],
    starter,
    testCases: [
      { input: { denominations: [], target: 0 }, expected: 0, label: 'Zero target without packs' },
      { input: { denominations: [], target: 3 }, expected: -1, label: 'No way to buy positive credit' },
      { input: { denominations: [5], target: 10 }, expected: 2, label: 'Repeated use of one size' },
      { input: { denominations: [1, 3, 4], target: 6 }, expected: 2, label: 'Greedy largest-first would lose' },
      { input: { denominations: [2, 2, 7], target: 4 }, expected: 2, label: 'Duplicate denominations are harmless' },
      { input: { denominations: [4, 7], target: 5 }, expected: -1, label: 'All available exact totals miss target' },
    ],
    solution: {
      sections: [
        { title: 'Solve smaller exact amounts first', body: 'Create a table indexed by credit amount from zero through target. Store zero at amount zero and Infinity at all other amounts to represent initially unreachable states. For each positive amount, try every denomination no larger than that amount. If using that pack as the final purchase gives a smaller count than the current table entry, update it with the smaller amount count plus one. Iterating amounts upward ensures every referenced smaller amount is already finalized, because denominations are strictly positive. Reusing a denomination is automatic: the smaller amount solution may already contain the same denomination. Infinity stays inside local computation; convert an unreachable final entry to negative one so the returned result is a JSON-serializable integer.' },
        { title: 'Removing the final pack proves the recurrence', body: 'Any exact purchase for amount a ends with some available denomination d no greater than a. Removing that final pack leaves an exact purchase for amount a minus d. If the remaining purchase were not minimal, replacing it with a better one would improve the original purchase, so an optimal purchase consists of an optimal smaller purchase plus one final pack. Taking the minimum over all denominations therefore captures every possible optimum. Conversely, every finite candidate formed by this recurrence represents a real purchase, since adding one pack to a valid smaller purchase reaches a exactly. The zero base case anchors this induction. Duplicate denominations generate the same candidate more than once but cannot change the minimum or incorrectly limit how many packs may be used.' },
        { title: 'Unreachable amounts and pseudo-polynomial cost', body: 'With t target credits and d denomination entries, the loops cost O(t times d), plus O(t) table initialization. A bound that includes an empty denomination list is O((t plus one) times (d plus one)). Auxiliary storage is O(t plus one), and output space is constant. This is pseudo-polynomial in the numeric target, not polynomial in the number of bits needed to encode it, which is why the target domain is explicitly bounded. A zero target naturally returns zero; no denominations with a positive target remains unreachable. A denomination larger than target is skipped for every amount. Largest-first greedy purchasing fails for pack sizes one, three, and four at target six, making that example a useful adversarial check rather than assuming coin systems have special properties.' },
      ],
      code: `function solve(input) {
  const best = Array(input.target + 1).fill(Infinity);
  best[0] = 0;
  for (let amount = 1; amount <= input.target; amount++) {
    for (const denomination of input.denominations) {
      if (denomination <= amount) {
        best[amount] = Math.min(best[amount], best[amount - denomination] + 1);
      }
    }
  }
  return best[input.target] === Infinity ? -1 : best[input.target];
}`,
      timeComplexity: 'O((t + 1)(d + 1)), usually O(td), t = target and d = denomination count.',
      spaceComplexity: 'O(t + 1) auxiliary; O(1) output.',
      lessonIds: ['dynamic-programming', 'testing-solutions'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-nondecreasing-route', track: 'code', title: 'Keep a Nondecreasing Upgrade Route', difficulty: 'Medium',
    description: 'An upgrade planner may skip milestones but cannot reorder them. Input: {values: number[]}; output: the longest nondecreasing subsequence length. values has length 0..100000 with integers in [-1000000,1000000]. A subsequence preserves original index order but need not be contiguous; equal values may extend it. Empty input returns 0.',
    requirements: ['Compute a subsequence, not a contiguous run.', 'Allow equal values to extend the route.', 'Binary search tails for the first value strictly greater than the incoming value.', 'Return only the length and leave input unchanged.'],
    keywords: [['tails', 'upper bound', 'binary search'], ['nondecreasing', 'duplicates', 'subsequence'], ['dynamic programming', 'dominance', 'minimum tail'], ['index order', 'length', 'logarithmic']],
    starter,
    testCases: [
      { input: { values: [] }, expected: 0, label: 'No milestones' },
      { input: { values: [8] }, expected: 1, label: 'One milestone' },
      { input: { values: [2, 2, 2, 2] }, expected: 4, label: 'Equality extends a nondecreasing route' },
      { input: { values: [9, 7, 5, 3] }, expected: 1, label: 'Strictly descending milestones' },
      { input: { values: [3, 1, 2, 2, 4] }, expected: 4, label: 'Skip an early high milestone' },
      { input: { values: [-2, 0, -1, -1, 2, 1] }, expected: 4, label: 'Signed values and competing endings' },
    ],
    solution: {
      sections: [
        { title: 'Store the best tail for each length', body: 'Maintain a tails array where position j summarizes a feasible subsequence of length j plus one with the smallest ending value found so far. For each incoming value, binary search for the first tail strictly greater than that value. Replace that tail, or append if no greater tail exists. The strict greater-than search is an upper bound. It lets an equal value pass existing equal tails and extend a route, which is exactly what nondecreasing means. A lower bound searching for greater-than-or-equal would instead solve a different, strictly increasing problem. Tails is only a summary of achievable lengths, not necessarily a single subsequence from the input, so return its length rather than exposing it as a reconstructed route.' },
        { title: 'Smaller endings dominate larger endings', body: 'For any fixed subsequence length, a smaller ending value is at least as easy to extend with future values as a larger ending value. Retaining only the smallest tail therefore loses no future length opportunity. When value v reaches upper-bound position j, every earlier tail is at most v, so a subsequence represented by tail j minus one can extend with v to length j plus one. If a previous tail at j existed, it was greater than v and is improved by replacement. No later length can gain a better tail from this value because its required predecessor tail is greater than v. These updates preserve nondecreasing tails and the best-tail invariant. The array length consequently equals the best feasible length after each processed input prefix.' },
        { title: 'Duplicates, complexity, and an oracle', body: 'Empty input leaves tails empty, and a singleton appends once. An all-equal array appends every value, giving its entire length, while a descending array repeatedly replaces position zero. Each binary search costs O(log(n plus one)), so total time is O(n log(n plus one)); tails uses O(n) auxiliary space in the worst case and the scalar output is constant. Values themselves require no addition, eliminating overflow concerns beyond the bounded index arithmetic. To verify semantics independently on short arrays, use quadratic dynamic programming: for each position, extend earlier positions whose values are less than or equal to its value, then take the maximum length. Including duplicates in that oracle is essential because tests containing only distinct values cannot distinguish this upper-bound algorithm from the incorrect strict-increasing variant.' },
      ],
      code: `function solve(input) {
  const tails = [];
  for (const value of input.values) {
    let left = 0;
    let right = tails.length;
    while (left < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (tails[middle] > value) right = middle;
      else left = middle + 1;
    }
    tails[left] = value;
  }
  return tails.length;
}`,
      timeComplexity: 'O(n log(n + 1)).',
      spaceComplexity: 'O(n) auxiliary tails; O(1) output.',
      lessonIds: ['dp-sequences', 'binary-search'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-choose-slots', track: 'code', title: 'Schedule the Most Studio Reservations', difficulty: 'Medium',
    description: 'A studio can accept one reservation at a time. Input: {intervals: [number, number][]}; output: the maximum number of compatible reservations. There are 0..100000 intervals with integer endpoints in [-1000000,1000000] and start < end. Each interval is half-open [start,end), so touching reservations are compatible. Duplicate reservations are valid but overlap each other. Empty input returns 0.',
    requirements: ['Optimize reservation count, not occupied duration.', 'Sort copies by finish time using numeric comparisons.', 'Allow a start equal to the previous selected end.', 'Do not mutate nested intervals or include zero-length invalid inputs.'],
    keywords: [['greedy', 'earliest finish', 'exchange argument'], ['interval scheduling', 'half open', 'compatible'], ['touching', 'duplicates', 'count'], ['numeric sort', 'copy', 'optimal']],
    starter,
    testCases: [
      { input: { intervals: [] }, expected: 0, label: 'No reservations' },
      { input: { intervals: [[2, 5]] }, expected: 1, label: 'One positive-length reservation' },
      { input: { intervals: [[0, 1], [1, 2], [2, 3]] }, expected: 3, label: 'Touching is compatible' },
      { input: { intervals: [[0, 10], [0, 2], [2, 4], [4, 6]] }, expected: 3, label: 'A long tempting reservation loses' },
      { input: { intervals: [[1, 3], [1, 3], [3, 5], [3, 5]] }, expected: 2, label: 'Duplicates cannot both occupy the studio' },
      { input: { intervals: [[-3, -1], [-2, 0], [0, 2], [-5, -3]] }, expected: 3, label: 'Unsorted negative-time reservations' },
    ],
    solution: {
      sections: [
        { title: 'Leave the earliest possible finish', body: 'Copy the reservation pairs and sort by ascending numeric end time, using start time only as a deterministic tie breaker. Maintain the finish time of the last accepted reservation, initially negative Infinity, and a count initially zero. Accept a reservation when its start is at least that remembered finish; then update the finish to its end. Rejecting incompatible reservations requires no other state. The half-open interval contract is important: equality at the boundary means the earlier booking has ended before the next begins. The objective counts bookings equally, regardless of duration. Choosing the earliest start or shortest duration can make locally attractive choices that block more future bookings, whereas earliest finish leaves the most room afterward.' },
        { title: 'Exchange a greedy choice into an optimum', body: 'Among all possible first reservations, the greedy choice has the earliest end. Consider an optimal schedule and replace its first reservation with the greedy one. The replacement ends no later, so every later reservation in the original optimum remains compatible with it. The number of reservations does not decrease. Thus there exists an optimal schedule beginning with the greedy choice. Apply the same argument to the remaining reservations that start at or after that chosen end. Repeating this exchange proves optimality for the entire scan. Equal finish times do not harm the argument because either ending leaves the same future availability. Positive lengths ensure duplicate reservations overlap and cannot be selected consecutively merely because their starts and ends match each other.' },
        { title: 'Sorting model, space, and adversaries', body: 'The scan is O(n). Total time is the runtime Array.sort cost plus that scan, commonly O(n log n) under a comparison-sort model but not guaranteed by ECMAScript. Pair copies require O(n) auxiliary space in addition to sorting workspace; the returned count uses constant output space. Negative endpoints work with the same comparisons, and negative Infinity is only a local initial sentinel, never part of returned JSON. Empty input leaves the count zero. Do not use a merge-union algorithm here: combining windows computes coverage, not a maximum selection of original reservations. A brute-force oracle can enumerate subsets on small inputs and reject any pair whose half-open intervals overlap. A long window containing several short touching windows is a strong test of whether the implementation optimizes count rather than duration.' },
      ],
      code: `function solve(input) {
  const ordered = input.intervals.map(([start, end]) => [start, end]);
  ordered.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  let finish = -Infinity;
  let count = 0;
  for (const [start, end] of ordered) {
    if (start >= finish) {
      count++;
      finish = end;
    }
  }
  return count;
}`,
      timeComplexity: 'T_sort(n) + O(n); O(n log n) under a comparison-sort model, not a language guarantee.',
      spaceComplexity: 'O(n) auxiliary pair copies + S_sort(n); O(1) output.',
      lessonIds: ['greedy', 'intervals'], sourceIds: ['mit-algorithms', 'js-sort'],
    },
  },
  {
    id: 'alg-prefix-directory', track: 'code', title: 'Browse a Prefix-Based Workshop Directory', difficulty: 'Medium',
    description: 'A workshop directory must list every registered name beginning with a requested prefix. Input: {words: string[], prefix: string}; output: matching words in ascending ASCII lexicographic order. words has length 0..10000 with distinct strings of 0..64 lowercase ASCII letters a..z; the empty word is permitted. prefix is also 0..64 lowercase ASCII letters. An empty prefix matches every word. Build and search a trie without changing words.',
    requirements: ['Use a trie with a terminal marker distinct from child existence.', 'Support an empty word and an empty prefix.', 'Return only matches in ASCII lexicographic order, shorter prefix first.', 'Traverse iteratively and keep all original words unchanged.'],
    keywords: [['trie', 'prefix', 'children'], ['terminal', 'empty word', 'root'], ['ASCII', 'lexicographic', 'alphabet'], ['Map', 'iterative DFS', 'immutable']],
    starter,
    testCases: [
      { input: { words: [], prefix: '' }, expected: [], label: 'Empty directory' },
      { input: { words: [''], prefix: '' }, expected: [''], label: 'Empty word lives at the root' },
      { input: { words: ['map', 'maker', 'mail', 'mat'], prefix: 'ma' }, expected: ['mail', 'maker', 'map', 'mat'], label: 'Shared prefix with several branches' },
      { input: { words: ['ab', '', 'a', 'b'], prefix: '' }, expected: ['', 'a', 'ab', 'b'], label: 'Whole directory in prefix-first order' },
      { input: { words: ['car', 'cart', 'cat'], prefix: 'cart' }, expected: ['cart'], label: 'Exact word prefix' },
      { input: { words: ['oak', 'olive'], prefix: 'ox' }, expected: [], label: 'Missing branch has no matches' },
    ],
    solution: {
      sections: [
        { title: 'Represent words as terminal trie paths', body: 'Create a root node containing a Map of children and a terminal word slot initialized to null. Insert each word by following or creating one child per character, then store the word at the final node. An empty word ends at the root, which makes empty-word support explicit rather than accidental. Follow the requested prefix from the root; a missing child proves there are no matches. From the matching prefix node, traverse descendants with an explicit stack. Emit a terminal word before its children. Push children in reverse alphabet order so the smallest letter is processed first when popped. Storing the original immutable string at terminals avoids repeatedly building growing path strings during traversal and keeps returned names exact.' },
        { title: 'Path identity and ordered enumeration', body: 'A trie node corresponds to one unique character prefix. A terminal marker means that exact prefix is registered as a complete word, even if it also has children. Following the requested prefix reaches precisely the subtree containing all and only names starting with that prefix. Within this subtree, emitting a terminal before descending makes a shorter name precede its extensions. Processing child letters from a through z orders branches by their first differing character, which proves ASCII lexicographic order recursively. The explicit stack uses reverse pushes solely to realize that forward visitation order. Distinct words ensure each terminal contains one name and each name is emitted once. Testing terminal against null, rather than truthiness, is essential because the valid empty word is a falsy string.' },
        { title: 'Alphabet and storage assumptions', body: 'Let C be the total number of inserted characters, p the prefix length, U the number of trie nodes visited in the matching subtree, and m the match count. With expected constant-time Map access and a fixed twenty-six-letter alphabet, time is O(C plus p plus U plus m plus one). Scanning alphabet positions at each visited node has a fixed constant factor. Trie storage is O(C plus one); the traversal stack is bounded by a constant times maximum word length because alphabet size is fixed. Output holds O(m) references to immutable strings; serialized output additionally occupies their total character length. This ordering is for lowercase ASCII, not arbitrary Unicode collation. A filter-and-sort implementation is useful as an independent oracle, but does not demonstrate the requested trie structure or its prefix navigation behavior.' },
      ],
      code: `function solve(input) {
  const root = { children: new Map(), word: null };
  for (const word of input.words) {
    let node = root;
    for (const letter of word) {
      if (!node.children.has(letter)) {
        node.children.set(letter, { children: new Map(), word: null });
      }
      node = node.children.get(letter);
    }
    node.word = word;
  }
  let node = root;
  for (const letter of input.prefix) {
    if (!node.children.has(letter)) return [];
    node = node.children.get(letter);
  }
  const result = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (current.word !== null) result.push(current.word);
    for (let code = 122; code >= 97; code--) {
      const child = current.children.get(String.fromCharCode(code));
      if (child) stack.push(child);
    }
  }
  return result;
}`,
      timeComplexity: 'O(C + p + U + m + 1) expected with constant-time Map access and fixed ASCII alphabet.',
      spaceComplexity: 'O(C + L + 1) auxiliary trie and traversal stack, L = maximum word length; O(m) output references, O(m + R) serialized size for R returned characters.',
      lessonIds: ['tries', 'arrays-hashing'], sourceIds: ['nist-algorithms', 'js-map'],
    },
  },
  {
    id: 'alg-island-count', track: 'code', title: 'Count Separate Survey Patches', difficulty: 'Medium',
    description: 'A rectangular survey grid marks land with 1 and water with 0. Input: {grid: number[][]}; output: the number of four-neighbor land components. There are 0..300 rows, all of equal length 0..300, and every entry is exactly 0 or 1. [] and grids with zero columns return 0. Diagonal contact does not connect patches. Use separate visited storage and never modify a row or cell.',
    requirements: ['Connect only up, down, left, and right neighbors.', 'Use iterative traversal with a separate visited structure.', 'Mark cells at discovery to avoid duplicate pending work.', 'Handle empty, zero-column, all-water, and irregular-shaped patches.'],
    keywords: [['matrix', 'grid', 'rectangular'], ['DFS', 'iterative', 'visited'], ['four neighbors', 'islands', 'component'], ['boundary', 'diagonal', 'immutable']],
    starter,
    testCases: [
      { input: { grid: [] }, expected: 0, label: 'No rows' },
      { input: { grid: [[], []] }, expected: 0, label: 'Rows with zero columns' },
      { input: { grid: [[1]] }, expected: 1, label: 'Single land cell' },
      { input: { grid: [[0, 0], [0, 0]] }, expected: 0, label: 'All water' },
      { input: { grid: [[1, 0, 1], [0, 1, 0], [1, 0, 1]] }, expected: 5, label: 'Diagonal contacts stay separate' },
      { input: { grid: [[1, 1, 0, 1], [0, 1, 0, 1], [1, 1, 0, 0]] }, expected: 2, label: 'Bent component and isolated right strip' },
      { input: { grid: [[1, 1], [1, 1]] }, expected: 1, label: 'Multiple paths to the same cell' },
    ],
    solution: {
      sections: [
        { title: 'Start one traversal per unseen land cell', body: 'Return zero for an empty grid or zero columns. Otherwise allocate a flat visited byte array with one entry per cell. Encode a cell as row times column count plus column, allowing the traversal stack to hold a single integer per pending cell. Scan every grid coordinate. When an unvisited land cell appears, increment the patch count, mark it, and start an iterative depth-first traversal from it. Each popped cell checks the four explicit coordinate offsets. Only in-bounds, unvisited land neighbors are marked and pushed. Keeping coordinate bounds checks separate from flattened indexes avoids accidentally wrapping the right edge of one row into the left edge of another. Every original grid cell remains unchanged throughout discovery.' },
        { title: 'A traversal discovers one whole component', body: 'Every cell added to a traversal is land connected by a four-neighbor edge to a cell already discovered in that traversal. By induction, all discovered cells belong to the starting cell component. Conversely, any land cell reachable from the start has a path of such edges. Once a path predecessor is processed, its undiscovered successor is marked and pushed, so traversal eventually reaches every cell on that path. The traversal therefore marks exactly one component. Marking on push prevents different paths from pushing the same cell repeatedly. During the outer scan, a component is counted at its first unvisited land coordinate; all its remaining coordinates are already marked and cannot increment the count again. Diagonal neighbors are never examined and cannot silently connect separate patches.' },
        { title: 'Memory, empty shapes, and bounds', body: 'For R rows and C columns, the scan examines R times C cells and each discovered land cell checks four neighbors, giving O(RC) work for a nonempty shape. Including empty shapes, O(1 plus RC) describes the early return. Visited storage and the pending stack each use at most O(RC) auxiliary space, while the output count is constant space. An all-water grid performs only the scan and returns zero. Zero columns are explicitly valid even with many rows, so do not try to access a cell before the early check. A recursive flood-fill has the same connectivity logic but may exhaust the call stack on a long winding patch. A separate union-find oracle over adjacent land cells is a useful way to validate iterative flood-fill without merely repeating its traversal implementation.' },
      ],
      code: `function solve(input) {
  const rows = input.grid.length;
  if (rows === 0) return 0;
  const columns = input.grid[0].length;
  if (columns === 0) return 0;
  const visited = new Uint8Array(rows * columns);
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let count = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const start = row * columns + column;
      if (input.grid[row][column] === 0 || visited[start]) continue;
      count++;
      visited[start] = 1;
      const stack = [start];
      while (stack.length) {
        const cell = stack.pop();
        const currentRow = Math.floor(cell / columns);
        const currentColumn = cell % columns;
        for (const [dr, dc] of offsets) {
          const nextRow = currentRow + dr;
          const nextColumn = currentColumn + dc;
          if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) continue;
          const next = nextRow * columns + nextColumn;
          if (input.grid[nextRow][nextColumn] === 1 && !visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }
    }
  }
  return count;
}`,
      timeComplexity: 'O(1 + RC), R rows and C columns.',
      spaceComplexity: 'O(RC) auxiliary visited bytes and iterative stack; O(1) output.',
      lessonIds: ['matrices', 'graph-search'], sourceIds: ['mit-algorithms'],
    },
  },
  {
    id: 'alg-bit-count', track: 'code', title: 'Count Enabled Control Flags', difficulty: 'Easy',
    description: 'A controller encodes enabled flags in a nonnegative Number. Input: {value: number}; output: the count of set bits in its binary representation. value is an integer in [0,2147483647], exactly 0..2^31-1. Zero returns 0. This Number bitwise domain deliberately excludes the sign bit, fractions, BigInt, and wider integers; the maximum output is 31.',
    requirements: ['Use the specified Number bitwise domain explicitly.', 'Clear one set bit per iteration instead of creating a binary string.', 'Handle zero, powers of two, and the maximum allowed value.', 'Return a count and leave input unchanged.'],
    keywords: [['bitwise AND', 'clear lowest bit', 'mask'], ['Number', 'Int32', 'domain'], ['popcount', 'set bits', 'binary'], ['zero', 'power of two', 'invariant']],
    starter,
    testCases: [
      { input: { value: 0 }, expected: 0, label: 'No enabled flags' },
      { input: { value: 1 }, expected: 1, label: 'Lowest flag alone' },
      { input: { value: 1024 }, expected: 1, label: 'A higher power of two' },
      { input: { value: 42 }, expected: 3, label: 'Alternating small mask' },
      { input: { value: 1073741824 }, expected: 1, label: 'Highest allowed single bit' },
      { input: { value: 2147483647 }, expected: 31, label: 'All allowed flags enabled' },
    ],
    solution: {
      sections: [
        { title: 'Remove the lowest enabled flag', body: 'Copy the numeric value into a local variable and initialize a count to zero. While the local value is nonzero, replace it with the bitwise AND of itself and itself minus one, then increment the count. Subtracting one changes the lowest set bit to zero and turns all less significant trailing zero bits into ones. AND with the original value clears that lowest set bit while leaving all higher set bits unchanged. Repeating this operation therefore performs one iteration per enabled flag rather than one iteration per possible position. No binary string or temporary array is needed. The input value property is never assigned, so even the scalar wrapper object remains intact across repeated calls.' },
        { title: 'The count tracks exactly removed bits', body: 'After each iteration, the local value contains exactly the original set bits not yet removed, and the count equals the number already removed. The clearing identity establishes the inductive step because precisely one set bit disappears and no new set bit survives. A nonzero nonnegative value has at least one set bit, so progress is guaranteed. Once the local value reaches zero, all original bits have been removed and the count is the required population count. This argument is about the binary representation within the specified width, not about decimal digits. A power of two has one set bit and terminates after one iteration. A mask with all thirty-one allowed bits set takes thirty-one iterations and returns thirty-one.' },
        { title: 'JavaScript coercion is part of the contract', body: 'JavaScript Number bitwise operators coerce operands to signed thirty-two-bit integers. The declared range zero through two to the thirty-one minus one ensures this coercion preserves the nonnegative value and never introduces the sign bit. Wider positive integers would lose high bits, and fractions would be truncated, so neither belongs to this problem domain. BigInt is a different type with different mixing rules and is not accepted here. Time is O(b) for b enabled bits, with at most thirty-one iterations in this bounded domain; globally this is constant worst case time. Auxiliary and output space are constant. Zero bypasses the loop. An independent arithmetic oracle can repeatedly inspect remainder modulo two and divide by two with floor, avoiding the same bitwise identity under test.' },
      ],
      code: `function solve(input) {
  let value = input.value;
  let count = 0;
  while (value !== 0) {
    value = value & (value - 1);
    count++;
  }
  return count;
}`,
      timeComplexity: 'O(b), b set bits; at most 31 iterations, hence O(1) over the declared domain.',
      spaceComplexity: 'O(1) auxiliary and output space.',
      lessonIds: ['bit-manipulation', 'testing-solutions'], sourceIds: ['js-bitwise', 'js-number'],
    },
  },
  {
    id: 'alg-frequent-tags', track: 'code', title: 'Rank Workshop Inventory Tags', difficulty: 'Easy',
    description: 'An inventory report ranks identifiers by frequency. Input: {tags: string[]}; output: [tag,count] pairs sorted by count descending, then tag ascending in ASCII lexicographic order. tags has length 0..100000; each nonempty tag is 1..64 ASCII characters matching [A-Za-z_][A-Za-z0-9_]*. Tags are case-sensitive; duplicates, "__proto__", and "constructor" are valid. Empty input returns []. Use Map, not an ordinary object frequency dictionary.',
    requirements: ['Count every occurrence with a prototype-safe Map.', 'Return exactly one pair per distinct tag.', 'Break equal-count ties by ASCII order, not locale collation.', 'Do not reorder tags or alter strings; define empty output explicitly.'],
    keywords: [['Map', 'frequency', 'hashing'], ['prototype safety', '__proto__', 'constructor'], ['ASCII', 'tie break', 'case sensitive'], ['sort', 'descending count', 'distinct']],
    starter,
    testCases: [
      { input: { tags: [] }, expected: [], label: 'Empty inventory' },
      { input: { tags: ['solo'] }, expected: [['solo', 1]], label: 'Single identifier' },
      { input: { tags: ['bolt', 'nut', 'bolt', 'bolt', 'nut'] }, expected: [['bolt', 3], ['nut', 2]], label: 'Counts determine priority' },
      { input: { tags: ['z', 'a', 'z', 'a', 'b'] }, expected: [['a', 2], ['z', 2], ['b', 1]], label: 'Alphabetical tie break' },
      { input: { tags: ['__proto__', 'constructor', '__proto__', 'toString'] }, expected: [['__proto__', 2], ['constructor', 1], ['toString', 1]], label: 'Identifiers that resemble object properties' },
      { input: { tags: ['a', '_', 'A', 'a0'] }, expected: [['A', 1], ['_', 1], ['a', 1], ['a0', 1]], label: 'ASCII case and prefix order' },
    ],
    solution: {
      sections: [
        { title: 'Separate safe counting from deterministic ranking', body: 'Create a Map and increment the stored count for each tag, defaulting an absent entry to zero. Map treats every string as a key without inheriting ordinary object properties. That matters for identifiers such as constructor and double-underscore proto: they must count like any other inventory tag. Convert the completed Map entries to a new array of pairs. Sort that result by count descending, then compare tag strings with ordinary less-than and greater-than operators for an ascending tie break. The bounded ASCII domain makes these comparisons agree with the requested ASCII lexicographic order. Do not use localeCompare because locale-dependent collation could put case and punctuation in a different order. Only the newly created result array is sorted.' },
        { title: 'Prefix counting and a total ordering', body: 'After processing any input prefix, the Map value for a tag equals its number of occurrences in that prefix. A new occurrence increments exactly that one count, so induction gives exact totals at completion. Each Map entry appears once in the converted result, ensuring one pair per distinct tag. The comparator first orders unequal counts by descending numeric value. When counts match, ASCII string comparison orders unequal tags; equal tags would compare as zero, although the Map has already made them unique. This defines a total order for the distinct entries and makes output independent of the original encounter order. The sorting algorithm does not need stability to resolve ties because the explicit secondary key distinguishes every different tag with the same count.' },
        { title: 'Expected hash costs and string work', body: 'Let n be the number of occurrences, u the number of distinct tags, and L the maximum tag length. Counting is commonly modeled as expected O(n) Map operations, not a language promise of constant-time hashing. Including string hashing or equality work gives expected O(nL) as a conservative bound. Sorting adds the runtime sort cost; under a comparison-sort model there are O(u log(u plus one)) comparisons and each tied string comparison costs at most O(L). Auxiliary Map storage uses O(u) entries plus runtime sort workspace, and output uses O(u) pairs referring to immutable strings. Serialized output additionally includes tag characters. Empty input returns no pairs. Adversarial property-like identifiers specifically test dictionary safety, while uppercase letters, underscores, and prefix-related tags test deterministic ASCII ordering rather than only easy lowercase alphabetical examples.' },
      ],
      code: `function solve(input) {
  const counts = new Map();
  for (const tag of input.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const result = Array.from(counts.entries());
  result.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return result;
}`,
      timeComplexity: 'Expected O(nL) counting + T_sort(u,L); O(nL + u log(u + 1)L) under expected constant-time Map operations and a comparison-sort model, not a language guarantee.',
      spaceComplexity: 'O(u) auxiliary Map entries + S_sort(u); O(u) output pairs/references, plus tag characters when serialized.',
      lessonIds: ['arrays-hashing', 'complexity', 'testing-solutions'], sourceIds: ['js-map', 'js-sort'],
    },
  },
];
