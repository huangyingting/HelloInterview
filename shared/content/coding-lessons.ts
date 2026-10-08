import type { Lesson } from '../types';

type CodingLessonInput = Omit<Lesson, 'minutes' | 'objectives' | 'sourceIds' | 'relatedProblemIds' | 'quizTopic'> &
  Required<Pick<Lesson, 'objectives' | 'sourceIds' | 'relatedProblemIds' | 'quizTopic'>>;

function lesson(input: CodingLessonInput): Lesson {
  const words = input.sections.flatMap(section => [section.body, ...(section.bullets ?? [])])
    .join(' ').trim().split(/\s+/).length;
  return { ...input, minutes: Math.max(3, Math.ceil(words / 200)) };
}

export const codingLessons: Lesson[] = [
  lesson({
    id: 'introduction',
    title: 'A method for coding interviews',
    group: 'Foundations',
    summary: 'Turn an unfamiliar prompt into a precise contract, a justified algorithm, and evidence that it works.',
    objectives: ['Clarify inputs, outputs, and constraints before coding.', 'Explain a baseline and a useful invariant.', 'Validate an implementation with deliberate examples.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-number'],
    relatedProblemIds: ['alg-pair-load', 'alg-frequent-tags'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'Translate the story into a contract',
        body: `Start by separating the setting from the computational task. A scheduling story might ask for a boolean, a count, a list of indices, or an optimal arrangement; those are different contracts even when the nouns sound similar. Restate what one input element means, whether ordering matters, and what a successful result represents. Clarify empty inputs, duplicate values, mutation permissions, and the representation of failure. Ask about constraints because an approach that comfortably handles hundreds of elements may fail on millions. When a prompt already provides these details, summarize them rather than reopening settled questions. For a pair search, distinguish two distinct positions from two distinct values: repeated values can form a valid pair if they occupy different positions. In JavaScript, also establish whether arithmetic stays within the safe integer range. This translation gives you concrete examples and prevents a technically correct algorithm from solving the wrong problem.`,
      },
      {
        title: 'Build a baseline before choosing a pattern',
        body: `A baseline is an executable description of the task, not an admission of defeat. For pair existence, enumerate each pair of distinct positions and compare its sum with the target. The baseline makes completeness obvious because every permitted candidate is inspected. Then identify repeated work. Are the same sums rebuilt, the same membership questions asked, or the same subproblems solved? Match an improvement to that repetition. Sorted values offer directional elimination; a frequency table offers reusable membership information; a recurrence offers reusable subproblem results. Do not select a technique merely because the prompt contains a familiar keyword. Explain what assumption makes the technique valid and what information its state preserves. A short candidate comparison is usually more valuable than reciting a catalog of patterns. Keep the simple baseline available as a testing oracle on small inputs, where its cost is acceptable and its straightforward logic is easy to inspect.`,
      },
      {
        title: 'Make the reasoning visible',
        body: `Before writing the main loop, describe its state in ordinary language. An invariant states something that is true before each iteration and remains true afterward. A progress argument states why the loop cannot continue forever. Together they explain more than a walkthrough of syntax. For example, two pointers delimit the remaining candidate region, and every movement removes a position whose possible pairs have already been ruled out. During implementation, give variables names that reflect these roles and specify whether a range includes its right endpoint. Narrate decisions rather than every keystroke. If you change the representation, explain the tradeoff: a copied sorted array protects the caller but consumes additional storage. Distinguish returned output from auxiliary working space, and remember that recursive calls occupy a stack. Correctness, termination, time, and space are separate claims; make each claim explicitly instead of treating a passing example as proof.`,
      },
      {
        title: 'Finish with evidence and a clear summary',
        body: `Test the smallest legal inputs first because they reveal assumptions hidden by ordinary examples. Follow with a typical case, duplicates, boundary values, and a case where no solution exists. Trace the state at the moment an answer becomes known, not only the final output. If a test fails, identify the violated invariant before changing a condition. Random small cases compared with the baseline can uncover interactions that handpicked examples miss, but they do not replace a correctness explanation. Finally, summarize the contract, the key invariant, the cost under stated assumptions, and any remaining limitations. If hashing is involved, label constant lookup as an expected hashing-model assumption rather than a JavaScript guarantee. If integer arithmetic is involved, mention precision constraints. A strong finish demonstrates that you can assess your own code and communicate why another engineer should trust it.`,
        bullets: ['Use examples as evidence, a proof as justification, and constraints as the boundary of your claims.'],
      },
    ],
    exercise: 'For alg-pair-load, write a contract, a quadratic oracle, and a two-pointer invariant before coding. Create six cases covering empty input, one element, duplicates, negative values, success, and failure; explain which assumption each case checks.',
  }),
  lesson({
    id: 'complexity',
    title: 'Time, space, and implementation costs',
    group: 'Foundations',
    summary: 'Analyze work using the actual input representation, operation costs, and numeric constraints.',
    objectives: ['Separate worst-case, expected, and amortized bounds.', 'Account for preprocessing, recursion, and output storage.', 'State JavaScript collection and numeric assumptions accurately.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-map', 'js-sort', 'js-number'],
    relatedProblemIds: ['alg-frequent-tags', 'alg-peak-workload'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'Choose the variables before counting work',
        body: `Complexity describes how resource usage grows with an input, so begin by naming the quantities that drive work. An array has length n; a graph has V vertices and E edges; a text collection may have both a number of strings and a total number of characters. These distinctions prevent misleading statements such as calling a graph traversal linear without specifying what is linear. Count operations that dominate at scale and explain why each operation occurs a bounded number of times. Two nested loops are not automatically quadratic: one may run a fixed number of times, or the inner cursor may only move forward across the entire execution. Conversely, one visible loop may hide expensive substring creation, copying, sorting, or repeated searches. Analyze the complete procedure, including setup and cleanup, rather than only the loop that looks like the algorithm. Keep numeric magnitudes separate when an algorithm searches a range of candidate answers.`,
      },
      {
        title: 'Distinguish three kinds of guarantees',
        body: `A worst-case bound covers every allowed input under the stated operation model. An expected bound depends on an explicit probabilistic model, such as well-behaved hashing. An amortized bound averages a sequence of operations without assuming random input. A resizable array can occasionally copy many elements while still having constant amortized append cost in a suitable implementation model. A monotonic stack can pop many entries in one iteration, yet each entry is pushed and popped at most once across the run. These are different explanations and should not be interchanged. JavaScript Map requires average access time sublinear in the collection size; the specification does not promise constant time or a particular hash table implementation. It is reasonable to analyze a frequency-map solution with expected constant-time operations under a hashing model, provided you label that assumption. For guarantees independent of that model, discuss a different representation or leave collection costs parameterized.`,
      },
      {
        title: 'Count all the space you create',
        body: `Auxiliary space is working storage beyond the supplied input and required returned output. Output space matters too, but report it separately when the distinction clarifies the algorithm. A traversal returning every vertex necessarily creates linear output even if its additional bookkeeping is small. Recursive calls are not free: a depth-first search can use stack depth proportional to the longest active path. A copied input array counts as auxiliary storage, and sorting it does not erase that cost. JavaScript Array.sort mutates its receiver and is stable under the language specification, but the specification does not mandate its algorithm or complexity. A particular engine's strategy is not a universal language guarantee. If you assume comparison sorting with an O(n log n) implementation, state that assumption and avoid claiming constant extra sorting space without evidence. Numeric comparators are needed for numerical order; the default comparison orders string representations instead.`,
      },
      {
        title: 'Relate asymptotics to concrete constraints',
        body: `Asymptotic notation suppresses constants, which is useful for growth comparisons but insufficient for every engineering decision. A dense table may beat a hash structure when the key range is small; an exponential search may be acceptable for a dozen choices but not a hundred. Estimate the number of states, the size of each state, and any repeated allocations before coding. Number represents integers exactly only within the safe range from negative 9007199254740991 through positive 9007199254740991. Even individually safe inputs can produce an unsafe accumulated sum. If the contract needs larger exact integers, BigInt or another explicit representation changes both implementation and arithmetic-cost assumptions. Avoid silently converting large values through bitwise operations, which apply signed 32-bit conversion to Number operands. End an analysis with the variables, operation model, dominant bound, and storage breakdown. That precise statement is more useful than an isolated O(n) label with hidden assumptions.`,
      },
    ],
    exercise: 'Compare sorting, frequency counting, and a heap for alg-frequent-tags. Parameterize the analysis by total tags, distinct tags, and requested output size, and separate input copying from returned output.',
  }),
  lesson({
    id: 'arrays-hashing',
    title: 'Arrays and hashing',
    group: 'Foundations',
    summary: 'Use indexing and keyed summaries to turn repeated scans into reusable information.',
    objectives: ['Choose between direct indexing and keyed counting.', 'Maintain a frequency-map invariant.', 'Handle ties, identity, and hashing assumptions explicitly.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-map', 'js-sort'],
    relatedProblemIds: ['alg-frequent-tags', 'alg-pair-load'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'Represent exactly the information you need',
        body: `An array gives convenient positional access when the domain is a dense range of indices. A map associates arbitrary keys with values and is useful when the meaningful domain is sparse, textual, or discovered during processing. Choose the representation from the contract rather than habit. A boolean membership question may need only a set, while repeated labels require counts and a reporting task may need positions as well. For frequent tags, define the map entry as the number of occurrences in the processed prefix. This invariant makes updates simple: reading one tag increases exactly its count by one. Do not store entire occurrence lists unless a later operation needs them. A fixed alphabet can justify a compact indexed table, but arbitrary strings cannot safely be compressed to an assumed alphabet. Estimate both the number of input items and the number of distinct keys because they determine different parts of the cost.`,
      },
      {
        title: 'Treat equality and missing values deliberately',
        body: `JavaScript Map compares keys using SameValueZero: NaN keys compare equal to one another, and positive and negative zero identify the same key. Objects, however, are compared by identity rather than by their field contents. Two separately constructed objects with the same label are not interchangeable keys. If logical equality depends on a field, use that field as the key or define a collision-safe canonical representation. Also distinguish a missing entry from a stored false, zero, or undefined value. A count update can use a nullish fallback when counts are always numeric, while general dictionaries may require has to test membership. String normalization is a separate contract decision; lowercasing, trimming, or Unicode normalization can change which inputs are considered equal. Never apply these transformations silently. They may be helpful for a product feature, but an interview function should honor the supplied equality rules and preserve labels that are meant to remain distinct.`,
      },
      {
        title: 'Separate aggregation from ranking',
        body: `Counting and choosing the most frequent items are two phases with different invariants. First build complete counts so later comparisons use final frequencies. Then choose an ordering, including a deterministic tie rule. For example, descending frequency followed by ascending label makes repeated runs predictable. Sorting only the distinct entries avoids sorting every occurrence, but still costs work proportional to the distinct-key count under the chosen sorting model. A bounded heap can reduce ranking work when only a few results are requested, although its comparator must identify the worst currently retained candidate. Map iteration follows insertion order, not frequency order, so iterating the map alone does not implement a ranking requirement. Array.sort is stable and mutates the array being sorted; stability preserves equal-comparator order but does not invent the desired tie rule. Specify a numeric comparator for numeric counts and deliberately choose how strings are ordered.`,
      },
      {
        title: 'Explain the cost without overpromising',
        body: `Under an expected constant-time hashing model, processing n labels costs expected O(n) time and O(d) map storage for d distinct labels. JavaScript itself only requires average sublinear Map access, so this model is an assumption rather than a language-level guarantee. Sorting d entries with an assumed O(d log d) comparison sort gives an additional ranking term; returned labels occupy output space separately. Test empty input, one repeated label, all distinct labels, ties near the requested cutoff, and a requested count larger than d. Check whether zero requested results should return immediately. For membership-based pair search, inspect before inserting the current value so a single position cannot pair with itself. Conversely, repeated values from earlier positions must remain usable. These small details express the central skill of hashing problems: the map must summarize the already processed data, not accidentally include information from a future step or duplicate the current element.`,
      },
    ],
    exercise: 'Solve alg-frequent-tags with a count map and deterministic ranking. Then replace ranking with a bounded heap and compare outputs against the sort-based implementation on tie-heavy cases.',
  }),
  lesson({
    id: 'two-pointers',
    title: 'Two pointers',
    group: 'Array patterns',
    summary: 'Coordinate positions so each movement eliminates candidates with a proof.',
    objectives: ['Prove directional elimination in a sorted pair search.', 'Use distinct indices and explicit endpoint conventions.', 'Account for sorting, copying, and duplicate semantics.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-sort', 'js-number'],
    relatedProblemIds: ['alg-pair-load'],
    quizTopic: 'two-pointers',
    sections: [
      {
        title: 'Use order to eliminate candidates',
        body: `For a nondecreasing array and a target sum, place one pointer at the first position and the other at the last. The current sum describes the extreme pair inside the remaining inclusive interval. If the sum is too small, the left value cannot pair successfully with any currently eligible value: every other eligible right value is no larger than the current right value. Discard that left position. If the sum is too large, the symmetric argument discards the right position because every eligible left value is no smaller than the current left value. Equality answers the existence question immediately. These arguments, not the pointer syntax, make the technique correct. Negative numbers do not break this sorted pair argument; it relies on order, not positivity. An unsorted input does break the directional reasoning, so sortedness must be an input guarantee or an explicit preprocessing step whose consequences you explain.`,
        diagram: `values:  -4   1   3   8   11     target: 9
         L                R     sum 7: discard -4
              L           R     sum 12: discard 11
              L       R         sum 9: found`,
      },
      {
        title: 'State the invariant and the stopping rule',
        body: `The invariant is that any pair not already ruled out uses two distinct positions inside the current interval. Initially every permitted pair satisfies this statement. Each directional move preserves it by proving that the discarded endpoint cannot belong to a solution with the remaining positions. Continue only while left is strictly less than right. At equality, there is one position remaining, which cannot serve as both members of a pair. This distinction matters for targets equal to twice an array value. An input containing two copies can succeed, while a single copy cannot. Empty and singleton arrays therefore return false without reading an invalid position. Each iteration either returns or reduces the distance between the pointers, giving termination. To return original indices instead of a boolean, the contract and preprocessing representation must change; sorting bare values loses positional identity. Keep the proof aligned with the exact output being requested.`,
      },
      {
        title: 'Recognize other coordinated scans',
        body: `Two pointers describe a family of algorithms rather than one universal recipe. Opposite-end scans exploit an ordered relationship. Same-direction read and write cursors can compact selected values in place. Two independent forward cursors can merge sorted sequences while preserving the smaller next item. In each case, explain what the region before, between, or after the cursors represents. For compaction, the written prefix contains exactly the kept elements from the processed input, while unread positions still preserve future candidates. For merging, the produced output is the correctly ordered prefix of the combined inputs. These invariants differ from pair search, so copying its conditions is not enough. Ask whether each cursor moves only forward or inward and whether total movements are bounded by input length. A visually nested loop can still be linear when neither cursor resets. Cursor names should reflect their roles rather than obscure the proof behind generic letters.`,
      },
      {
        title: 'Keep implementation and arithmetic honest',
        body: `The sorted pair search inspects at most a linear number of pairs and uses constant auxiliary state. If the input needs sorting, include that preprocessing cost under an explicitly chosen sorting model. JavaScript Array.sort mutates its receiver, so copy the array if the contract forbids mutation. Use a numeric comparator; default sorting compares string representations and can put 11 before 3. Stable sorting is required by the specification, but neither stability nor the sort API guarantees a particular runtime complexity. Check arithmetic bounds as well: safe input integers may have a sum outside Number's safe integer range, where equality can no longer be trusted for exact arithmetic. Tests should include duplicates, negative values, a target outside all feasible sums, and pairs touching either endpoint. Compare against an exhaustive pair oracle for small sorted arrays. That comparison checks implementation details while the elimination argument explains why the algorithm works for every allowed array.`,
      },
    ],
    exercise: 'Implement alg-pair-load without mutating its sorted input. Trace every pointer move for [-4, 1, 3, 8, 11] and target 9, then prove why a single value 5 cannot satisfy target 10 but two copies can.',
  }),
  lesson({
    id: 'sliding-window',
    title: 'Sliding windows',
    group: 'Array patterns',
    summary: 'Reuse a range summary when extending and shrinking have predictable effects.',
    objectives: ['Maintain a half-open window and its summary.', 'Prove why nonnegative sums permit shrinking.', 'Recognize constraints for which a sliding window is invalid.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-map', 'js-number'],
    relatedProblemIds: ['alg-window-budget'],
    quizTopic: 'sliding-window',
    sections: [
      {
        title: 'Choose a range convention and a summary',
        body: `A sliding window is a contiguous range whose state can be updated when an endpoint changes. Use a half-open interval [left, right): it contains left but excludes right, and its length is right minus left. A fixed-length sum can be updated by subtracting the leaving value and adding the arriving value. A variable-length window needs a validity rule and a summary that supports both directions of change. For a nonnegative budget problem, the summary is the current sum. For a distinct-label constraint, it may be a frequency map plus a distinct count. Define the summary exactly before writing updates so each addition and removal has a matching operation. The empty range has length zero and sum zero. Consistent endpoint conventions make it easier to reason about the last element, avoid accidental double additions, and describe the state seen by the loop at each iteration.`,
      },
      {
        title: 'Prove the nonnegative budget window',
        body: `For a nonnegative array and a nonnegative budget, extend the right endpoint by one value, then remove values from the left while the sum exceeds the budget. Adding cannot decrease the sum, and removing cannot increase it. Therefore a left endpoint rejected for the current right boundary will also be invalid for any later right boundary unless it is moved forward. Once shrinking restores validity, the retained window is the longest valid window ending at this right boundary among starts not already eliminated. Earlier starts were either rejected at a previous step or removed during this one. Update the best length only after validity is restored. Both endpoints move in one direction and never exceed n, so the total number of additions and removals is linear even though shrinking occurs inside the outer loop. Zero values are allowed: shrinking may remove zeros without changing the sum, but the left cursor still advances.`,
        diagram: `budget = 5, values = [2, 1, 4, 0]
[0, 2): sum 3, length 2
extend to [0, 3): sum 7
remove 2 -> [1, 3): sum 5, length 2
extend to [1, 4): sum 5, length 3`,
      },
      {
        title: 'Know when monotonicity disappears',
        body: `The same budget rule does not work for arbitrary negative numbers. With budget 3, the sequence [4, -2] has a valid full window with sum 2. An algorithm that removes 4 immediately when its one-element window exceeds 3 has discarded the start of the best answer before the negative value arrives. Future additions can restore validity, so the elimination proof fails. This does not mean every problem involving negative values forbids windows; it means this particular sum constraint lacks the required monotonic behavior. Alternatives may involve prefix sums, ordered structures, or a different invariant, depending on whether the objective is exact sum, maximum length, or minimum length. Similarly, a window summary is insufficient if validity depends on detailed order that cannot be updated efficiently. Test the logical property of extending and shrinking, rather than treating contiguous input as automatic evidence for a sliding-window solution.`,
      },
      {
        title: 'Generalize carefully and test boundaries',
        body: `For a no-repeated-label window, increment the entering label's count and shrink until all counts satisfy the rule. Remove zero-count entries or maintain a distinct counter consistently; otherwise stale keys can inflate your summary. Under an expected constant-time hashing model, map updates give expected linear processing, but JavaScript Map only promises average sublinear access and does not guarantee constant time. A sum-only window uses constant auxiliary space and must keep accumulated arithmetic within the stated Number precision bounds. Test an empty input, an all-zero array, an element larger than the budget, a zero budget, and a best window ending at the final element. Also test negative inputs against the contract: either reject them deliberately or document that they are outside the supported domain. Do not silently run a nonnegative proof on a broader input. For confidence, compare with an exhaustive contiguous-range oracle on many small nonnegative arrays.`,
      },
    ],
    exercise: 'Solve alg-window-budget with half-open boundaries. Build a quadratic oracle and verify nonnegative cases, then demonstrate exactly where the same implementation fails on [4, -2] with budget 3.',
  }),
  lesson({
    id: 'prefix-sum',
    title: 'Prefix sums and range queries',
    group: 'Array patterns',
    summary: 'Precompute cumulative information and answer ranges by subtracting shared work.',
    objectives: ['Define an exclusive prefix array with a zero sentinel.', 'Translate inclusive queries without off-by-one errors.', 'Use prefix frequencies for exact-sum counting.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-map', 'js-number'],
    relatedProblemIds: ['alg-prefix-queries'],
    quizTopic: 'prefix-sum',
    sections: [
      {
        title: 'Give every prefix an exact meaning',
        body: `Define prefix[k] as the sum of the first k input values, meaning positions in the half-open range [0, k). Then prefix[0] is zero and prefix[k + 1] equals prefix[k] plus values[k]. This creates n plus one entries for n values. The extra zero entry is useful rather than wasteful: it lets a range beginning at the first element use the same formula as every other range. The sum of [left, right) is prefix[right] minus prefix[left], because the contribution before left appears in both totals and cancels. This is a statement about the representation, not a memorized trick. Trace a tiny array by hand and label every prefix entry with the number of elements it covers. That practice catches the common mistake of mixing a prefix indexed by element position with a prefix indexed by boundary position.`,
        diagram: `values:          3   -1    5    2
boundary:     0    1    2    3    4
prefix:       0    3    2    7    9
sum [1, 4) = prefix[4] - prefix[1] = 6`,
      },
      {
        title: 'Translate the query contract once',
        body: `Many interfaces supply inclusive queries [left, right], where both endpoint elements belong to the answer. Translate that contract to the half-open formula by using prefix[right + 1] minus prefix[left]. Do not mix endpoint conventions in different branches for special cases. Validate that indices are integers and satisfy the required range, if validation is part of the function's contract. An empty half-open range has equal boundaries and returns zero; an inclusive range usually has no analogous empty representation unless the contract explicitly defines one. A prefix table takes linear preprocessing time and storage, then answers each arithmetic range query in constant time under fixed-cost arithmetic assumptions. For q queries, describe the complete cost as O(n + q), not merely constant time. The method assumes the underlying array stays unchanged. After updates, the old prefixes are stale, and a different data structure may be needed for repeated online queries.`,
      },
      {
        title: 'Turn exact sums into prefix relationships',
        body: `For an exact target sum, a range ending at boundary right has the desired sum when an earlier prefix equals prefix[right] minus target. This converts a contiguous-range question into a membership or frequency question. Seed the frequency map with zero appearing once so ranges starting at the first element are counted. At each new prefix, first count the matching earlier prefixes, then insert the current prefix. Reversing those steps can count an empty range when the target is zero. Use frequencies rather than a set when several earlier boundaries share the same cumulative value; each boundary can produce a different valid range. Unlike the simple nonnegative sliding window, this relationship remains valid with negative values because it uses algebraic cancellation, not monotonic growth. The map must summarize only boundaries already processed. That temporal invariant explains both the update order and the need for the initial zero boundary.`,
      },
      {
        title: 'Account for precision and choose the right variant',
        body: `Cumulative values can grow larger than individual inputs, so check the maximum possible prefix magnitude before relying on exact Number arithmetic. The safe integer boundary is 9007199254740991 in magnitude; cancellation does not repair precision already lost while constructing prefixes. BigInt can preserve exact integer sums when the contract permits that representation, but cannot be casually mixed with Number operands. Frequency-based counting also needs bounds on the number of matching ranges, which can be quadratic even though processing is linear. Under an expected constant-time hashing model, exact-sum counting runs in expected O(n) time with O(n) distinct-prefix storage; JavaScript Map does not itself guarantee constant lookup. Test all-zero values, negative values, a full-array query, a singleton query, and adjacent boundaries. Explain which prefix technique you chose: static range queries, exact-sum counting, and two-dimensional sums share the cumulative idea but maintain different state and have different output requirements.`,
      },
    ],
    exercise: 'For alg-prefix-queries, document whether each query is inclusive and translate it to one formula. Test the whole array, first and last singletons, negative values, and repeated queries; separately derive exact-sum counting from the prefix identity.',
  }),
  lesson({
    id: 'intervals',
    title: 'Intervals and boundary semantics',
    group: 'Array patterns',
    summary: 'Sort ranges and reason about overlap using an explicit endpoint contract.',
    objectives: ['Distinguish closed and half-open interval overlap.', 'Prove a sorted merge invariant.', 'Preserve caller data and deterministic ordering.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-sort'],
    relatedProblemIds: ['alg-merge-slots', 'alg-choose-slots'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'Decide what touching endpoints mean',
        body: `An interval is more than a pair of numbers: its endpoint convention determines overlap. Closed intervals [a, b] include both ends, so [1, 3] and [3, 5] overlap at 3. Half-open intervals [a, b) exclude the right endpoint, so these same numeric boundaries can describe consecutive reservations with no shared time. Some merge contracts combine adjacent half-open ranges anyway because the union remains a single range; that is an adjacency rule, not evidence of shared occupancy. State whether touching should merge, whether zero-length ranges are permitted, and whether reversed endpoints are invalid or normalized. These choices determine whether the comparison uses less-than or less-than-or-equal. Avoid vague words such as conflicting until they are tied to a precise mathematical condition. Draw two ranges that touch and two that are separated by a small gap. If your explanation cannot predict both outputs, the contract is not ready for implementation.`,
      },
      {
        title: 'Sort so only the current range can matter',
        body: `Sort intervals by ascending start, using ascending end as a deliberate tie rule. Maintain a current merged interval and a list of completed intervals. The invariant is that completed intervals are ordered, mutually separate under the contract, and can never overlap any unprocessed interval. Why is finalization safe? Once the next interval starts after the current end, every later interval starts at least as far right. No later interval can reconnect the current range across that gap. If the next interval overlaps or satisfies the chosen adjacency rule, extend the current end to the maximum of both ends. Do not replace it blindly with the next end: nested intervals can have a smaller end and would incorrectly shrink the union. At the end, emit the final current interval. Empty input has no current interval, so handle it before trying to initialize from the first element.`,
        diagram: `sorted ranges: [1, 6]  [2, 3]  [5, 8]  [10, 12]
current end:      6  ->    6  ->    8
completed:                               [1, 8]
next current:                            [10, 12]`,
      },
      {
        title: 'Separate merging from scheduling',
        body: `Merging computes a representation of covered space. Selecting the largest number of nonoverlapping intervals is a different objective with a different ordering: an earliest-finish greedy rule may apply. Finding the maximum simultaneous demand instead uses events or a sweep structure. Do not apply a merge routine simply because every input item has a start and an end. For sweep events at equal coordinates, the endpoint convention determines whether departures happen before arrivals. Half-open bookings normally release capacity before another booking starts at that time. Closed occupancy may require the opposite treatment when a shared endpoint counts as simultaneous. Write these tie rules explicitly in the comparator or in grouped event processing. Sorting makes many interval problems manageable because it turns global interactions into a frontier, but the frontier's state depends on the objective. Explain exactly what information completed ranges, active events, or selected reservations retain and what information they intentionally discard.`,
      },
      {
        title: 'Protect data and test structure, not only values',
        body: `JavaScript Array.sort mutates the array, so copy the outer array when mutation is forbidden and use a numeric comparator for coordinates. A shallow outer copy still shares inner interval arrays or objects. If merging changes an endpoint inside those shared objects, the caller is still mutated; construct fresh output intervals instead. Stable sorting is specified, but do not rely on stability to resolve a meaningful tie rule that was never encoded. Runtime and auxiliary sorting storage depend on the implementation rather than a mandated language algorithm. Under an assumed O(n log n) comparison sort, merging adds O(n) scan time. Output can contain n intervals; report that separately from working state and copied-input storage. Test identical intervals, nesting, touching, disjoint ranges, negative coordinates, and one range covering all others. Verify that the union is preserved and that output is ordered and nonoverlapping under the stated semantics.`,
      },
    ],
    exercise: 'Solve alg-merge-slots using its declared touching rule and fresh output intervals. Write a test that snapshots the input before execution, and explain why nested [2, 3] must not shrink a current [1, 6].',
  }),
  lesson({
    id: 'stacks',
    title: 'Stacks and monotonic frontiers',
    group: 'Data structures',
    summary: 'Use last-in-first-out state for nested structure and unresolved comparisons.',
    objectives: ['Explain a stack invariant for balanced signals.', 'Derive strict next-higher comparisons.', 'Use amortized analysis for a monotonic stack.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms'],
    relatedProblemIds: ['alg-balanced-signals', 'alg-next-higher'],
    quizTopic: 'stacks',
    sections: [
      {
        title: 'A stack records the most recent unresolved obligation',
        body: `A stack exposes the last item added before older items, which matches tasks where the newest unfinished operation must finish first. For balanced bracket-like signals, push each opening symbol and inspect the top when a closing symbol arrives. The closing symbol must match the most recent unmatched opening symbol, not merely some opening symbol anywhere in the prefix. Counting openings and closings alone therefore misses crossing structures. The invariant is that the stack lists exactly the unmatched openings in their original order after processing the current prefix. An unexpected closing symbol violates the contract immediately; a nonempty stack at the end means obligations remain unresolved. Decide whether other characters are ignored or rejected according to the problem definition. The empty sequence is balanced when the contract permits it. This explanation generalizes to nested expressions, undo histories, and iterative simulations of recursive work, though each application stores different frame information.`,
      },
      {
        title: 'Monotonic stacks retain unresolved candidates',
        body: `For each array position, suppose the goal is to find the first later value that is strictly higher. Keep indices whose answers are not yet known. When a new value arrives, it resolves every stack-top position with a smaller value, because this is the first later element encountered that satisfies that position's requirement. Pop and record the current index or value according to the output contract. Stop when the top is equal or larger, then push the current position. The retained values are nonincreasing from bottom to top, including equal values when the requirement is strict. Equality matters: popping equal values would answer a strictly-higher query with a merely equal element. Store indices rather than just values when distances or original positions are required. Every popped position is finalized once; every retained position continues waiting. A sentinel for no answer must be chosen from the contract rather than inferred from input values.`,
        diagram: `values: [2, 2, 5, 3]
index 0 -> stack [0]
index 1 -> stack [0, 1]       equal does not resolve
index 2 -> resolve 1 and 0    both first see higher value 5
index 3 -> stack [2, 3]       remaining positions have no answer`,
      },
      {
        title: 'Prove the total work across all iterations',
        body: `A monotonic-stack loop often contains a while loop inside a for loop, but that shape does not imply quadratic work. Charge each push to its input position and each pop to the position being removed. A position is pushed once and popped at most once, so the total stack operations are linear. This is an amortized accounting argument over the whole execution, not a claim that every individual iteration is constant time. One arriving maximum can pop nearly the entire stack, yet those entries cannot be popped again later. The correctness proof is separate: a position remains unresolved until the first qualifying later element appears, and stack order makes every smaller exposed candidate eligible for resolution. If a larger top blocks access to a deeper candidate, monotonic ordering tells you that deeper candidate is also too large or equal for the current value. That structural argument justifies stopping rather than searching the entire stack.`,
      },
      {
        title: 'Use explicit operations and adversarial tests',
        body: `In JavaScript, an array with push and pop provides a convenient stack interface. Reading the top requires checking length before indexing the last element; an empty stack is not a matching opening symbol. Avoid copying the stack at each operation, because spreading or slicing inside the loop adds work absent from the abstract analysis. For balanced signals, test a closing symbol first, incomplete openings, properly nested mixed pairs, and equal counts with incorrect nesting. For next-higher queries, test strictly increasing values, strictly decreasing values, all equal values, repeated plateaus followed by a maximum, and empty input. Explain both auxiliary stack space and returned answer space: each can be O(n), even though the algorithm is linear time. Recursive algorithms also use stack-like state, but the runtime call stack has practical depth limits. An explicit stack can avoid those limits while still requiring the same asymptotic storage for pending work.`,
      },
    ],
    exercise: 'Implement alg-balanced-signals and alg-next-higher. For [2, 2, 5, 3], trace stored indices and explain the strict inequality; then count pushes and pops on a decreasing array followed by one large value.',
  }),
  lesson({
    id: 'linked-lists',
    title: 'Linked lists and pointer ownership',
    group: 'Data structures',
    summary: 'Change links safely and reason about identity, reachability, and cycles.',
    objectives: ['Reverse links without losing the unprocessed suffix.', 'Distinguish node identity from equal node values.', 'Explain slow-and-fast cycle detection.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-map'],
    relatedProblemIds: ['alg-chain-reverse', 'alg-chain-cycle'],
    quizTopic: 'linked-lists',
    sections: [
      {
        title: 'Understand the representation before changing it',
        body: `A singly linked list consists of nodes with values and next references, plus a reference to the first node. Unlike an array, it does not offer constant-time access to an arbitrary position. Reaching the kth node requires following links from a known starting point. Node identity matters: two nodes can hold equal values while representing different positions, and a cycle exists only when references revisit the same node. Clarify whether the input is acyclic, whether links may be mutated, and whether the function must return existing nodes or a copied structure. A diagram of references is often more informative than a sequence of values. Empty input has a null head; the final node in an ordinary finite list has a null next reference. These termination markers belong to the representation contract. An array-based runner may serialize a list differently, so distinguish the algorithm's node model from the transport format used by tests.`,
      },
      {
        title: 'Reverse one link while preserving both regions',
        body: `To reverse a list in place, keep previous and current references. Before changing current.next, save the original next reference. Point current.next to previous, then advance previous to current and current to the saved successor. The saved reference is essential: overwriting the link first would otherwise lose access to the unprocessed suffix. The invariant divides the input into two regions. Previous heads a correctly reversed processed prefix, and current heads the untouched remaining suffix. Each iteration moves one node from the suffix into the reversed prefix, preserving every original node exactly once. When current becomes null, previous is the new head. An empty list needs no special pointer assignment, and a singleton keeps its identity with a null next link. This algorithm mutates links, so it is inappropriate when the caller requires the original topology unchanged; copying nodes trades additional storage for that preservation requirement.`,
        diagram: `before: previous -> B -> A -> null    current -> C -> D -> null
save:   successor = D
rewire: C -> B -> A -> null
advance: previous = C, current = D`,
      },
      {
        title: 'Detect cycles by relative progress',
        body: `A visited-node set provides a straightforward cycle test: follow links and report a cycle if a node identity repeats. A slow-and-fast method avoids that linear set storage. Move one reference one link and the other two links per iteration, checking that the faster reference and its next link exist before advancing. If the faster reference reaches null, the chain is finite. If both references enter a cycle, their relative position changes by one modulo the cycle length, so they eventually meet at the same node. Equal values do not establish a meeting. The initial shared head is not itself proof of a cycle; compare after progress or use a loop structure that reflects this distinction. Finding the cycle entrance requires an additional argument and phase, not merely returning the meeting point. Keep the requested output limited to the cycle-existence contract unless the problem explicitly asks for more.`,
      },
      {
        title: 'Test identity and avoid accidental quadratic work',
        body: `Reversal visits each node once and uses constant auxiliary reference storage; the returned head is not a newly allocated list. Cycle detection with two cursors also uses constant auxiliary storage and linear time in the reachable prefix plus cycle size. A visited set has linear storage under a keyed-collection model, with expected access assumptions if analyzed as hashing. JavaScript Map uses object identity for object keys, which matches node identity but does not equate separately created value copies. Do not repeatedly walk from the head to locate the next position; that can turn a linear transformation into quadratic work. Test empty and singleton chains, two nodes, repeated values in different nodes, a self-cycle, a tail linked to an interior node, and an ordinary null-terminated chain. Avoid serializing a cyclic structure with a routine that assumes termination. For reversal tests, verify node identity, link direction, and that the old head becomes the terminal node.`,
      },
    ],
    exercise: 'For alg-chain-reverse, draw the processed and unprocessed regions before each assignment. For alg-chain-cycle, compare an identity-set oracle with slow-and-fast traversal on repeated values, a self-cycle, and a long acyclic prefix leading into a cycle.',
  }),
  lesson({
    id: 'binary-search',
    title: 'Binary search on an invariant',
    group: 'Search',
    summary: 'Find a monotone boundary and prove that every update preserves the answer.',
    objectives: ['Implement a first-true boundary with a clear sentinel.', 'Derive a monotone capacity-feasibility predicate.', 'Include predicate cost and safe midpoint arithmetic.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-number'],
    relatedProblemIds: ['alg-first-threshold', 'alg-peak-workload'],
    quizTopic: 'binary-search',
    sections: [
      {
        title: 'Search for a boundary, not just a value',
        body: `Binary search works when a predicate changes monotonically across an ordered domain. For a nondecreasing array and threshold, the predicate values[index] is at least threshold is false on a prefix and true on a suffix. The useful answer is the first true position, which may be the array length if no element qualifies. Use boundaries left equal to zero and right equal to n. Treat n as an answer sentinel, not as an element to read. The invariant says positions before left are known false, positions from right onward are known true within the array, and the first true boundary remains between left and right inclusive. When left is smaller than right, a midpoint strictly below right is a valid array index. This formulation handles duplicates naturally because equality belongs to the true side. Decide separately whether the public function returns n, a special missing value, or a boolean derived from the boundary.`,
      },
      {
        title: 'Preserve the invariant and shrink the range',
        body: `Compute mid as left plus Math.floor((right minus left) divided by two). If the predicate is false at mid, every earlier position is also false, so set left to mid plus one. If the predicate is true, mid may be the first true position, so retain it by setting right to mid. Either update makes the remaining boundary interval smaller. At termination, left equals right and the invariant identifies the answer. Avoid adding or subtracting one mechanically: the two branches differ because a false midpoint is eliminated while a true midpoint remains a candidate. Do not use a bitwise shift as a general midpoint shortcut in JavaScript; Number bitwise operations convert operands to signed 32-bit integers and can corrupt larger indices. Even ordinary arithmetic needs representable endpoints and intermediate values. Explain the empty-array case through the same invariant rather than inventing a separate search algorithm.`,
        code: `let left = 0;
let right = values.length;
while (left < right) {
  const mid = left + Math.floor((right - left) / 2);
  if (values[mid] >= threshold) right = mid;
  else left = mid + 1;
}
return left;`,
      },
      {
        title: 'Search an answer space with a feasibility oracle',
        body: `The same boundary idea can search minimum capacity for processing nonnegative workloads in contiguous days. For a candidate capacity, scan workloads in order and start a new day when the next workload would exceed it. Reject any individual workload larger than capacity. The greedy scan uses the minimum possible number of days for that capacity: filling the current day as far as possible cannot make a later partition start earlier than a competing feasible partition. A capacity is feasible when this minimum day count is at most the allowed number. Increasing capacity cannot destroy an existing partition, so feasibility is monotone. For nonempty input, the maximum individual workload is a lower bound and the total workload is a feasible upper bound when at least one day is allowed. Clarify empty input and invalid day counts from the contract. The predicate proof and the binary-search proof are separate obligations.`,
      },
      {
        title: 'Measure oracle work and test the transition',
        body: `Searching an array boundary uses logarithmically many constant-cost predicate evaluations. Searching capacities uses logarithmically many scans, so its cost is O(n log R) for an integer candidate range of size R under fixed-cost arithmetic assumptions. Do not omit the n because the loop that computes the midpoint looks logarithmic. Maximum and total bounds also require a preprocessing scan, and accumulated totals must remain within Number's safe integer range for exact arithmetic. Test a predicate that is all false, all true, true only at the last position, and true from the first position. For workload capacity, test one workload, zeros, one allowed day, and more allowed days than workloads if that is permitted. Verify the returned capacity is feasible and the previous smaller integer is infeasible when it lies in the domain. These boundary properties provide stronger evidence than checking one expected answer and directly reflect what the search claims to find.`,
      },
    ],
    exercise: 'Implement alg-first-threshold with a length sentinel internally. For alg-peak-workload, test the capacity predicate separately, then verify both feasibility of the answer and infeasibility of the preceding integer.',
  }),
  lesson({
    id: 'heaps',
    title: 'Heaps and bounded selection',
    group: 'Data structures',
    summary: 'Maintain the best available priority or a small frontier of selected candidates.',
    objectives: ['State the heap-order property without assuming full sorting.', 'Choose the correct root for bounded top-k selection.', 'Define comparator ties and analyze heap size.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-sort'],
    relatedProblemIds: ['alg-top-priorities', 'alg-frequent-tags'],
    quizTopic: 'heaps',
    sections: [
      {
        title: 'A heap orders parent relationships, not the whole array',
        body: `A binary heap stores a complete binary tree in an array. With zero-based indexing, a node's parent is floor((index minus one) divided by two), and its children are at twice the index plus one and twice the index plus two. In a min-heap, every parent compares no greater than its children; a max-heap reverses that relation. The root is therefore an extremum, but siblings and distant entries need not be globally sorted. Inserting appends a value and restores order upward. Removing the root moves the final value to the root and restores order downward by swapping with the better child. These paths have logarithmic length because the tree is complete. The implementation must handle a node with only one child and an empty heap. A comparator defines priority consistently across every operation; mixing numeric direction or tie rules breaks the same property that makes root access meaningful.`,
      },
      {
        title: 'Keep the worst selected candidate at the root',
        body: `To retain the largest k values while scanning input, use a min-heap of at most k selected values. The smallest selected value is the easiest one to replace. Until the heap reaches k entries, insert each candidate. Afterwards, ignore a value no better than the root and replace the root when a better value arrives. The invariant is that the heap contains the best k processed candidates, or all processed candidates when fewer than k exist. Do not use a max-heap for this particular strategy: its root would hide the worst selected candidate and make replacement difficult. If output requires descending order, heap contents must be extracted or sorted appropriately; the internal array alone is not a sorted result. Decide whether equal priorities keep both occurrences, deduplicate items, or apply a secondary key. That choice belongs to the contract and must be reflected in the comparator and output.`,
      },
      {
        title: 'Distinguish selection from scheduling frontiers',
        body: `A heap can also represent all currently available choices, as in selecting the next job by priority or processing the smallest tentative distance in a graph. In those applications, the heap root is the next item to act on, not the worst item among a bounded selected set. This change of role changes the comparator direction and the size analysis. When entries can become stale, as with a revised tentative distance, one practical design inserts a new entry and ignores old entries when removed. Another design maintains positions to support priority updates, adding bookkeeping complexity. JavaScript has no universal built-in heap interface, so an original implementation should expose a small consistent API and test it independently. Do not assume sort stability gives a heap stable behavior. If insertion order matters among equal priorities, store an explicit sequence number and include it in comparisons. Deterministic choices make debugging and reproducible tests much easier.`,
      },
      {
        title: 'Account for k and verify the structure',
        body: `Bounded selection performs at most logarithmic work in k for each input item, giving O(n log k) time when k is at least two, with O(k) auxiliary heap storage. Handle k equal to zero or one directly in both reasoning and code rather than interpreting log zero. Clamp or reject k larger than the input length according to the contract. Returning k values has separate output space, and arranging those values may add O(k log k) work under an assumed comparison-sort implementation. Array.sort mutates its receiver and requires a numeric comparator for numbers; its particular algorithm and complexity are not mandated by JavaScript. Test the heap property after each operation on small cases, then compare selected output against a full-sort oracle. Useful adversaries include increasing input, decreasing input, equal priorities, alternating extremes, and a replacement at the final element. These cases exercise both upward and downward repair, not merely root reads.`,
      },
    ],
    exercise: 'Solve alg-top-priorities with a bounded heap and a sort-based oracle. Explain why the root must be the worst retained item, and test k equal to zero, one, the input length, and a contract-permitted larger value.',
  }),
  lesson({
    id: 'trees',
    title: 'Trees, depth, and level state',
    group: 'Data structures',
    summary: 'Use structural recurrences or level frontiers while tracking stack and queue costs.',
    objectives: ['Define tree depth in nodes versus edges.', 'Derive recursive depth and iterative level sums.', 'Account for height, width, and representation validity.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-number'],
    relatedProblemIds: ['alg-tree-depth', 'alg-level-sums'],
    quizTopic: 'trees',
    sections: [
      {
        title: 'Use the structural contract of a tree',
        body: `A rooted tree has a distinguished root and unique parent relationships for nonroot nodes. In the ordinary binary-tree model, each node has at most two children and the structure contains no cycles or shared child nodes. Those assumptions allow each subtree to be solved independently. If references can point back to ancestors or share descendants, the input is a graph and a naive tree traversal may repeat work or never terminate. Clarify how absent children are represented and whether an empty tree is legal. Also define depth: maximum depth in nodes gives an empty tree zero and a leaf one; maximum depth in edges usually gives a leaf zero and needs an explicit empty-tree convention. Both definitions can be sensible, but their recurrences and expected outputs differ by one. Serialization details, such as null placeholders in a level-order array, are not themselves the tree algorithm. Decode the representation consistently before reasoning about structure.`,
      },
      {
        title: 'Build a recurrence from independent subtrees',
        body: `For node-count depth, define depth(null) as zero and depth(node) as one plus the maximum depth of its left and right subtrees. The recurrence follows from the longest root-to-leaf path: every such path visits the current node and then continues into exactly one child. A recursive implementation evaluates both child depths and combines them after their calls return, which is a postorder computation. Every node is visited once, so time is O(n). The active call stack can reach the tree height h, which is O(n) for a chain and O(log n) for a balanced tree. Do not claim logarithmic stack space merely because the data structure is called a tree. An explicit stack can store nodes with their current depth and update a running maximum, avoiding runtime recursion limits while still using storage for pending traversal state. The recursive proof remains useful even if the final implementation is iterative.`,
      },
      {
        title: 'Freeze the current level before expanding it',
        body: `Level sums require grouping nodes by distance from the root. Use a queue and record the number of current-level nodes before processing that level. Remove exactly that many nodes, add their values, and append their children for the next level. Without the fixed count, newly added children can be mixed into the current sum. The invariant is that the queue's unprocessed current-level segment contains exactly the nodes at one depth in left-to-right discovery order, followed only by children generated for the next depth. An array-backed queue with a head index avoids repeated shift operations and their representation-dependent cost. However, never-compacted backing storage retains all entries, so it occupies O(n) array slots even if the live frontier is narrow. To claim O(w) auxiliary queue storage for maximum width w, use a representation that releases or reuses processed slots rather than merely advancing an index forever.`,
        diagram: `       4
      / \\
     2   7
        / \\
       1   3
level 0: [4]       sum 4
level 1: [2, 7]    sum 9
level 2: [1, 3]    sum 4`,
      },
      {
        title: 'Test shape and numeric aggregation',
        body: `Tree tests should vary shape as well as values. An empty tree checks the base case, a leaf checks the depth convention, a long one-sided chain checks stack behavior, and a wide tree checks queue storage. Negative values and zero values ensure a level-sum routine does not confuse an absent node with a falsy numeric payload. Sum arithmetic must remain within Number's safe integer range if exact integer answers are required; individually safe node values do not guarantee safe level totals. Returned level sums require O(h) output entries, distinct from traversal bookkeeping. A depth function can return a single number while still using a deep stack. When explaining correctness, identify the structural decomposition for depth and the frozen frontier invariant for levels; they solve related problems through different state organizations. If the runner uses array serialization, add tests with missing interior children so decoding cannot accidentally move later nodes into the wrong parent positions.`,
      },
    ],
    exercise: 'Implement alg-tree-depth and alg-level-sums using their exact serialization contracts. Test the same values arranged as a chain and as a wide tree, and report recursion or queue storage separately from returned sums.',
  }),
  lesson({
    id: 'graph-search',
    title: 'Graph traversal',
    group: 'Graphs',
    summary: 'Explore a frontier while proving what discovery means and when shortest-path claims apply.',
    objectives: ['Use BFS for unweighted directed shortest hops.', 'Mark discovered states before enqueuing duplicates.', 'Distinguish DFS reachability from shortest-path search.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms'],
    relatedProblemIds: ['alg-network-route', 'alg-island-count'],
    quizTopic: 'graphs',
    sections: [
      {
        title: 'Define vertices, edges, and discovery',
        body: `A graph traversal begins with a representation and a start state. An adjacency list stores outgoing neighbors for each vertex, making direction explicit. For a directed graph, an edge from A to B does not imply an edge from B to A. Include vertices with no outgoing edges so isolated or terminal states remain representable. Maintain a discovered set or indexed boolean table whose meaning is that the state has already entered the frontier. Mark a vertex when adding it, not only when removing it, so multiple predecessors cannot enqueue duplicates before its first removal. The frontier and discovery state answer different questions: one says what work is pending, the other says what work has already been scheduled. A traversal from one start visits only reachable vertices. To inspect an entire disconnected graph, start a new traversal from each undiscovered vertex according to the task's component or coverage definition.`,
      },
      {
        title: 'Prove shortest hops with breadth-first search',
        body: `Breadth-first search uses a first-in-first-out queue. Assign the start distance zero, and when discovering a neighbor assign the current distance plus one. The queue processes distances in nondecreasing order: nodes at the current distance are removed before nodes newly appended at the next distance. Therefore the first discovery of a vertex gives the fewest edges from the start. This shortest-path claim requires an unweighted graph or equal edge weights; it is not valid for arbitrary weighted routes. A parent reference recorded at discovery reconstructs one shortest route when the output asks for it, while a hop-count-only function can omit parents. If start equals target, the shortest hop count is zero even without traversing an edge. An unreachable target needs the contract's explicit sentinel. Directed edges still work with the same proof because BFS follows only the permitted outgoing adjacency relationships.`,
        diagram: `A -> B -> D
|         ^
v         |
C --------+
queue distances:
A:0 -> B:1, C:1 -> D:2
D is discovered once even though two predecessors reach it.`,
      },
      {
        title: 'Use depth-first search for different questions',
        body: `Depth-first search follows one branch before returning to pending alternatives. A recursive call stack or an explicit stack organizes this frontier. DFS is useful for reachability, component exploration, and structural bookkeeping, but its first route to a target need not use the fewest edges. If the task only asks whether a path exists, either BFS or DFS can be appropriate. If the task asks for shortest hops, prefer the BFS layer invariant. Recursive DFS consumes stack depth proportional to an active path and can exceed practical runtime limits on a long chain. An explicit stack avoids dependence on the runtime call depth but still uses auxiliary storage. A boolean visited marker is enough for ordinary reachability, but not for every structural graph question. Directed cycle detection needs a distinction between currently active vertices and fully completed vertices; reaching a completed vertex is not itself evidence of a cycle.`,
      },
      {
        title: 'Analyze the representation you actually traverse',
        body: `With adjacency lists and constant-cost indexed bookkeeping, a full traversal examines each vertex and outgoing edge at most a bounded number of times, giving O(V + E) time. An adjacency matrix instead requires scanning potential neighbors and can cost O(V squared) even for a sparse graph. Discovery storage and the frontier can each be O(V); a returned route or visit order has separate output space. In JavaScript, an array queue with a head cursor is convenient, but repeated shift calls can add work not accounted for by the abstract queue model. A head-index queue retains its backing entries unless deliberately compacted or reused. Test cycles, self-loops, parallel edges, a disconnected target, direction reversal, and several equally short paths. If a deterministic route is required, define neighbor order or a tie rule; shortest distance alone does not uniquely determine the route. Verify distances against a tiny exhaustive or layer-based oracle on small graphs.`,
      },
    ],
    exercise: 'For alg-network-route, trace the queue, discovered state, and hop count on a directed diamond graph. Add a reverse-direction query, a self-loop, and an unreachable target; explain why DFS is not a shortest-hop substitute.',
  }),
  lesson({
    id: 'graphs',
    title: 'Graph models, weights, and cycle state',
    group: 'Graphs',
    summary: 'Choose the graph abstraction and algorithm from the properties the problem actually supplies.',
    objectives: ['Distinguish directed reachability from undirected connectivity.', 'Select BFS or Dijkstra using edge-weight assumptions.', 'Detect directed cycles with active and completed states.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-map'],
    relatedProblemIds: ['alg-network-route', 'alg-cluster-count', 'alg-release-order'],
    quizTopic: 'graphs',
    sections: [
      {
        title: 'Model relationships before choosing an algorithm',
        body: `Vertices represent states, not necessarily physical locations. An edge represents a permitted transition or relationship, and its direction and weight encode part of the contract. Dependencies are naturally directed; mutual network membership is naturally undirected; a grid can be an implicit graph whose neighbors are generated from coordinates. Ask whether duplicate edges and self-loops are permitted and whether all vertices appear explicitly, including isolated ones. An adjacency list stores work proportional to actual edges, while an adjacency matrix uses space for every possible pair and makes edge membership convenient. The best representation depends on the operations needed, not merely input size. Connectivity in an undirected graph partitions vertices into components. Directed reachability does not form that same symmetric relation: A may reach B while B cannot reach A. Strongly connected components and weak connectivity are distinct questions, so do not reuse an undirected component algorithm without translating the intended semantics.`,
      },
      {
        title: 'Use edge costs to select the frontier rule',
        body: `For unit or equal edge weights, BFS layers produce shortest paths because every edge increases cost by the same amount. With unequal nonnegative weights, Dijkstra's algorithm instead extracts the smallest tentative distance from a priority queue. Nonnegative weights are crucial: once the smallest candidate is finalized, a path through an unprocessed vertex cannot later reduce it using a negative edge. Negative edges require a different method and invalidate this standard finalization proof. Zero-weight edges are allowed by the nonnegative condition, though they can create equal-distance alternatives. A practical heap implementation may contain stale entries after a distance improves; skip an entry whose stored distance no longer matches the best known value. The graph's topology alone cannot justify shortest-cost claims. State whether the task asks for fewest hops, least accumulated weight, reachability, or a concrete route, because these outputs need different bookkeeping and sometimes different algorithms.`,
      },
      {
        title: 'Distinguish active recursion from completed work',
        body: `Directed DFS cycle detection commonly uses three states: unseen, active, and complete. Mark a vertex active when entering its exploration, and complete only after all its outgoing edges have been considered. An edge to an active vertex points back into the current DFS path and establishes a directed cycle. An edge to a complete vertex may simply join a previously explored branch; it is not a cycle by itself. This distinction prevents false positives in a diamond-shaped acyclic dependency graph. A single visited boolean cannot encode both states. In an undirected graph, the reverse edge to the parent must be treated specially, and parallel-edge rules can complicate that treatment. An iterative DFS needs frames or another explicit mechanism to reproduce entry and completion events; merely pushing every neighbor onto a stack does not automatically preserve recursive active-path semantics. Explain what the state means at each event rather than copying a color convention without its proof.`,
      },
      {
        title: 'State costs, identity, and test obligations',
        body: `Adjacency-list traversals typically cost O(V + E) with indexed constant-cost state access. Dijkstra with a suitable binary heap has a logarithmic priority-queue factor, whose precise bound depends on the heap strategy and number of inserted entries. Do not hide representation or stale-entry storage in a generic linear claim. If labels are arbitrary strings and state is kept in maps, use an explicit expected hashing model for constant lookup; JavaScript Map requires average sublinear access, not guaranteed O(1). Object labels compare by identity, so equal-looking newly constructed objects are not the same vertex unless your model says so. Tests should include isolated vertices, direction-sensitive reachability, cycles, acyclic converging branches, and zero-weight edges for weighted variants. Add a negative-edge example to demonstrate why an algorithm's assumption matters, not to claim Dijkstra supports it. Reporting the graph model, frontier rule, and discovery or finalization invariant makes the solution's scope understandable.`,
      },
    ],
    exercise: 'Classify alg-network-route, alg-cluster-count, and alg-release-order by direction, required output, and suitable state. Draw a directed acyclic diamond and a back edge; explain why only the back edge to an active DFS ancestor proves a cycle.',
  }),
  lesson({
    id: 'topological-sort',
    title: 'Topological order and release dependencies',
    group: 'Graphs',
    summary: 'Release zero-indegree tasks, detect cycles, and make valid output deterministic.',
    objectives: ['Maintain indegree for the remaining dependency graph.', 'Detect a cycle using incomplete release count.', 'Choose a deliberate tie policy for available tasks.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-sort'],
    relatedProblemIds: ['alg-release-order'],
    quizTopic: 'graphs',
    sections: [
      {
        title: 'Translate prerequisite direction precisely',
        body: `A topological ordering lists vertices so every directed prerequisite edge points from an earlier vertex to a later one. If task A must finish before task B, represent the edge A to B and count it toward B's indegree. Reversing this interpretation produces a plausible-looking but invalid release order. A valid ordering exists exactly when the directed graph is acyclic. It need not be unique, and disconnected tasks can appear wherever the ordering constraints permit. Include every declared task, even tasks with no dependency edges. Clarify whether duplicate input edges describe repeated records of one dependency or distinct edges. If duplicates are deduplicated in adjacency but not indegree, decrements will not match increments and a valid graph can be falsely reported cyclic. Keep both representations consistent with the contract. Self-dependency is a cycle immediately, but the general release algorithm can detect it without a special logical exception.`,
      },
      {
        title: 'Release tasks whose remaining indegree is zero',
        body: `Compute indegrees and initialize an available frontier with every zero-indegree vertex. Remove an available task, append it to the order, and decrement the indegree of each outgoing neighbor. Add a neighbor when its indegree becomes zero. The invariant says the stored indegree is the number of prerequisite edges from tasks not yet released. A zero value therefore proves that appending this task cannot violate a remaining prerequisite. Each released task removes exactly its outgoing edges from the conceptual remaining graph. If the process emits all vertices, the resulting order satisfies every edge. If tasks remain but the frontier is empty, every remaining task has an incoming remaining edge. Following predecessors in this finite remainder eventually revisits a vertex, showing a cycle. The incomplete emitted count is therefore meaningful evidence of a cycle, not merely a failure to choose a convenient start task.`,
        diagram: `edges: A -> C, B -> C, C -> D
indegree: A=0 B=0 C=2 D=1
release A: C=1
release B: C=0, now available
release C: D=0
release D: complete`,
      },
      {
        title: 'Make deterministic ordering an explicit requirement',
        body: `A queue can produce a valid topological order in linear traversal time, but its output depends on the initial task order and neighbor iteration order. If the contract asks for the smallest available task at each step, use a min-heap or another ordered frontier. Sorting only the initial zero-indegree tasks is insufficient: newly available tasks must compete with tasks already waiting. For example, releasing one task may unlock a label that should precede an older queued label. Define the comparison for labels, numbers, or priority records, including equal-priority tie rules. Lexicographically smallest valid order follows by selecting the smallest currently available vertex at each position; any valid continuation must begin with an available vertex. This deterministic policy is stronger than merely producing some valid order and changes the implementation cost. Do not rely on JavaScript sort stability to create a policy that is absent from the comparator or frontier operations.`,
      },
      {
        title: 'Validate both successful and impossible outputs',
        body: `With adjacency lists and a queue, release processing is O(V + E) after building the representation. An ordered heap frontier adds logarithmic work for available-vertex insertions and removals, typically O(E + V log V) under the usual comparison model. Indegrees, adjacency, and frontier are auxiliary storage, while the returned order contains V entries. Array.sort mutates its receiver; if sorting labels during setup, copy inputs when required and use numeric comparison for numeric identifiers. Test no tasks, isolated tasks, a chain, a diamond, duplicate-edge cases under the contract, a cycle, and a cycle beside an acyclic component. For a successful output, check that each vertex appears once and every edge's source index precedes its target index. For an impossible output, verify the contract's sentinel rather than accepting a partial order as complete. A partial emitted prefix can be internally valid while still failing the requested full-release contract.`,
      },
    ],
    exercise: 'Implement alg-release-order with its deterministic available-task policy. Validate outputs by edge positions, and test a newly unlocked small label competing with an older larger available label, plus a cycle in only one component.',
  }),
  lesson({
    id: 'union-find',
    title: 'Union-find and component accounting',
    group: 'Graphs',
    summary: 'Maintain equivalence classes efficiently while preserving a correct component count.',
    objectives: ['Explain representative roots and successful unions.', 'Combine path compression with size or rank balancing.', 'Distinguish undirected connectivity from directed reachability.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms'],
    relatedProblemIds: ['alg-cluster-count'],
    quizTopic: 'graphs',
    sections: [
      {
        title: 'Model an equivalence relation, not a route',
        body: `Disjoint-set union, often called union-find, maintains a partition of items into nonoverlapping groups. Find returns a representative for an item's group, and union merges two groups. This fits undirected connectivity because being connected is reflexive, symmetric, and transitive. It does not encode a route, distance, or directed reachability. After unions, knowing that two vertices share a representative says they belong to the same component, not which path joins them. Initialize one group per declared vertex, including isolated vertices that never appear in an edge. This detail is essential for component counting. The parent array forms a forest of representative trees, but those trees are bookkeeping structures rather than original graph edges. Their shape can change during optimization without changing the partition. Clarify the label-to-index mapping and whether all edge endpoints belong to the declared universe before applying array-based parent operations.`,
      },
      {
        title: 'Keep root relationships and counts consistent',
        body: `Initially every item is its own parent and the component count equals the number of items. To union two items, first find their roots. If the roots match, the relationship is already represented and the component count must not change. If they differ, attach one root beneath the other and decrement the count exactly once. Attaching an arbitrary nonroot item can fail to merge the entire group or corrupt the intended forest, so union decisions must operate on representatives. Self-loops and repeated edges naturally produce unsuccessful unions and do not reduce the count. The invariant is that two items have the same root exactly when the processed undirected relationships connect their groups. Each successful union decreases the number of sets by one, and no operation creates a new set. This gives a direct accounting proof for the final cluster count rather than requiring a second traversal to enumerate every group.`,
        diagram: `initial: {0} {1} {2} {3}       components 4
union(0,1): {0,1} {2} {3}      components 3
union(1,2): {0,1,2} {3}        components 2
union(0,2): unchanged          components 2`,
      },
      {
        title: 'Balance and compress without changing membership',
        body: `Union by size attaches the smaller representative tree below the larger one and updates the surviving root's size. Union by rank uses an upper-bound-like measure of tree structure; after path compression, rank should not be described as the exact current height. Path compression makes visited nodes point closer to the root during find, reducing future traversal. Full compression can be implemented with a root-finding pass and a rewiring pass, avoiding recursion depth concerns. These transformations preserve membership because every changed parent still leads to the same representative group. Combining compression with size or rank balancing gives a near-constant amortized cost usually described with the inverse Ackermann function, not a universal worst-case constant cost for each individual operation. Keep the stronger claim tied to the complete method. Compression alone and balancing alone have different analyses, so do not cite the combined bound for an implementation that omits one of the ingredients.`,
      },
      {
        title: 'Know the limits and test the partition',
        body: `For n items and m relationships, initialization uses O(n) storage and work, and the optimized operation sequence has near-linear total time under the standard disjoint-set model. A component-count result is constant-size output; parent and size arrays remain auxiliary storage. Ordinary union-find supports incremental merging but not arbitrary edge deletion with the same simple operations. Removing an edge may split a component, which cannot be determined from representative equality alone. Use traversal for static connectivity when that is simpler, and union-find for repeated merge-and-query workloads. Test no edges, all isolated vertices, a connected chain, redundant edges, self-loops, and multiple clusters. Compare small results with an undirected BFS or DFS component oracle. Also test that the number of successful unions equals n minus the final component count. That identity checks accounting independently of root choices, which may differ across equally correct balancing implementations.`,
      },
    ],
    exercise: 'Solve alg-cluster-count with iterative find, compression, and union by size. Compare against a traversal oracle on small undirected graphs and track successful unions separately to verify the component-count identity.',
  }),
  lesson({
    id: 'backtracking',
    title: 'Backtracking and decision trees',
    group: 'Search and optimization',
    summary: 'Explore choices with explicit state restoration and honest output-size accounting.',
    objectives: ['Define a decision tree with complete, unique branches.', 'Restore shared state between sibling branches.', 'Justify pruning from the allowed input domain.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-number'],
    relatedProblemIds: ['alg-subset-loads'],
    quizTopic: 'backtracking',
    sections: [
      {
        title: 'Turn a search space into explicit choices',
        body: `Backtracking explores a decision tree whose nodes represent partial solutions. For subsets of n input positions, the choice at position i is to exclude or include that position, then advance to i plus one. Reaching i equal to n completes one subset. Every subset has one unique sequence of these positional choices, so the branching structure proves completeness and avoids accidental omissions. Equal input values do not necessarily mean duplicate choices: two positions may be distinct selectable items even when their loads match. Clarify whether the output represents subsets of positions, unique value combinations, or only resulting sums. Those contracts have different multiplicity rules. State what the recursive parameters mean, such as the next undecided position and the load of selected positions. The empty subset is a real leaf with load zero unless the contract excludes it. A precise tree model makes the base case and branch order easier to derive.`,
      },
      {
        title: 'Preserve state across sibling branches',
        body: `A recursive call should receive a valid partial state and leave shared mutable state as it found it. If a selected-item array is shared, push the current item before the include branch and pop it afterward. That restoration is essential because the next sibling must not inherit decisions belonging to the previous branch. An immutable numeric running sum can instead be passed as a new argument, avoiding a matching subtraction operation. When storing a completed selection, copy the current array; storing the same mutable array reference repeatedly would make earlier outputs change as exploration continues. A sum-only output can store a scalar directly and needs no selection copy. Branch order determines output order, so make it deterministic when tests require it. The active recursion stack records the current path and consumes O(n) depth even when the explicitly maintained state is small. Recursion is part of the space analysis, not an invisible control mechanism.`,
        diagram: `loads [2, 5]
                     sum 0
                 /exclude 2 \\include 2
               sum 0         sum 2
              /     \\       /     \\
             0       5     2       7
each leaf corresponds to one positional subset`,
      },
      {
        title: 'Prune only when a proof rules out descendants',
        body: `Pruning skips an entire branch only when no descendant can satisfy the requirement. For a maximum-load constraint with nonnegative remaining loads, a partial sum above the limit cannot decrease later, so the branch is impossible. Negative loads break that argument because a later inclusion could restore feasibility. Other pruning rules may use bounds on remaining capacity, sorted candidates, or an objective's best possible continuation, but each rule needs a stated assumption and proof. Do not prune an output-enumeration problem merely because a branch looks uninteresting: if every subset sum is required, each branch contributes output. Duplicate-skipping rules also depend on the contract. Skipping equal values at one decision level may be correct for unique value combinations and incorrect for distinct-position subsets. Separate completeness from efficiency. First establish an enumeration that returns exactly the required objects, then add only optimizations that preserve that set and any promised output order.`,
      },
      {
        title: 'Let output size drive the complexity statement',
        body: `There are 2 to the n positional subsets, so an algorithm returning one sum per subset has exponential output even if each leaf is processed cheaply. The decision tree has the same exponential scale, with O(n) active recursion depth and O(2 to the n) output values. Returning full subsets can require O(n times 2 to the n) total output entries and corresponding copying work. Report these costs separately from auxiliary path storage. Number arithmetic must stay within the safe integer range for exact load sums; input magnitudes and maximum selected count together determine that bound. Avoid a Number bitmask implementation that silently assumes unlimited bits, because JavaScript bitwise operations use signed 32-bit conversion. Test empty input, one item, repeated values, zeros, and branch-sensitive cases. On small inputs, verify the output count and compare the multiset of results with an independent enumeration. A count check alone cannot detect duplicated leaves that replace missing ones.`,
      },
    ],
    exercise: 'For alg-subset-loads, implement positional include/exclude enumeration and verify the output multiset for [2, 5] and [2, 2]. Explain when equal sums must remain repeated and why an above-budget prune would fail with negative loads.',
  }),
  lesson({
    id: 'dynamic-programming',
    title: 'Dynamic programming',
    group: 'Search and optimization',
    summary: 'Define reusable subproblems, prove transitions, and choose a dependency-safe evaluation order.',
    premium: true,
    objectives: ['Derive a minimum-coins state and recurrence.', 'Distinguish unreachable states from valid zero answers.', 'Choose table order and storage from dependencies.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-number'],
    relatedProblemIds: ['alg-min-coins'],
    quizTopic: 'dynamic-programming',
    sections: [
      {
        title: 'Name the subproblem before building a table',
        body: `Dynamic programming reuses answers to overlapping subproblems. The first design decision is the state's meaning, not the table shape. For unlimited reuse of positive integer coin denominations, let dp[a] be the minimum number of coins needed to form amount a exactly. This state is sufficient because future choices depend on the remaining amount, not the order of previously selected coins. If each coin can be used only once, amount alone may be insufficient and the recurrence changes. Clarify the reuse rule, exactness requirement, and allowed denomination values before coding. Positive denominations ensure choosing a coin reduces the remaining amount; zero or negative denominations can invalidate the dependency order or make the state system cyclic. An unreachable amount is not equivalent to a zero-coin solution. The empty amount has a valid answer of zero, while a positive amount with no combination requires a distinct unreachable representation.`,
      },
      {
        title: 'Prove the base case and the transition',
        body: `Set dp[0] to zero and other amounts initially to an unreachable sentinel such as Infinity. For each positive amount a, consider every coin c no larger than a. If a minus c is reachable, using that optimal smaller solution followed by c gives a candidate with one additional coin. Take the minimum across candidates. Every constructed candidate is valid because its smaller amount plus c equals a. Conversely, every valid nonempty solution for a has some final coin c; removing it leaves a solution to a minus c. Replacing that remainder with an optimal one cannot make the candidate worse. These two directions establish both feasibility and optimality of the recurrence. At the public boundary, translate Infinity to the contract's missing-solution sentinel. Do not return a raw internal sentinel unless the interface requests it. The proof depends on considering all permitted denominations and on the smaller-state answers being correct when used.`,
        code: `const dp = Array(amount + 1).fill(Infinity);
dp[0] = 0;
for (let a = 1; a <= amount; a++) {
  for (const coin of coins) {
    if (coin <= a && dp[a - coin] !== Infinity) {
      dp[a] = Math.min(dp[a], dp[a - coin] + 1);
    }
  }
}
return dp[amount] === Infinity ? -1 : dp[amount];`,
      },
      {
        title: 'Choose an evaluation order from dependencies',
        body: `Top-down memoization starts from the requested amount and recursively computes needed smaller states, caching results. Bottom-up tabulation computes amounts in ascending order so every dependency is already available. Both implement the same recurrence, but they have different practical stack behavior and may visit different subsets of the state space. Recursive memoization can have depth proportional to the amount when a denomination is one, which matters in JavaScript runtimes. Bottom-up computation avoids that runtime stack requirement. Loop order can change the meaning of other coin problems: counting unordered combinations is not the same as counting ordered sequences, and zero-or-one usage often requires descending updates. Do not carry an update order from one contract into another without rederiving what table entries mean. Storage reduction also needs a dependency proof. An arbitrary coin set can reference many earlier amounts, so a tiny rolling window is not automatically valid for minimum-coins computation.`,
      },
      {
        title: 'Analyze numeric magnitude and reconstruct only if needed',
        body: `For target amount A and d denominations, the table approach performs O(A times d) transition checks and uses O(A) auxiliary storage. This is pseudopolynomial: A is a numeric value, while its binary input representation has only logarithmically many digits. A large amount can make the table impractical even when the input list is short. Validate allocation constraints and integer-domain assumptions rather than relying only on asymptotic notation. If the output needs an actual coin selection, record a chosen predecessor or coin during improvement and reconstruct from the final amount. A count-only contract does not need that extra information. Returned reconstruction storage is separate from the table. Test amount zero, no denominations, an unreachable amount, repeated denominations, and a case where largest-first greedy fails, such as denominations [1, 3, 4] with amount 6. Keep exact amounts and arithmetic within Number's safe integer range or choose an explicitly supported alternative representation.`,
      },
    ],
    exercise: 'Implement alg-min-coins from a written recurrence. Compare bottom-up results with a small memoized oracle, include [1, 3, 4] and amount 6, and explain why a zero denomination violates the smaller-state dependency proof.',
  }),
  lesson({
    id: 'dp-sequences',
    title: 'Sequence dynamic programming and equality',
    group: 'Search and optimization',
    summary: 'Derive subsequence states and distinguish strictly increasing from nondecreasing transitions.',
    objectives: ['Differentiate subsequences from contiguous subarrays.', 'Derive a nondecreasing subsequence recurrence.', 'Use upper-bound search for nondecreasing tails.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-number'],
    relatedProblemIds: ['alg-nondecreasing-route'],
    quizTopic: 'dynamic-programming',
    sections: [
      {
        title: 'Define the sequence relationship exactly',
        body: `A subsequence preserves relative input order but may skip positions. A subarray is contiguous, so the two terms describe different search spaces. An increasing subsequence may mean strictly increasing values, while a nondecreasing subsequence permits equality; settle that distinction explicitly. For the nondecreasing route problem, equal neighboring selected values are legal, so [2, 2, 2] has optimal length three rather than one. Input positions are still distinct even when values match. A useful state is dp[i], the longest permitted subsequence ending exactly at position i. It is not the longest subsequence anywhere in the prefix, because the ending value determines which future extensions are possible. A singleton gives a base length of one, and an empty input has overall length zero. Keeping the state tied to an endpoint makes its dependency on earlier positions precise and supports a clear recurrence before introducing any faster representation.`,
      },
      {
        title: 'Prove the quadratic endpoint recurrence',
        body: `For each position i, inspect earlier positions j whose values are no larger than values[i]. Extending a nondecreasing subsequence ending at such a j gives candidate length dp[j] plus one. Take the maximum of these candidates and the singleton length one. Every candidate is valid because it preserves index order and the nondecreasing value relation. Every optimal subsequence ending at i either is the singleton or has a previous selected position j satisfying that relation, so one candidate reaches the optimum. The overall answer is the maximum endpoint length. Strictly increasing variants replace no-larger with strictly-smaller; that one comparison changes answers on duplicates. The straightforward algorithm uses O(n squared) time and O(n) table storage, making it a useful oracle for small inputs. Predecessor indices can reconstruct a witness if needed, but a length-only contract can omit them. Keep returned witness space separate from the working table.`,
      },
      {
        title: 'Compress state into best tails without changing equality',
        body: `A faster representation stores tails[k] as the smallest possible ending value of a nondecreasing subsequence of length k plus one seen so far. A smaller tail is at least as extendable as a larger tail of the same length. For an incoming value x, find the first tail strictly greater than x and replace it; if none exists, append x. This is an upper-bound search. Equal tails are passed over so x can extend a sequence containing equal values. For a strictly increasing subsequence, the correct replacement position is the first tail greater than or equal to x, a lower-bound search. Mixing these searches silently changes the problem. The tails array is a compact feasibility summary, not necessarily an actual subsequence from the input, because entries may come from incompatible histories. To reconstruct a witness, maintain input indices and predecessor links with an additional proof rather than returning tails directly.`,
        diagram: `nondecreasing input: [3, 1, 1, 2]
tails after 3: [3]
tails after 1: [1]
tails after 1: [1, 1]       equal extends
tails after 2: [1, 1, 2]    answer length 3`,
      },
      {
        title: 'Validate optimized state against the original meaning',
        body: `Upper-bound search takes logarithmic time in the tails length, giving O(n log n) total work and O(n) auxiliary storage in the standard indexed-array model. Use ordinary arithmetic for the midpoint rather than signed 32-bit bitwise shortcuts. Numeric ordering must reflect the allowed domain; exact integer comparisons beyond Number's safe range require another representation. Test all equal values, strictly decreasing values, strictly increasing values, alternating highs and lows, and repeated plateaus. The optimized length should match the quadratic nondecreasing recurrence on many small inputs, especially duplicate-heavy ones. Useful properties include that appending one element can increase the answer by at most one and that an already nondecreasing input has answer equal to its length. A strictly increasing oracle is not a valid reference for this contract. In your explanation, connect tails to endpoint DP as dominance compression: it discards larger ending values only when they cannot offer a better future extension for the same length.`,
      },
    ],
    exercise: 'Solve alg-nondecreasing-route with upper-bound tails and compare with the quadratic <= recurrence. Use [3, 1, 1, 2] and all-equal inputs to demonstrate why the strict LIS lower-bound rule would be wrong.',
  }),
  lesson({
    id: 'greedy',
    title: 'Greedy choices and exchange arguments',
    group: 'Search and optimization',
    summary: 'Commit locally only when a proof shows that an optimal completion remains possible.',
    objectives: ['Derive earliest-finish interval selection.', 'Use an exchange argument rather than intuition.', 'Recognize weighted or coin variants where greedy fails.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-sort'],
    relatedProblemIds: ['alg-choose-slots', 'alg-min-coins'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'A greedy rule needs a reason to be irreversible',
        body: `A greedy algorithm makes a local choice and does not revisit it. That simplicity can be powerful, but only when the chosen action preserves the possibility of an optimal completion. Distinguish the objective from the heuristic: earliest start, shortest duration, and earliest finish are different rules for interval selection, and only one has the standard proof for maximizing the number of compatible intervals. A promising example is not a proof. Try to construct a counterexample to the rule before implementing it. Ask what information remains after a commitment and whether a discarded alternative could enable more future choices. Exchange arguments compare the greedy choice with a corresponding choice in some optimal solution, showing that replacing the latter does not worsen the objective. Other greedy proofs use a stays-ahead invariant or a structural cut property. Name the property you rely on instead of presenting the word greedy as its own justification.`,
      },
      {
        title: 'Prove earliest finish for interval count',
        body: `For selecting the maximum number of nonoverlapping positive-duration half-open intervals, sort by ascending finish time and choose the first compatible interval repeatedly. Compatibility with the previous choice allows the next start to equal the previous end because the right endpoint is excluded. Let G be the earliest-finishing eligible interval and let O be the first interval in an optimal selection of the remaining candidates. G finishes no later than O. Replacing O with G leaves every later selected interval compatible, because those later starts were already at least O's finish. The replacement keeps the same number of intervals, so an optimal solution exists beginning with G. Repeat this argument on the candidates compatible after G. This is why earliest finish works and earliest start can fail: an early-starting long interval may block many short ones. If zero-duration intervals are allowed, specify their semantics and ordering carefully rather than assuming the positive-duration proof covers every representation detail.`,
      },
      {
        title: 'Identify contract changes that destroy the proof',
        body: `If intervals have different rewards and the goal is maximum total reward, preserving the number of intervals is no longer enough. An earliest-finishing low-reward interval might displace a much more valuable choice, so the exchange argument's objective comparison fails. Weighted interval scheduling typically requires a dynamic-programming recurrence over compatible predecessors. Similarly, selecting the largest coin first is not a universal minimum-coins algorithm. With denominations [1, 3, 4] and amount 6, it chooses 4, 1, 1 while two 3 coins are better. These counterexamples do not show that greedy is weak; they show that its validity is tied to a specific structure. Sorting input also does not turn every optimization problem into a greedy one. State what your choice optimizes, what exchange is permitted, and why the exchange preserves all constraints. If you cannot explain those three steps, use a baseline search or recurrence to understand the problem first.`,
      },
      {
        title: 'Implement the proof and test against exhaustive choices',
        body: `After sorting by finish time, scan once and retain a last-selected end boundary. Use a representation that handles the first selection without assuming times are nonnegative; a nullable boundary or an explicit empty-selection state is clearer than an arbitrary zero sentinel. Encode deterministic tie rules if the contract requires particular returned intervals. JavaScript Array.sort mutates its receiver, so copy inputs when mutation is disallowed and use numeric comparisons for coordinates. Stability is specified, but it does not guarantee an algorithm or complexity; state an O(n log n) comparison-sort assumption when giving that bound. The scan adds O(n) time, selected output can be O(n), and copied-input or sorting storage is auxiliary. Test touching ranges, nested ranges, identical finish times, negative coordinates, and a long early-starting interval versus many short later ones. Compare counts against exhaustive subset selection on small cases. Validate output compatibility independently, because an optimal count attached to overlapping output is still incorrect.`,
      },
    ],
    exercise: 'Implement alg-choose-slots using its endpoint and tie rules. Compare its selected count with exhaustive subsets on small positive-duration intervals, and construct failures for earliest-start and shortest-duration selection.',
  }),
  lesson({
    id: 'tries',
    title: 'Tries and prefix directories',
    group: 'Data structures',
    summary: 'Share prefix paths while distinguishing complete keys from internal navigation nodes.',
    objectives: ['Define child edges and terminal markers.', 'Separate prefix lookup from result enumeration.', 'Analyze total character work and deterministic output.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-map'],
    relatedProblemIds: ['alg-prefix-directory'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'Share the portion that repeated keys have in common',
        body: `A trie stores keys along paths from a root, with each edge representing one unit of the chosen text representation. Keys that share a prefix share the corresponding path. A terminal marker distinguishes a complete key from a prefix that exists only because longer keys pass through it. For example, storing carbon does not by itself mean car is a stored key, even though its path exists. If both are stored, the node after car is terminal and still has descendants. The root can represent an empty key if the contract permits it. Decide whether repeated insertions are deduplicated or counted, and whether matching is case-sensitive. Normalizing strings can alter identity and must be explicit. Also choose a consistent text unit: JavaScript iteration with for-of follows Unicode code points, whereas indexed string access uses UTF-16 code units. Insertion and lookup must use the same representation, or equivalent prefixes may traverse different paths.`,
      },
      {
        title: 'Keep insertion and lookup invariants simple',
        body: `During insertion, the current node represents exactly the input prefix already consumed. For each next unit, follow an existing child or create one, then advance. After all units, mark the final node terminal or update its stored frequency. During prefix lookup, the same traversal either reaches the node representing the requested prefix or fails at the first missing edge. A missing edge means no stored key can have that prefix, so the result is empty. Reaching a nonterminal node is still a successful prefix lookup because descendants may contain complete keys. Do not confuse exact-key existence with prefix existence. Child storage may be a fixed array for a small declared alphabet or a map for a flexible domain. A fixed table simplifies indexed access but allocates slots for unused symbols; a map stores only present edges but brings keyed-access assumptions into the analysis. Let the declared alphabet and operations drive that tradeoff.`,
        diagram: `root
  c
  a
  r*             * marks a complete key
 /  \\
t*   b
     o
     n*
stored: car, cart, carbon
prefix car reaches both the terminal and descendants`,
      },
      {
        title: 'Enumeration adds work beyond reaching the prefix',
        body: `After locating the prefix node, traverse its descendant subtree and emit keys at terminal nodes. The path buffer contains the prefix plus units chosen on the current traversal branch, so restore it after returning from each child. Copy or join it when producing output rather than storing a shared mutable buffer. A prefix lookup alone takes work proportional to prefix length under the chosen child-access model, but returning every completion also requires visiting relevant descendants and writing the output text. This output cost cannot be hidden inside a claim that trie queries are always constant time. If completions must be sorted, define an order for child traversal or sort the resulting keys. Map insertion order reflects construction history, not a general lexical order. A limit on returned results can permit early termination only when traversal order already matches the required ranking. Frequency-ranked suggestions need more information than ordinary alphabetical trie enumeration.`,
      },
      {
        title: 'Account for character storage and compare alternatives',
        body: `Building a trie performs work proportional to the total number of inserted text units under constant child-access assumptions. Storage is proportional to distinct prefix nodes and their child representation, plus terminal metadata. If children use JavaScript Map, expected constant-time access may be analyzed under a hashing model, but the language only requires average sublinear map access. An alternative is sorting keys and using binary search to find a prefix range; that approach has different update and enumeration tradeoffs and may be simpler for a static directory. Test a key that is also another key's prefix, missing prefixes, empty prefix, repeated insertions, mixed case, and the chosen Unicode representation. Check deterministic ordering independently of membership. Recursion during enumeration can reach the longest key depth, so an explicit stack may be needed for adversarially long strings. Returned completion strings consume output space separately from trie storage and traversal state.`,
      },
    ],
    exercise: 'Implement alg-prefix-directory with explicit terminal markers and the contract’s ordering. Test car, cart, and carbon together; distinguish missing prefix, exact key, and empty prefix, and explain the output-sensitive query cost.',
  }),
  lesson({
    id: 'matrices',
    title: 'Matrices as implicit graphs',
    group: 'Graphs',
    summary: 'Generate neighbors from coordinates and count connected regions without building every edge.',
    objectives: ['Define rectangular dimensions and legal neighbor moves.', 'Mark land when adding it to a traversal frontier.', 'Separate input mutation from visited-state storage.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms'],
    relatedProblemIds: ['alg-island-count'],
    quizTopic: 'graphs',
    sections: [
      {
        title: 'Separate storage geometry from movement rules',
        body: `A matrix stores values at row and column coordinates, but connectivity comes from a separate neighbor rule. Four-direction movement permits up, down, left, and right; eight-direction movement also permits diagonals and can merge regions that four-direction movement keeps separate. State the rule before counting islands. A rectangular grid with r rows and c columns has r times c cells, and valid coordinates satisfy zero less-than-or-equal row less-than r and the analogous column condition. Handle zero rows before reading the first row's length. If ragged rows are permitted, each row needs its own bounds; do not apply a rectangular assumption silently. Clarify which values represent land, whether other values are legal, and whether the function may mutate input. Coordinates are vertices of an implicit graph, and neighbor generation supplies edges only when needed, avoiding the cost of constructing an explicit adjacency list for every cell.`,
      },
      {
        title: 'Count one component per unvisited starting cell',
        body: `Scan every cell in a fixed order. When a cell is land and undiscovered, increase the island count and traverse all land reachable through the allowed moves. Mark a cell when placing it in the stack or queue, so several neighboring cells cannot schedule it repeatedly. After that traversal completes, every land cell in the same component is discovered, so later scan positions cannot count that component again. Conversely, every component has a first land cell in scan order, and that cell triggers exactly one traversal. This establishes both no overcounting and no omissions. The frontier can hold coordinate pairs or a flattened index derived consistently from the rectangular dimensions. Avoid storing coordinates by a lossy or ambiguous string concatenation. An indexed visited table is often simplest for a declared rectangular grid, while a more flexible representation may be needed for sparse or irregular coordinate domains.`,
        diagram: `four-direction land:
1 0 1
1 0 0
0 1 1
components: left pair, upper-right singleton, lower pair
diagonal connectivity would change the answer.`,
      },
      {
        title: 'Choose how discovery is represented',
        body: `One approach changes visited land to water in the input grid, combining discovery state with storage mutation. This uses less separate bookkeeping but destroys information the caller may need later. A boolean visited matrix preserves the input at an auxiliary cost proportional to the cell count. Copying the grid before marking is another option, but copying only the outer array still shares row arrays and does not protect the caller. Construct fresh rows if you intend to mutate a copy. Recursive flood fill is concise yet may reach a call depth proportional to the number of cells in a snake-shaped region. An explicit stack avoids runtime recursion limits while retaining potentially linear frontier storage. For ordinary component counting, BFS and DFS are both correct because the output is connectivity, not a shortest route. If the task changes to shortest grid steps, BFS needs the additional layer invariant and equal-cost move assumption.`,
      },
      {
        title: 'Analyze bounded neighbors and adversarial shapes',
        body: `With a fixed number of neighbor directions, each discovered land cell examines only a constant number of candidates. The outer scan also visits every cell, giving O(r times c) time for a rectangular grid under ordinary indexed-access assumptions. A visited matrix and traversal frontier can each require O(r times c) auxiliary space; a count is constant-size output. Do not claim constant extra space for an in-place solution while ignoring its potentially large explicit or recursive stack. Test all water, all land, one cell, one row, one column, diagonal-only contact, and separated islands connected by a narrow bridge. A long snake checks recursion concerns, while a wide region checks frontier growth. If input preservation is promised, compare every row before and after execution. Verify island count against a small independent component oracle using the same neighbor rule. Agreement with an eight-direction oracle does not validate a four-direction contract, even when many examples happen to match.`,
      },
    ],
    exercise: 'Solve alg-island-count without mutating input unless its contract permits mutation. Use the displayed grid to contrast four and eight neighbors, and test a long snake and a diagonal-only arrangement.',
  }),
  lesson({
    id: 'bit-manipulation',
    title: 'Bit manipulation within an explicit width',
    group: 'Foundations',
    summary: 'Reason about bit patterns while respecting JavaScript’s integer coercion and numeric boundaries.',
    objectives: ['Distinguish Number precision from bitwise operand width.', 'Prove the lowest-set-bit clearing identity.', 'Keep 31-bit counting inside its declared domain.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-bitwise', 'js-number'],
    relatedProblemIds: ['alg-bit-count'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'Define the width before using a bit operator',
        body: `JavaScript Number uses floating-point representation and exactly represents integers only within the safe range from negative 9007199254740991 through positive 9007199254740991. Number bitwise operators do not operate over that entire safe range: their operands are converted to signed 32-bit integers. This conversion can truncate high bits and reinterpret the sign, so being a safe integer does not make a value safe for every bitwise algorithm. The 31-bit nonnegative contract for bit counting restricts values to zero through 2147483647, avoiding the signed high bit. Keep that restriction explicit rather than advertising a general integer function. Validate integer-ness and range when the interface assigns validation responsibility to the function. Fractional, negative, or larger inputs can otherwise be silently coerced into unrelated patterns. A small declared width makes the mathematical identity and JavaScript behavior align, which is the central prerequisite for reliable bit manipulation.`,
      },
      {
        title: 'Clear the lowest set bit with a proof',
        body: `For a positive integer x, subtracting one changes its lowest set bit from one to zero and changes all lower zero bits to one. Higher bits remain unchanged. Taking x AND x minus one therefore preserves higher bits, clears that lowest set bit, and leaves lower positions zero because x had zeros there. Repeating this operation removes one set bit at a time. Start a count at zero, continue while x is nonzero, replace x with x AND x minus one, and increment the count. The loop terminates after exactly the number of original set bits, not after the numeric value of x iterations. Zero begins with no set bits and returns zero without entering the loop. Parenthesize x minus one clearly to make the identity visible to readers. Under the 31-bit nonnegative contract, each intermediate value remains nonnegative and within the same supported domain.`,
        diagram: `x       = 1011000
x - 1   = 1010111
AND     = 1010000
next    = 1000000
next    = 0000000
count   = 3`,
      },
      {
        title: 'Do not generalize coercion tricks beyond their domain',
        body: `Unsigned right shift can reinterpret a 32-bit Number pattern as a nonnegative value, but it does not restore bits already discarded from a wider integer. Ordinary bitwise shifts also reduce the shift count modulo 32, so shifting by 32 is not a reliable way to clear a Number value. A left shift into the sign bit can produce a negative result; for example, using one shifted by 31 as a positive numeric boundary is wrong. Arithmetic powers or explicit domain constants are clearer for validation. BigInt has different bitwise semantics and can support larger exact integer patterns, but Number and BigInt operands cannot be mixed in these operations. A BigInt variant also needs its own nonnegative-domain and cost analysis rather than borrowing a constant-width claim. Avoid bitwise midpoint shortcuts in unrelated array algorithms: the signed conversion is an implementation hazard, not a universally faster substitute for ordinary integer arithmetic.`,
      },
      {
        title: 'Choose tests that isolate representation errors',
        body: `For a fixed 31-bit domain, population counting requires at most 31 bit-clearing iterations and constant auxiliary storage. If generalized to width b, describe O(b) worst-case time or O(s) iterations for s set bits, with arithmetic costs specified for the representation. The output is a single count. Test zero, one, powers of two, adjacent bits, alternating patterns, and the maximum allowed value 2147483647, whose 31 low bits are all set. Compare against an arithmetic oracle that repeatedly takes the remainder modulo two and divides by two with floor, which avoids the same bitwise coercion mechanism. If invalid inputs are rejected by the contract, include 2147483648, fractions, and negative values in rejection tests. Do not treat agreement on small examples as evidence of support for larger integers. The lesson from bit problems transfers broadly: an algorithm's mathematical domain and the language's operand conversion rules must match before a complexity or correctness claim is meaningful.`,
      },
    ],
    exercise: 'Implement alg-bit-count for its 31-bit nonnegative domain and compare with an arithmetic division oracle. Explain the result for 2147483647 and why accepting every Number-safe integer would invalidate the bitwise implementation.',
  }),
  lesson({
    id: 'testing-solutions',
    title: 'Testing solutions and preserving contracts',
    group: 'Foundations',
    summary: 'Combine boundary cases, independent oracles, and structural properties into trustworthy validation.',
    objectives: ['Derive tests from invariants and contract boundaries.', 'Use small independent oracles and properties.', 'Verify mutation, determinism, and complexity claims.'],
    sourceIds: ['mit-algorithms', 'nist-algorithms', 'js-sort', 'js-number', 'js-map'],
    relatedProblemIds: ['alg-frequent-tags', 'alg-window-budget', 'alg-release-order', 'alg-nondecreasing-route'],
    quizTopic: 'arrays-hashing',
    sections: [
      {
        title: 'Organize tests around reasons for failure',
        body: `A useful test suite is not merely a list of random examples. Group tests by assumptions: empty input, smallest valid input, duplicated values, boundary equality, unsupported values, and representation shape. Each case should have an expected result derived independently from the implementation. For a window, equality with the budget checks whether the condition is strict; for a threshold, repeated equal values check the first qualifying position; for interval selection, touching endpoints check the chosen occupancy convention. State whether invalid input is rejected or outside the contract, and test only the promised behavior. If the function returns a sentinel for failure, include cases that distinguish that sentinel from a valid zero or empty answer. Name cases by the property they exercise so a failure immediately narrows the investigation. Ordinary success examples remain useful, but boundary-focused cases reveal the assumptions that are easiest to hide in an apparently clean loop.`,
      },
      {
        title: 'Use a simpler algorithm as an independent oracle',
        body: `A slow oracle can be more valuable than another optimized implementation. Exhaustive pair search, all contiguous ranges, all small subsets, or a quadratic subsequence recurrence are often easy to inspect and practical for tiny inputs. Generate many small cases and compare results, keeping generation deterministic so failures can be reproduced. The oracle must use the same contract but a different reasoning path; copying the optimized loop's comparison into another helper can duplicate the same bug. For nondecreasing subsequences, the reference recurrence must permit equality rather than use a strict increasing relation. For ranking, compare ordered outputs only when the contract defines tie order; otherwise compare the appropriate set or multiset. For an algorithm with several valid solutions, check validity and objective value rather than forcing one arbitrary witness. Shrink a failing case by removing irrelevant elements until the smallest counterexample exposes the violated invariant. Save that counterexample as a focused regression test.`,
      },
      {
        title: 'Add properties that explain more than one answer',
        body: `Structural properties can catch errors without knowing every exact expected output. A merged interval union should preserve coverage and return ordered nonoverlapping ranges under the stated boundary rule. A topological result should contain each vertex once and place every edge source before its target. A chosen capacity should be feasible while the preceding smaller candidate is infeasible when that candidate belongs to the domain. A nondecreasing subsequence length cannot exceed input length, and appending one item can increase it by at most one. These are necessary conditions, not complete proofs, so combine them with oracles and reasoning. Metamorphic tests apply a transformation with a known effect, such as relabeling graph vertices consistently or adding a constant to all values in an order-only subsequence problem. Do not assume a transformation preserves behavior when it changes equality, overflow, edge weights, or interval semantics. Derive the property from the contract just as you derive the algorithm.`,
      },
      {
        title: 'Validate language behavior and resource promises',
        body: `Snapshot inputs when nonmutation is promised, including nested arrays or objects that a shallow copy would still share. Repeat executions when deterministic output is required, and vary input insertion order to expose accidental reliance on map iteration. JavaScript Array.sort mutates and needs a numeric comparator for numeric order; specified stability does not substitute for a missing tie rule. Map equality follows key identity rules, and expected constant hashing cost is a model rather than a guaranteed O(1) language contract. Numeric tests should include the largest allowed values and accumulated sums near Number's safe integer boundary. Resource tests can use chains, wide trees, dense graphs, and duplicate-heavy inputs to exercise stack or frontier growth, but timing alone cannot prove an asymptotic bound. Review allocations and total cursor movements alongside tests. End validation by documenting which domain was verified and which assumptions remain, rather than presenting passing tests as evidence that every conceivable input is supported.`,
      },
    ],
    exercise: 'Choose two related problems and build a boundary table, an independent small-input oracle, and two structural properties for each. Include an input-preservation check and explain which correctness claim still requires a proof beyond the tests.',
  }),
];
