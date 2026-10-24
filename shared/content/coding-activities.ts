import { activity, type LessonActivity } from './activity-authoring';

export const codingActivities: Record<string, LessonActivity> = {
  introduction: activity('Use a tiny pair-search oracle to check an optimized answer before trusting the pattern name.', [
    ['Specify the result', 'Decide whether the function returns existence, indices, or every pair; those contracts have different output costs.'],
    ['Keep a small oracle', 'Enumerate distinct positions on small inputs so the straightforward implementation provides independent expected results.'],
    ['Explain elimination', 'Only replace enumeration after naming the invariant that preserves every required candidate and makes progress.'],
  ], ['May a pair-existence solution use the same array position twice?', ['Not when the contract requires two distinct positions.', 'Yes, whenever twice its value equals the target.', 'No pair may ever contain equal values.'], 'Identity is positional here: one occurrence cannot be reused, but two occurrences of the same value can be a valid pair. Test both cases rather than conflating value equality and position identity.'], { kind: 'algorithm', algorithm: 'pair-oracle' }),
  complexity: activity('Compare exact illustrative operation counts as input size changes; do not confuse those counts with benchmark timings.', [
    ['Choose the variable', 'Define input length and the operation model before comparing linear scans, pair enumeration, and candidate subsets.'],
    ['Count hidden work', 'Include input copying, preprocessing, recursive frames, and returned output rather than only the visible main loop.'],
    ['State the guarantee', 'Separate worst-case, expected, and amortized reasoning; a language API name does not establish a specific implementation cost.'],
  ], ['A loop appends every subset to its output. Can its total cost be linear in input length?', ['Not when it must materialize exponentially many distinct subsets.', 'Yes, because there is only one outer loop.', 'Yes, if the returned array is excluded from every cost.'], 'Required output is real work. Auxiliary storage may be reported separately, but producing and storing every required answer still constrains total complexity.'], { kind: 'algorithm', algorithm: 'growth' }),
  'arrays-hashing': activity('Count labels in the processed prefix, then rank complete counts with a deterministic tie rule.', [
    ['Define a map entry', 'Each stored count equals occurrences of its key in the processed prefix, not a guess about future values.'],
    ['Update one fact', 'Reading one label changes only that label count; a missing key is distinct from a stored zero or false value.'],
    ['Rank final counts', 'Compare complete frequencies and break ties explicitly instead of assuming insertion order means frequency order.'],
  ], ['When counting labels, what should countMap.get(label) represent after processing a prefix?', ['Occurrences of that label in exactly the processed prefix.', 'The future final rank of that label.', 'Its first position multiplied by total input length.'], 'A precise map invariant justifies each update and final result. Ranking is another phase, and expected hashing-model costs are not a universal constant-time JavaScript guarantee.'], { kind: 'algorithm', algorithm: 'frequency' }),
  'two-pointers': activity('A sorted pair sum is too small; remove one impossible family of pairs without losing a valid answer.', [
    ['Require sorted input', 'The directional argument depends on nondecreasing values and two distinct positions within the remaining candidate range.'],
    ['Compare extremes', 'If the current sum is too small, no smaller right partner can rescue the current left value.'],
    ['Shrink with proof', 'Advance the left pointer in that case; the remaining region still contains any pair not already ruled out.'],
  ], ['Why is moving left rightward safe when a sorted pair sum is too small?', ['All remaining partners for the old left value are no larger than the current right value.', 'The target is guaranteed to be present.', 'Every unsorted array has the same monotonic direction.'], 'The sorted-order bound eliminates all candidates using the old left position. This is a correctness argument, not simply a movement that happened to work in an example.']),
  'sliding-window': activity('Move a fixed-width sum by removing the departing element and adding the entering one.', [
    ['Initialize the window', 'Compute the first complete window and state whether both boundary positions are included in the representation.'],
    ['Update the summary', 'Subtract the value leaving the window, add the next value, and preserve the exact fixed width.'],
    ['Record every position', 'Compare each complete window with the best observed result; do not accidentally omit the final legal window.'],
  ], ['Does a fixed-width sliding sum require all numbers to be positive?', ['No; its add-and-remove identity also works with negative values.', 'Yes; any negative value invalidates subtraction.', 'Only when the first value is the maximum.'], 'A fixed-width sum is an algebraic identity. Variable-width shrink rules can need monotonicity assumptions, so do not transfer guarantees between different window problems.']),
  'prefix-sum': activity('Build a half-open prefix table so each range sum uses two boundary observations.', [
    ['Start with zero', 'Set prefix zero to zero so ranges starting at the first value need no special subtraction rule.'],
    ['Accumulate a prefix', 'Prefix at position i stores the sum of the first i input values, excluding the element at i.'],
    ['Subtract boundaries', 'The sum over left-inclusive, right-exclusive bounds equals prefix at right minus prefix at left.'],
  ], ['For prefix[i] equal to the first i values, what is sum of [left, right)?', ['prefix[right] minus prefix[left].', 'prefix[right] minus prefix[left + 1].', 'prefix[right - 1] plus prefix[left].'], 'Half-open boundaries make empty ranges and the full array consistent. Keep the definition and query formula together; mixing inclusive and exclusive conventions creates off-by-one errors.'], { kind: 'algorithm', algorithm: 'prefix' }),
  intervals: activity('Sort half-open intervals and decide explicitly whether touching endpoints count as overlap.', [
    ['Choose endpoint rules', 'For half-open intervals, the ending instant belongs to the next possible interval rather than the previous one.'],
    ['Inspect the frontier', 'Only the latest merged interval can overlap the next start after sorting by start with an explicit tie rule.'],
    ['Merge or append', 'Merge on strict overlap under this contract; touching intervals remain distinct unless the product asks for coalescing adjacency.'],
  ], ['Do [1, 3) and [3, 5) overlap under half-open semantics?', ['No; the shared endpoint belongs only to the second interval.', 'Yes; any equal endpoints imply overlapping occupancy.', 'Only when the intervals are sorted in reverse.'], 'Endpoint conventions are part of the contract. A different task may intentionally coalesce adjacent spans, but that is a policy choice rather than proof of overlap.'], { kind: 'algorithm', algorithm: 'intervals' }),
  stacks: activity('Use a monotonic stack to resolve the next strictly greater value, including equal-value boundaries.', [
    ['Store unresolved work', 'The stack contains prior positions that have not yet found a later value strictly greater than themselves.'],
    ['Resolve with a value', 'A larger arriving value pops and resolves eligible positions; equality must not satisfy a strictly-greater contract.'],
    ['Bound total work', 'Each position is pushed once and popped at most once, giving amortized linear stack operations across the run.'],
  ], ['Does an equal later value resolve a next-strictly-greater query?', ['No; equality must remain unresolved until a greater value appears.', 'Yes; greater and greater-or-equal mean the same thing.', 'Only if both values are at adjacent positions.'], 'Changing a strict comparison changes the result contract. Tie-heavy examples are useful because they expose a mistaken less-than-or-equal pop condition.'], { kind: 'algorithm', algorithm: 'stack' }),
  'linked-lists': activity('Reverse a small chain while keeping track of the unprocessed suffix before changing links.', [
    ['Save the next link', 'Read the current successor before overwriting the link that is the only route to the remaining suffix.'],
    ['Reverse one edge', 'Connect the current node to the completed prefix without accidentally creating a cycle or losing ownership.'],
    ['Advance both views', 'Move the prefix and suffix cursors; decide separately whether the contract permits input-node mutation or requires copies.'],
  ], ['What must be saved before reversing current.next in an in-place reversal?', ['The original successor needed to reach the unprocessed suffix.', 'Only the final list length.', 'The value of the last node in the original list.'], 'A pointer update can destroy your only path to remaining nodes. The experiment shows link direction; the existing runnable reference has its own explicit copy-versus-mutation contract.'], { kind: 'algorithm', algorithm: 'reverse' }),
  'binary-search': activity('Keep the answer inside a declared candidate interval while each comparison removes a proven impossible half.', [
    ['State the predicate', 'Distinguish exact search from first-true boundary search; both require a justified ordering or monotonic predicate.'],
    ['Compare a midpoint', 'Use the comparison to select a half that can still contain the requested result under the stated invariant.'],
    ['Finish the contract', 'At termination, verify existence or return the boundary sentinel; an insertion point is not automatically a matching element.'],
  ], ['Does a binary-search insertion point prove the target exists?', ['No; check the bound and element equality for exact search.', 'Yes; every insertion point is an existing target.', 'Only if the input length is even.'], 'Boundary search and exact search return different information. Empty arrays, duplicates, and values beyond the last element reveal a missing final contract check.']),
  heaps: activity('Retain only the largest k values while keeping the weakest retained candidate at the heap root.', [
    ['Define the root', 'For top-k largest values, a min-heap root identifies the smallest currently retained candidate, not the global maximum.'],
    ['Bound retained state', 'Insert while space remains; once full, discard an incoming value that cannot improve the retained candidate set.'],
    ['Restore heap order', 'Replace the root for a stronger candidate and repair the heap; output ordering remains a separate step.'],
  ], ['In a min-heap retaining the largest k values, what does the root represent?', ['The weakest currently retained value.', 'The largest value anywhere in the input.', 'Every element in sorted order at once.'], 'A heap maintains a partial order that makes one extreme accessible. It does not imply its backing array is fully sorted, and top-k output can need an additional sort.'], { kind: 'algorithm', algorithm: 'heap' }),
  trees: activity('Traverse a rooted tree level by level without mixing newly appended children into the current level.', [
    ['Capture the frontier', 'Snapshot the number of queued nodes in this level before adding any of their children.'],
    ['Visit one level', 'Process exactly that snapshot count and aggregate only those nodes for the current depth.'],
    ['Advance the boundary', 'The appended children form the next level; track queue width separately from recursive path depth.'],
  ], ['Why capture queue length before computing a level sum?', ['Newly enqueued children belong to the next level.', 'A queue can never grow while traversing.', 'Every tree level contains the same number of nodes.'], 'The frontier boundary is state, not a cosmetic loop choice. Iterating over a growing length mixes depths and can make a level statistic meaningless.'], { kind: 'algorithm', algorithm: 'tree' }),
  'graph-search': activity('Mark a node when it enters the BFS queue so two parents cannot repeatedly enqueue it.', [
    ['Initialize discovery', 'Put the start vertex in the queue and the discovered set before examining any outgoing edges.'],
    ['Expand the frontier', 'Visit queued vertices in FIFO order; this exposes increasing edge-count distance in an unweighted graph.'],
    ['Preserve first arrival', 'Record an unseen neighbor and its parent when discovered; repeated edges must not create duplicate frontier work.'],
  ], ['When should BFS mark a vertex discovered to avoid duplicate enqueues?', ['When enqueuing it for the first time.', 'Only after every vertex has been removed from the queue.', 'Whenever an edge points to it, without checking prior discovery.'], 'Discovery at enqueue time prevents multiple parents from scheduling the same work. FIFO order gives shortest edge-count paths only under the unweighted or equal-weight setting.']),
  graphs: activity('Inspect a graph where the fewest-edge route is more expensive than a two-edge route.', [
    ['Specify edge meaning', 'Decide whether edges are directed, weighted, and nonnegative before choosing a shortest-path algorithm.'],
    ['Relax distances', 'A candidate path updates a distance only when its accumulated cost improves the best known value.'],
    ['Select valid work', 'For nonnegative weights, process the smallest tentative distance and ignore obsolete queued observations.'],
  ], ['Can ordinary FIFO BFS minimize arbitrary positive edge costs?', ['No; fewest edges need not mean smallest total weight.', 'Yes; positive weights all have the same ordering effect.', 'Only if the graph is stored as an adjacency list.'], 'Traversal representation does not change edge semantics. Dijkstra-style distance ordering addresses nonnegative costs; negative edges require a different correctness argument.'], { kind: 'algorithm', algorithm: 'weighted-graph' }),
  'topological-sort': activity('Release a dependency only after all of its incoming prerequisites have been removed.', [
    ['Count prerequisites', 'Initialize an indegree for every vertex, including isolated vertices, and deduplicate edges if the contract requires it.'],
    ['Release ready work', 'Choose a zero-indegree vertex, emit it, then decrement only the outgoing neighbors it satisfies.'],
    ['Detect unresolved work', 'If fewer than all vertices were emitted, a cycle remains; returning the partial prefix as success hides the failure.'],
  ], ['A topological pass emits fewer vertices than exist. What must be checked?', ['A remaining directed cycle prevents a full valid order.', 'The partial order always satisfies every dependency.', 'The missing vertices can simply be appended alphabetically.'], 'A ready queue becoming empty does not prove completion. Count emitted vertices against the entire vertex set and report an impossible order explicitly.'], { kind: 'algorithm', algorithm: 'topological' }),
  'union-find': activity('Add undirected links while maintaining the number of distinct connected components.', [
    ['Start with identities', 'Each initial vertex belongs to its own component, with an explicit representative and component count.'],
    ['Find both roots', 'Compare representatives before merging; a link within one existing component does not create a new merge.'],
    ['Merge once', 'Union distinct roots and decrement the count exactly once, using size or rank and optional path compression.'],
  ], ['What does adding a duplicate link inside one component do to component count?', ['Nothing; the endpoints already have the same representative.', 'It always decrements the count again.', 'It creates a new isolated vertex.'], 'The count tracks partitions of vertices, not the number of edge commands. Duplicate and self-loop fixtures expose unconditional decrement bugs.'], { kind: 'algorithm', algorithm: 'union-find' }),
  backtracking: activity('Enumerate choices by extending one path and undoing only the state owned by that branch.', [
    ['Declare a partial path', 'The current choices describe one partial candidate; they are not already a valid completed answer by default.'],
    ['Explore a branch', 'Add one permitted choice and recurse under a progress measure such as the next input position.'],
    ['Undo before siblings', 'Restore branch-local state before exploring another choice, and copy completed output so later mutation cannot rewrite it.'],
  ], ['Why copy a completed backtracking path when recording an answer?', ['Later branch updates must not mutate an already recorded result.', 'Copying removes the exponential number of possible outputs.', 'Every sibling branch is required to share one mutable result array.'], 'Correct ownership of mutable state is distinct from search complexity. A copy preserves the observation; pruning still needs a sound argument about impossible completions.'], { kind: 'algorithm', algorithm: 'subsets' }),
  'dynamic-programming': activity('Build a recurrence in dependency order and make the base cases explicit before reusing prior results.', [
    ['Define the state', 'Explain precisely what the value at index i represents before selecting a recurrence or table shape.'],
    ['Establish base cases', 'Provide valid answers for the smallest states, including zero where the contract requires it.'],
    ['Reuse dependencies', 'Compute a state only after its prerequisites; an optimized rolling representation must retain everything the next state needs.'],
  ], ['Does memoization fix a recurrence that models the wrong problem?', ['No; cached wrong subproblem answers remain wrong.', 'Yes; caching makes any recursive definition correct.', 'Only when the table has exactly two columns.'], 'State meaning and transition correctness precede caching. Memoization changes repeated work, not the semantics of the recurrence or required base cases.']),
  'dp-sequences': activity('Compute a longest nondecreasing subsequence while allowing equal values as the contract requires.', [
    ['Define an ending state', 'The value at i is the best subsequence length ending exactly at i, not the best answer over every prefix.'],
    ['Check predecessors', 'A prior position can extend the state when its value is less than or equal to the current value.'],
    ['Take the best ending', 'The final answer is the maximum ending-state value, with empty input handled by its own declared result.'],
  ], ['For a nondecreasing subsequence, may equal values extend one another?', ['Yes; use the equality rule required by nondecreasing order.', 'No; all subsequence problems require strictly increasing values.', 'Only when the equal values occupy the same position.'], 'Strictly increasing and nondecreasing are different contracts. A strict comparison silently changes the task; tie-heavy fixtures reveal this error immediately.'], { kind: 'algorithm', algorithm: 'sequence-dp' }),
  greedy: activity('Select the maximum number of nonoverlapping half-open intervals by choosing the next earliest finish.', [
    ['Choose the objective', 'This strategy optimizes interval count under the stated compatibility rule, not arbitrary weighted value.'],
    ['Pick a safe frontier', 'Choose the compatible interval that finishes earliest so it leaves no less future scheduling room.'],
    ['Exchange an optimum', 'Replace the first choice of an optimal schedule with that earliest finish without reducing the achievable count.'],
  ], ['Does earliest-finish interval scheduling automatically maximize arbitrary rewards?', ['No; weighted rewards change the optimization problem.', 'Yes; every greedy count proof also proves weighted optimality.', 'Only if all intervals are represented as arrays.'], 'A greedy proof is scoped to its objective and feasible set. Earliest finish optimizes count here; weighted interval scheduling needs different reasoning.'], { kind: 'algorithm', algorithm: 'greedy' }),
  tries: activity('Walk a prefix once, then enumerate only descendants of the reached node.', [
    ['Insert characters', 'Edges represent successive characters and terminal markers distinguish complete words from mere prefixes.'],
    ['Locate a prefix', 'Follow the query characters; a missing edge ends the search without examining every stored word.'],
    ['Enumerate descendants', 'Collect complete words below that node under a declared ordering and limit, accounting for output size.'],
  ], ['A trie path exists for a string. Does that prove the string is a stored complete word?', ['No; the terminal marker must also be present.', 'Yes; every intermediate prefix is automatically a word.', 'Only when its first character is uppercase.'], 'Prefix reachability and full-word membership answer different questions. Enumeration costs include visiting output characters, so it is not constant-time just because prefix lookup is short.'], { kind: 'algorithm', algorithm: 'trie' }),
  matrices: activity('Treat land cells as graph vertices and flood only orthogonal neighbors under the chosen connectivity rule.', [
    ['Define adjacency', 'Specify whether diagonal neighbors connect; the same matrix can yield different components under different rules.'],
    ['Discover a component', 'Start a traversal at an unvisited land cell and mark neighbors when scheduling them to avoid repeated work.'],
    ['Count new starts', 'Increment only when a new component traversal begins; visited cells must not create another island.'],
  ], ['Under four-neighbor connectivity, do two cells touching only diagonally connect?', ['No; only shared horizontal or vertical edges connect.', 'Yes; diagonal contact is always part of matrix traversal.', 'Only if the matrix is square.'], 'Connectivity is a contract, not a property inferred from the picture. Test diagonal-only fixtures so eight-neighbor logic cannot silently replace four-neighbor semantics.'], { kind: 'algorithm', algorithm: 'flood-fill' }),
  'bit-manipulation': activity('Clear one lowest set bit at a time within an explicitly bounded nonnegative integer domain.', [
    ['Choose a width', 'Define the supported representation before using JavaScript bitwise operators, which coerce Number operands to signed 32-bit integers.'],
    ['Clear one bit', 'For a valid positive value, combining it with one less removes exactly its lowest set bit.'],
    ['Count transitions', 'Repeat until zero and count successful removals; zero begins with no set bits and needs no special fake iteration.'],
  ], ['Why must a Number-based bitwise algorithm declare its width?', ['JavaScript bitwise Number operations use signed 32-bit coercion.', 'Number preserves arbitrary-width exact bitwise integers.', 'Using a bitwise operator removes all numeric precision constraints.'], 'Arithmetic Number ranges and bitwise conversion are different boundaries. The lab deliberately stays in a small nonnegative range; larger exact integers need an explicit representation.'], { kind: 'algorithm', algorithm: 'bits' }),
  'testing-solutions': activity('Hold a tiny failing counterexample constant while comparing a candidate implementation against a simple oracle.', [
    ['Choose independent truth', 'Use an easy-to-audit enumeration rather than a second copy of the same optimized implementation.'],
    ['Exercise boundaries', 'Include empty input, duplicates, negative values, and a solution requiring distinct positions rather than only typical successes.'],
    ['Preserve the contract', 'Compare results and input mutation; fixing one counterexample must not change the documented task or discard earlier guarantees.'],
  ], ['Why is duplicating the optimized algorithm a weak independent oracle?', ['Both copies can share the same mistaken invariant or boundary.', 'An oracle must always be faster than the candidate.', 'Only manually entered expected values are valid evidence.'], 'Independence makes differential testing useful. A slower direct enumeration on bounded inputs is often more inspectable than a second implementation of the same optimization.'], { kind: 'algorithm', algorithm: 'oracle' }),
};
