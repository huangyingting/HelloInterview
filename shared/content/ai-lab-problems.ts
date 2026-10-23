import type { ExampleCase, Problem } from '../types';

const packerCode = `function solve(input) {
  const seen = new Set();
  const ids = [];
  let tokens = 0;
  for (const passage of input.passages) {
    if (passage.tenant !== input.tenant || !passage.authorized) continue;
    if (seen.has(passage.id)) continue;
    seen.add(passage.id);
    if (tokens + passage.tokens > input.budget) continue;
    ids.push(passage.id);
    tokens += passage.tokens;
  }
  return { ids, tokens };
}`;

const packerExamples: ExampleCase[] = [
  { label: 'Empty evidence', input: { tenant: 't', budget: 5, passages: [] }, expected: { ids: [], tokens: 0 } },
  { label: 'Exact budget', input: { tenant: 't', budget: 5, passages: [{ id: 'A', tenant: 't', authorized: true, tokens: 2 }, { id: 'B', tenant: 't', authorized: true, tokens: 3 }, { id: 'C', tenant: 't', authorized: true, tokens: 1 }] }, expected: { ids: ['A', 'B'], tokens: 5 } },
  { label: 'First eligible identity wins even if too large', input: { tenant: 't', budget: 5, passages: [{ id: 'A', tenant: 't', authorized: true, tokens: 7 }, { id: 'A', tenant: 't', authorized: true, tokens: 2 }, { id: 'B', tenant: 't', authorized: true, tokens: 3 }] }, expected: { ids: ['B'], tokens: 3 } },
  { label: 'Rejected evidence does not consume identity', input: { tenant: 't', budget: 3, passages: [{ id: 'A', tenant: 'other', authorized: true, tokens: 1 }, { id: 'A', tenant: 't', authorized: false, tokens: 1 }, { id: 'A', tenant: 't', authorized: true, tokens: 2 }] }, expected: { ids: ['A'], tokens: 2 } },
  { label: 'Zero-cost passage fits a zero budget', input: { tenant: 't', budget: 0, passages: [{ id: 'A', tenant: 't', authorized: true, tokens: 1 }, { id: 'B', tenant: 't', authorized: true, tokens: 0 }] }, expected: { ids: ['B'], tokens: 0 } },
  { label: 'Continue after an oversized passage', input: { tenant: 't', budget: 5, passages: [{ id: 'A', tenant: 't', authorized: true, tokens: 6 }, { id: 'B', tenant: 't', authorized: true, tokens: 4 }, { id: 'C', tenant: 't', authorized: true, tokens: 1 }] }, expected: { ids: ['B', 'C'], tokens: 5 } },
  { label: 'Deduplicate selected evidence', input: { tenant: 't', budget: 5, passages: [{ id: 'A', tenant: 't', authorized: true, tokens: 2 }, { id: 'A', tenant: 't', authorized: true, tokens: 1 }, { id: 'B', tenant: 't', authorized: true, tokens: 2 }] }, expected: { ids: ['A', 'B'], tokens: 4 } },
];

const metricsCode = `function solve(input) {
  const round = value => Math.round(value * 1000000) / 1000000;
  const rows = input.queries.map(query => {
    const relevant = new Set(query.relevant);
    const top = [...new Set(query.ranked)].slice(0, input.k);
    const hits = top.filter(id => relevant.has(id)).length;
    const first = top.findIndex(id => relevant.has(id));
    return {
      hits,
      precision: hits / input.k,
      recall: relevant.size ? hits / relevant.size : null,
      rr: first < 0 ? 0 : 1 / (first + 1)
    };
  });
  const answerable = rows.filter(row => row.recall !== null);
  return {
    items: rows.map(row => ({
      hits: row.hits,
      precision: round(row.precision),
      recall: row.recall === null ? null : round(row.recall),
      rr: round(row.rr)
    })),
    meanRecall: answerable.length
      ? round(answerable.reduce((sum, row) => sum + row.recall, 0) / answerable.length)
      : null,
    mrr: answerable.length
      ? round(answerable.reduce((sum, row) => sum + row.rr, 0) / answerable.length)
      : null
  };
}`;

const metricsExamples: ExampleCase[] = [
  { label: 'Deduplicate before taking top k', input: { k: 3, queries: [{ relevant: ['A', 'B'], ranked: ['A', 'A', 'X', 'B'] }] }, expected: { items: [{ hits: 2, precision: 0.666667, recall: 1, rr: 1 }], meanRecall: 1, mrr: 1 } },
  { label: 'First relevant result is second', input: { k: 2, queries: [{ relevant: ['A', 'B'], ranked: ['X', 'A', 'B'] }] }, expected: { items: [{ hits: 1, precision: 0.5, recall: 0.5, rr: 0.5 }], meanRecall: 0.5, mrr: 0.5 } },
  { label: 'Unanswerable query is not a perfect score', input: { k: 2, queries: [{ relevant: [], ranked: ['X'] }] }, expected: { items: [{ hits: 0, precision: 0, recall: null, rr: 0 }], meanRecall: null, mrr: null } },
  { label: 'Answerable but nothing retrieved', input: { k: 3, queries: [{ relevant: ['A'], ranked: [] }] }, expected: { items: [{ hits: 0, precision: 0, recall: 0, rr: 0 }], meanRecall: 0, mrr: 0 } },
  { label: 'Macro means and fixed-k precision', input: { k: 2, queries: [{ relevant: ['A', 'B'], ranked: ['A'] }, { relevant: ['C'], ranked: ['X', 'C'] }] }, expected: { items: [{ hits: 1, precision: 0.5, recall: 0.5, rr: 1 }, { hits: 1, precision: 0.5, recall: 1, rr: 0.5 }], meanRecall: 0.75, mrr: 0.75 } },
  { label: 'Relevant result outside the cutoff', input: { k: 1, queries: [{ relevant: ['A', 'A'], ranked: ['B', 'A'] }] }, expected: { items: [{ hits: 0, precision: 0, recall: 0, rr: 0 }], meanRecall: 0, mrr: 0 } },
  { label: 'No evaluation queries', input: { k: 3, queries: [] }, expected: { items: [], meanRecall: null, mrr: null } },
];

const toolCode = `function solve(input) {
  const resources = new Map(input.resources.map(resource => [resource.id, resource]));
  const exactKeys = (value, keys) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  return input.calls.map(call => {
    const result = (status, reason = null) => ({ id: call.id, status, reason });
    const read = call.name === 'read_document';
    if (!read && call.name !== 'set_tag') return result('rejected', 'unknown-tool');
    const keys = read ? ['documentId'] : ['documentId', 'tag', 'expectedVersion'];
    if (!exactKeys(call.args, keys)) return result('rejected', 'invalid-arguments');
    const args = call.args;
    if (typeof args.documentId !== 'string' || !args.documentId.length ||
        args.documentId.length > 80) return result('rejected', 'invalid-arguments');
    if (!read && (typeof args.tag !== 'string' || !args.tag.trim().length ||
        args.tag.length > 40 || !Number.isInteger(args.expectedVersion) ||
        args.expectedVersion < 0)) return result('rejected', 'invalid-arguments');
    const resource = resources.get(args.documentId);
    if (!resource || resource.tenant !== input.tenant) return result('rejected', 'forbidden');
    if (read) return result('ready');
    if (resource.version !== args.expectedVersion) return result('rejected', 'stale-version');
    const approved = input.approvals.some(approval =>
      approval.callId === call.id && approval.documentId === args.documentId &&
      approval.tag === args.tag && approval.version === resource.version);
    return approved ? result('ready') : result('approval-required', 'approval-required');
  });
}`;

const toolExamples: ExampleCase[] = [
  { label: 'Read own document', input: { tenant: 't', resources: [{ id: 'D', tenant: 't', version: 2 }], approvals: [], calls: [{ id: 'c', name: 'read_document', args: { documentId: 'D' } }] }, expected: [{ id: 'c', status: 'ready', reason: null }] },
  { label: 'Other tenant and missing resource share the same rejection', input: { tenant: 't', resources: [{ id: 'D', tenant: 'other', version: 2 }], approvals: [], calls: [{ id: 'a', name: 'read_document', args: { documentId: 'D' } }, { id: 'b', name: 'read_document', args: { documentId: 'missing' } }] }, expected: [{ id: 'a', status: 'rejected', reason: 'forbidden' }, { id: 'b', status: 'rejected', reason: 'forbidden' }] },
  { label: 'Write-shaped proposal needs exact approval', input: { tenant: 't', resources: [{ id: 'D', tenant: 't', version: 2 }], approvals: [], calls: [{ id: 'c', name: 'set_tag', args: { documentId: 'D', tag: 'reviewed', expectedVersion: 2 } }] }, expected: [{ id: 'c', status: 'approval-required', reason: 'approval-required' }] },
  { label: 'Exact version-bound approval', input: { tenant: 't', resources: [{ id: 'D', tenant: 't', version: 2 }], approvals: [{ callId: 'c', documentId: 'D', tag: 'reviewed', version: 2 }], calls: [{ id: 'c', name: 'set_tag', args: { documentId: 'D', tag: 'reviewed', expectedVersion: 2 } }] }, expected: [{ id: 'c', status: 'ready', reason: null }] },
  { label: 'Old approval cannot override current version', input: { tenant: 't', resources: [{ id: 'D', tenant: 't', version: 2 }], approvals: [{ callId: 'c', documentId: 'D', tag: 'reviewed', version: 1 }], calls: [{ id: 'c', name: 'set_tag', args: { documentId: 'D', tag: 'reviewed', expectedVersion: 1 } }] }, expected: [{ id: 'c', status: 'rejected', reason: 'stale-version' }] },
  { label: 'Changed tag does not inherit approval', input: { tenant: 't', resources: [{ id: 'D', tenant: 't', version: 2 }], approvals: [{ callId: 'c', documentId: 'D', tag: 'old', version: 2 }], calls: [{ id: 'c', name: 'set_tag', args: { documentId: 'D', tag: 'new', expectedVersion: 2 } }] }, expected: [{ id: 'c', status: 'approval-required', reason: 'approval-required' }] },
  { label: 'Unknown tools and malformed arguments', input: { tenant: 't', resources: [], approvals: [], calls: [{ id: 'a', name: 'shell', args: {} }, { id: 'b', name: 'read_document', args: { documentId: 'D', actor: 'admin' } }, { id: 'c', name: 'set_tag', args: null }] }, expected: [{ id: 'a', status: 'rejected', reason: 'unknown-tool' }, { id: 'b', status: 'rejected', reason: 'invalid-arguments' }, { id: 'c', status: 'rejected', reason: 'invalid-arguments' }] },
];

const reducerCode = `function solve(input) {
  const operations = new Map();
  let remaining = input.limit;
  const results = input.events.map(event => {
    const record = operations.get(event.key);
    if (event.type === 'propose') {
      if (record) return record.payload === event.payload ? 'replayed' : 'conflict';
      operations.set(event.key, { key: event.key, payload: event.payload, status: 'proposed', receipt: null });
      return 'accepted';
    }
    if (!record) return 'not-found';
    if (event.type === 'approve') {
      if (record.payload !== event.payload) return 'conflict';
      if (record.status !== 'proposed') return 'replayed';
      record.status = 'approved';
      return 'accepted';
    }
    if (event.type === 'dispatch') {
      if (record.status === 'unknown') return 'reconcile-required';
      if (record.status === 'dispatched' || record.status === 'confirmed') return 'replayed';
      if (record.status !== 'approved') return 'invalid-state';
      if (remaining === 0) return 'budget-exhausted';
      remaining--;
      record.status = 'dispatched';
      return 'accepted';
    }
    if (event.type === 'timeout') {
      if (record.status === 'unknown') return 'replayed';
      if (record.status !== 'dispatched') return 'invalid-state';
      record.status = 'unknown';
      return 'accepted';
    }
    if (event.type === 'confirm') {
      if (record.status === 'confirmed') return record.receipt === event.receipt ? 'replayed' : 'conflict';
      if (record.status !== 'dispatched' && record.status !== 'unknown') return 'invalid-state';
      record.status = 'confirmed';
      record.receipt = event.receipt;
      return 'accepted';
    }
    return 'invalid-event';
  });
  return { operations: [...operations.values()], remaining, results };
}`;

const reducerExamples: ExampleCase[] = [
  { label: 'Empty history', input: { limit: 0, events: [] }, expected: { operations: [], remaining: 0, results: [] } },
  { label: 'Cannot approve missing or dispatch unapproved intent', input: { limit: 1, events: [{ type: 'approve', key: 'a', payload: 'P' }, { type: 'propose', key: 'a', payload: 'P' }, { type: 'dispatch', key: 'a' }] }, expected: { operations: [{ key: 'a', payload: 'P', status: 'proposed', receipt: null }], remaining: 1, results: ['not-found', 'accepted', 'invalid-state'] } },
  { label: 'Ordinary confirmed operation', input: { limit: 1, events: [{ type: 'propose', key: 'a', payload: 'P' }, { type: 'approve', key: 'a', payload: 'P' }, { type: 'dispatch', key: 'a' }, { type: 'confirm', key: 'a', receipt: 'R' }] }, expected: { operations: [{ key: 'a', payload: 'P', status: 'confirmed', receipt: 'R' }], remaining: 0, results: ['accepted', 'accepted', 'accepted', 'accepted'] } },
  { label: 'Compatible retries consume dispatch budget once', input: { limit: 1, events: [{ type: 'propose', key: 'a', payload: 'P' }, { type: 'propose', key: 'a', payload: 'P' }, { type: 'approve', key: 'a', payload: 'P' }, { type: 'approve', key: 'a', payload: 'P' }, { type: 'dispatch', key: 'a' }, { type: 'dispatch', key: 'a' }, { type: 'confirm', key: 'a', receipt: 'R' }, { type: 'confirm', key: 'a', receipt: 'R' }] }, expected: { operations: [{ key: 'a', payload: 'P', status: 'confirmed', receipt: 'R' }], remaining: 0, results: ['accepted', 'replayed', 'accepted', 'replayed', 'accepted', 'replayed', 'accepted', 'replayed'] } },
  { label: 'Unknown requires reconciliation before a receipt', input: { limit: 2, events: [{ type: 'propose', key: 'a', payload: 'P' }, { type: 'approve', key: 'a', payload: 'P' }, { type: 'dispatch', key: 'a' }, { type: 'timeout', key: 'a' }, { type: 'dispatch', key: 'a' }, { type: 'confirm', key: 'a', receipt: 'R' }] }, expected: { operations: [{ key: 'a', payload: 'P', status: 'confirmed', receipt: 'R' }], remaining: 1, results: ['accepted', 'accepted', 'accepted', 'accepted', 'reconcile-required', 'accepted'] } },
  { label: 'Conflicting payload and receipt do not overwrite history', input: { limit: 1, events: [{ type: 'propose', key: 'a', payload: 'P' }, { type: 'propose', key: 'a', payload: 'Q' }, { type: 'approve', key: 'a', payload: 'Q' }, { type: 'approve', key: 'a', payload: 'P' }, { type: 'dispatch', key: 'a' }, { type: 'confirm', key: 'a', receipt: 'R' }, { type: 'confirm', key: 'a', receipt: 'different' }] }, expected: { operations: [{ key: 'a', payload: 'P', status: 'confirmed', receipt: 'R' }], remaining: 0, results: ['accepted', 'conflict', 'conflict', 'accepted', 'accepted', 'accepted', 'conflict'] } },
  { label: 'Exhausted budget preserves approved state', input: { limit: 0, events: [{ type: 'propose', key: 'a', payload: 'P' }, { type: 'approve', key: 'a', payload: 'P' }, { type: 'dispatch', key: 'a' }] }, expected: { operations: [{ key: 'a', payload: 'P', status: 'approved', receipt: null }], remaining: 0, results: ['accepted', 'accepted', 'budget-exhausted'] } },
];

const starter = `function solve(input) {
  throw new Error('Implement the stated contract.');
}
`;

export const aiLabProblems: Problem[] = [
  {
    id: 'lab-context-packer', track: 'ml-system-design', title: 'Pack a Ranked Evidence Budget', difficulty: 'Easy',
    description: 'Implement a deterministic context packer over trusted synthetic passage metadata without network or model calls.',
    requirements: [
      'Input has tenant, integer budget >= 0, and at most 1,000 ranked passages with string id/tenant, boolean authorized, and integer tokens >= 0. Inputs satisfy this outer contract.',
      'Ignore wrong-tenant and unauthorized passages. The first eligible occurrence consumes its id even if it does not fit; ignore later duplicates.',
      'Preserve input ranking, skip passages that exceed the remaining budget, and continue looking for later passages that fit. Zero-token passages may fit a zero budget.',
      'Return {ids, tokens} without mutating input. This is a greedy policy, not optimal packing, tokenization, or real authorization.',
    ],
    keywords: [['budget', 'tokens', 'remaining'], ['deduplicate', 'identity', 'seen'], ['tenant', 'authorized', 'scope'], ['order', 'skip', 'greedy']],
    starter, testCases: packerExamples,
    solution: {
      sections: [
        { title: 'Own a narrow, inspectable contract', body: `The input passages are already ranked. This exercise does not estimate relevance, tokenize document text, or query an identity service. It implements a deterministic selection policy over trusted synthetic metadata. The distinction matters: an authorized boolean supplied by an actual HTTP client would not establish permission. A production application must compute access from authenticated scope before it exposes evidence.

Output contains the selected identities in rank order and the exact sum of their supplied token costs. We accept a zero-token record because the educational contract permits it, although real formatted evidence normally has overhead. Every result remains within the nonnegative budget.` },
        { title: 'Track examined eligible identities', body: `Maintain a set of eligible identities already examined, not merely those selected. First reject wrong-tenant or unauthorized records without touching the set. Next ignore any identity already in it. Otherwise add the identity before checking fit. That ordering ensures a long first version cannot be replaced silently by a later short duplicate.

If a passage fits, append its identity and increment the total. If it does not fit, continue rather than ending the scan. A later short passage may still fit. This greedy choice prioritizes the given order and stable identity rule; it does not maximize relevance value per token and should not be presented as a general knapsack solver.` },
        { title: 'State and prove the loop invariant', body: `After each prefix, selected IDs are a unique subsequence of that prefix's eligible first occurrences. Their order matches input rank, and tokens equals exactly their summed supplied cost. The total is never greater than the budget. The seen set includes every eligible first occurrence examined, whether selected or skipped.

Rejecting an ineligible record preserves all four properties. Ignoring a duplicate cannot add cost or change order. A new item is selected only if the new total fits, so the budget property is maintained. Finite input guarantees termination. Input records and their order are never changed because the implementation writes only its own set, output array, and counter.` },
        { title: 'Test the policy rather than a convenient approximation', body: `The duplicate-after-oversize example distinguishes this contract from marking identities only after selection. The zero-budget case distinguishes a correct fit comparison from an early return that would discard allowed zero-cost evidence. Another fixture verifies that rejected evidence does not poison a later eligible identity.

Add exhaustive short sequences with repeated IDs, multiple tenants, access flags, and costs around the exact budget. Compare against an independently constructed eligible-first-occurrence list and a remaining-budget simulation. Example success measures this pure function only. Full prompt accounting, current authorization, source provenance, semantic support, and distributed cache behavior remain separate production responsibilities with their own tests.` },
      ],
      code: packerCode,
      timeComplexity: 'O(n) expected with set membership treated as expected constant time; no relevance sorting is performed.',
      spaceComplexity: 'O(u + s) for examined eligible identities and selected output, bounded by the passage count.',
      lessonIds: ['retrieval-ingestion', 'retrieval-ranking', 'agent-context-state'],
      sourceIds: ['pgvector-search', 'llm-course-roadmap', 'owasp-object-auth'],
      examples: packerExamples,
    },
  },
  {
    id: 'lab-retrieval-metrics', track: 'ml-system-design', title: 'Evaluate a Deduplicated Retrieval Ranking', difficulty: 'Medium',
    description: 'Calculate explicit precision, recall, reciprocal rank, and answerable-query macro averages from binary relevance fixtures.',
    requirements: [
      'Input has integer k from 1 to 1,000 and at most 100 queries, each with relevant and ranked arrays of at most 1,000 string IDs. Inputs satisfy this outer contract.',
      'Deduplicate relevance IDs and ranked IDs; preserve first ranking occurrence, then take top k. Return each item’s hits, precision=hits/k, recall=hits/relevant count or null, and rr=1/first relevant one-based rank or 0.',
      'Compute meanRecall and mrr only over queries with a nonempty distinct relevance set. If there are none, return null aggregates. Preserve all per-query items.',
      'Round reported ratios and aggregate means to six decimal places after computing raw ratios. Never mutate the input.',
    ],
    keywords: [['precision', 'recall', 'denominator'], ['deduplicate', 'rank', 'cutoff'], ['null', 'unanswerable', 'judgment'], ['macro', 'mean', 'round']],
    starter, testCases: metricsExamples,
    solution: {
      sections: [
        { title: 'Choose one explicit metric contract', body: `Metrics are only comparable when their definitions match. This lab uses binary ID relevance, fixed-k precision, deduplication before truncation, and answerable-query macro means. A service using the number actually returned as its precision denominator must label that alternative; neither definition should be introduced accidentally through an implementation detail.

The input is a small judged fixture, not a guarantee that all relevant evidence has been discovered. Missing relevance labels can make useful results appear wrong. Keep evaluation provenance and assess judgment quality separately. The function returns every query item so callers can inspect failures instead of hiding them inside one aggregate.` },
        { title: 'Compute counts before presentation rounding', body: `Convert the relevant list to a set, and construct an ordered unique ranking. Take at most k distinct IDs. Count hits once per ID, and locate the first hit within this cutoff. A relevant item after the cutoff does not improve these at-k measures. A duplicate must not create another hit or another ranking position.

Store the raw floating-point ratios for aggregation, then round the returned display values to six decimal places. Rounding every item before averaging can shift the aggregate. Counts remain integers. The bounded fixture sizes avoid unsafe integer magnitudes, while the explicit rounding rule makes browser serialization and expected examples predictable.` },
        { title: 'Keep undefined values semantically distinct', body: `For a nonempty judged relevance set with no hits, recall is zero. For an empty relevance set, recall is null because its denominator is absent. Such queries remain in the output but are excluded from the two declared answerable-query means. When the entire dataset has no answerable query, the aggregates are null rather than a fabricated successful one.

Reciprocal rank is zero when no relevant item appears within top k. The per-query value remains zero for an unanswerable fixture, but that item is not included in the specified macro MRR. A real product should also measure abstention on verified unanswerable questions. This lab deliberately does not turn an empty label list into a claim that generation should answer confidently.` },
        { title: 'Verify with an independently described oracle', body: `Use short ranked sequences where relevance can be counted by hand. Include repeated IDs before the cutoff, duplicates in the relevance set, empty rankings, a first hit at position two, fewer than k results, and a relevant item just outside the boundary. Multiple-query examples distinguish a macro mean from pooled micro counts.

For broader tests, enumerate rankings over a tiny ID alphabet and compare with a separate first-occurrence-position construction. Inspect invariants: hits cannot exceed k or distinct relevance count, recall stays within zero and one when defined, and adding duplicate IDs does not change results. These checks validate the deterministic evaluator; they do not certify the semantic quality of the query labels or generated answers.` },
      ],
      code: metricsCode,
      timeComplexity: 'O(sum of relevance and ranked lengths) expected, treating set operations as expected constant time.',
      spaceComplexity: 'O(maximum per-query input length + query count), including returned items.',
      lessonIds: ['retrieval-ranking', 'retrieval-experiments'],
      sourceIds: ['llm-evals', 'llm-zoomcamp', 'pgvector-search'],
      examples: metricsExamples,
    },
  },
  {
    id: 'lab-tool-dispatch', track: 'ml-system-design', title: 'Validate a Version-Bound Tool Proposal', difficulty: 'Medium',
    description: 'Build a pure readiness gate for document reads and tag proposals with strict arguments, tenant scope, and exact approvals.',
    requirements: [
      'Input contains a trusted synthetic tenant, unique resources {id,tenant,version}, approvals {callId,documentId,tag,version}, and at most 500 calls {id,name,args}. Resource versions are nonnegative integers; inputs satisfy this outer contract.',
      'Support only read_document with exact keys {documentId}, and set_tag with exact keys {documentId,tag,expectedVersion}. documentId is a nonempty string <=80 chars; tag is a string <=40 chars with non-whitespace content; expectedVersion is a nonnegative integer.',
      'Check unknown tool, argument validity, tenant/resource access, current version for set_tag, then exact approval, in that order. Missing and wrong-tenant resources both yield forbidden.',
      'Return one {id,status,reason} per call. Ready uses reason null; rejected uses unknown-tool, invalid-arguments, forbidden, or stale-version. A valid unapproved set_tag uses status and reason approval-required.',
      'Approval binds callId, documentId, exact tag, and current resource version. Do not mutate input or execute any tool; this is not a production authorization implementation.',
    ],
    keywords: [['schema', 'arguments', 'strict'], ['tenant', 'resource', 'authorization'], ['version', 'approval', 'exact'], ['pure', 'proposal', 'reason']],
    starter, testCases: toolExamples,
    solution: {
      sections: [
        { title: 'Separate gate output from tool execution', body: `The lab returns readiness decisions and never performs an external read or write. This is intentional: it makes malicious or malformed proposals safe to inspect in a browser fixture. Input identity and resources are trusted synthetic facts for this exercise only. A deployed endpoint would derive the actor from an authenticated session and authorize the actual resource again at the execution boundary.

Map unique resource IDs to records. Each call receives an independent result in input order. The registry is fixed to two named capabilities, so unknown names are rejected before inspecting their arguments. There is no arbitrary function lookup, shell access, or network destination supplied by the model.` },
        { title: 'Validate structure before reading business fields', body: `Require an ordinary JSON object shape with exactly the permitted own keys. Null and arrays are invalid argument objects. Check documentId type and length, and for set_tag verify the tag contract and nonnegative integer expectedVersion. Whitespace-only tags are invalid; otherwise the original string is preserved and approval matching is exact, not a hidden normalization.

Only after schema validation does the gate resolve the resource and tenant. A missing resource and a resource in another tenant both produce forbidden, avoiding a distinction that could reveal existence across the boundary. Even a valid read remains only a readiness decision in this model. Structure and ownership answer different questions and should not be conflated.` },
        { title: 'Bind approval after checking current version', body: `For set_tag, reject an expectedVersion that differs from the resource's current version. An approval for the old version cannot override this condition. Then search for an approval matching call identity, document identity, exact tag, and current version. A missing or mismatched approval produces approval-required rather than an executed write or a fabricated success.

Production approval also needs a permitted approving actor, expiry, revocation, and durable auditing. Those fields are intentionally outside this bounded lab. The reference does not infer them from the fact that an approval object appears in input. Explain that limit before reusing this algorithm near a real consequential operation.` },
        { title: 'Verify rejection precedence and non-mutation', body: `The order of checks is observable. An unknown tool with malformed args reports unknown-tool; a known tool with extra keys reports invalid-arguments before resource lookup. A stale write is rejected before approval matching, so an old approval does not disguise a concurrent update. Explicit reason codes let the application ask for a correction or review without parsing prose.

Tests should vary argument keys, scalar types, exact length boundaries, missing IDs, tenant scope, versions, and every approval field. Retain the original input snapshot and repeat calls to detect accidental mutation or leaked state. A framework's schema facility can implement part of this contract, but protocol compliance and library popularity do not establish authority, user consent, or durable side-effect recovery.` },
      ],
      code: toolCode,
      timeComplexity: 'O(r + c × a) expected for r resources, c calls and a approvals; indexed approvals can reduce matching work.',
      spaceComplexity: 'O(r + c) for the resource map and returned decisions.',
      lessonIds: ['agent-tool-contracts', 'agent-context-state', 'agent-recovery'],
      sourceIds: ['mcp-tools', 'hf-agents-course', 'owasp-object-auth'],
      examples: toolExamples,
    },
  },
  {
    id: 'lab-agent-reducer', track: 'ml-system-design', title: 'Reduce a Recoverable Agent Operation History', difficulty: 'Hard',
    description: 'Implement a bounded sequential operation model that preserves payload identity, approval, dispatch budget, and unknown outcomes.',
    requirements: [
      'Input has integer limit >=0 and at most 500 events using string key, canonical payload for propose/approve, or string receipt for confirm. Events have valid outer shapes and use propose, approve, dispatch, timeout, or confirm.',
      'A first propose creates {key,payload,status:proposed,receipt:null}. Same key and payload replays; changed payload conflicts. Missing-key commands return not-found. Approve requires matching payload and moves proposed to approved; later matching approvals replay.',
      'Dispatch only approved records, consuming one remaining unit. At zero budget return budget-exhausted without mutation. Repeated dispatch on dispatched/confirmed replays; unknown returns reconcile-required; proposed returns invalid-state.',
      'Timeout moves dispatched to unknown, repeats on unknown replay, and other states reject. Confirm moves dispatched/unknown to confirmed with receipt; same confirmed receipt replays and changed receipt conflicts. Other confirmation states reject.',
      'Return {operations,remaining,results}, with operations in first-proposal order and one result code per event. Successful changes use accepted; invalid transitions use invalid-state. Do not mutate input. This pure reducer is not durable storage or a distributed exactly-once executor.',
    ],
    keywords: [['state', 'transition', 'invariant'], ['key', 'payload', 'idempotency'], ['unknown', 'reconcile', 'receipt'], ['budget', 'prefix', 'atomic']],
    starter, testCases: reducerExamples,
    solution: {
      sections: [
        { title: 'Model a logical operation, not a conversational assertion', body: `Each key identifies one canonical payload for the whole history. Store records in insertion order so output is deterministic. A proposal creates local intent; it does not dispatch a provider call. Approval changes the permitted phase, and dispatch consumes the lab's simplified integer allowance exactly once. A receipt confirms an already dispatched or unknown operation.

The payload string is assumed canonical by the input contract. Real systems must define canonicalization and bind operation identity durably. The lab cannot supply authentication, approval actor checks, persistence, or provider idempotency. Its purpose is to make a small observable state machine precise enough to test independently before adding those infrastructure boundaries.` },
        { title: 'Preserve identity through compatible replay', body: `A duplicate proposal is replayed only when its payload matches. A conflicting proposal or approval never overwrites the stored payload. Approving an already advanced operation with the same payload is a no-op replay. Dispatching an already dispatched or confirmed operation also replays without decrementing the allowance again.

This local replay decision must not be interpreted as a second outbound effect. In a real executor, retrieving an existing operation and recovering its status are separate from sending a fresh operation. Terminal receipts must remain recoverable for the declared retry horizon. The implementation's map is unbounded only up to this exercise's finite history; a production service needs retention and capacity rules.` },
        { title: 'Keep unknown outcomes explicit', body: `Timeout changes dispatched to unknown because a lost response cannot establish whether the external effect occurred. Redispatch then reports reconcile-required. A later authoritative confirmation resolves either dispatched or unknown to confirmed. Once confirmed, a repeated matching receipt replays while a different receipt conflicts, preserving the original observation instead of silently rewriting history.

The local model accepts a confirm event as trusted evidence. A deployed integration must authenticate and validate the source of that receipt and reconcile provider state under its actual API contract. No database, checkpointer, or pure function can create an exactly-once guarantee across an arbitrary external side effect without cooperation from that boundary.` },
        { title: 'Prove budgets and test every prefix', body: `Only an approved-to-dispatched transition decrements remaining allowance. It requires a positive remainder; all rejected or replayed events preserve it. Therefore remaining never becomes negative, and each logical record consumes at most one unit. Unknown state cannot be erased by another dispatch. Payload and confirmed receipt identity remain unchanged after conflicts.

Test these invariants after every prefix of short histories, including competing keys, exhausted allowance, out-of-order commands, repeated timeouts, and conflicting receipts. Compare with an independently defined transition table rather than copying the same branching code into a second function. Browser examples prove the reference matches the bounded protocol; real worker crashes, transactional ownership, fencing, provider effects, and storage recovery require integration tests.` },
      ],
      code: reducerCode,
      timeComplexity: 'O(e) expected for e events with map access treated as expected constant time.',
      spaceComplexity: 'O(e + o), including event results and o retained operation records.',
      lessonIds: ['agent-tool-contracts', 'agent-context-state', 'agent-recovery'],
      sourceIds: ['langgraph-persistence', 'stripe-idempotency', 'effective-agents'],
      examples: reducerExamples,
    },
  },
];
