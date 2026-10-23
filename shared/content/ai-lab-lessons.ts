import type { Lesson } from '../types';

function reading(content: Omit<Lesson, 'minutes'>): Lesson {
  const text = content.sections.flatMap(section => [section.body, ...(section.bullets ?? [])]).join(' ');
  return { ...content, minutes: Math.max(3, Math.ceil(text.trim().split(/\s+/).length / 200)) };
}

export const aiLabLessons: Lesson[] = [
  reading({
    id: 'retrieval-ingestion', title: 'Build a reproducible retrieval dataset', group: 'Retrieval engineering lab',
    summary: 'Turn source changes into inspectable index generations instead of an unrepeatable collection of embeddings.',
    objectives: ['Identify the artifacts needed to reproduce retrieval.', 'Separate source identity from chunk and model versions.', 'Plan deletion, backfill, and rollback without restoring revoked evidence.'],
    quizTopic: 'retrieval-ranking', relatedProblemIds: ['lab-context-packer'],
    sourceIds: ['llm-course-roadmap', 'llm-zoomcamp', 'pgvector-search'],
    sections: [
      { title: 'Use popular courses as a map, not a correctness oracle', body: `Maxime Labonne's LLM Course and DataTalks.Club's LLM Zoomcamp connect ingestion, vector search, evaluation, and deployment into a useful project sequence. This Studio path follows that progression with original explanations and small executable exercises, not copies of their notebooks, recordings, or assignments. The linked upstream repositories retain their own terms; no upstream certification or affiliation is implied.

Stars indicate community interest, not measured correctness or suitability for your data. Check the pinned curriculum, maintenance, and primary documentation before adopting a technique. Our labs deliberately isolate deterministic mechanisms that can run without credentials or a GPU. They complement the architecture course, but do not claim that a browser exercise is a complete production retrieval service.` },
      { title: 'Create an artifact manifest before creating vectors', body: `A reproducible index needs the source snapshot, extraction configuration, chunking policy, embedding model revision, tokenizer assumptions, and index parameters. Record these in a manifest with a stable generation identifier. If a query becomes worse after a deployment, the manifest should let you identify which artifact changed rather than guessing from a current model name.

Source identity and content equality are different concepts. Two departments can upload the same file under different permissions. One source can change its text while retaining its identity. Assign chunks to a specific source version and location; do not use an embedding vector as a business identifier. Preserve the extraction evidence so a relevance judgment can be traced back to the original document.` },
      { title: 'Make ingestion replayable and bounded', body: `Persist a source version and work intent before acknowledging durable acceptance. Workers use a stable derivation key and conditional publication so duplicate or reordered messages cannot overwrite a newer generation. A failed embedding request should leave a visible incomplete derivation, not a supposedly successful source with missing chunks. Track failures and retries separately from source deletion.

Bound file size, chunk count, worker concurrency, provider usage, and retries. A backfill can be much larger than ordinary updates, so isolate its admission budget. Incremental change processing needs a reliable cursor or reconciliation pass; a connector's best-effort notification alone may miss updates. Measure source-to-index lag by version, not merely the number of jobs processed.` },
      { title: 'Test chunking against the task', body: `Character windows are a simple baseline, but headings, table headers, code scope, and paragraph boundaries can be more meaningful. Compare chunk policies using the same judged queries. Very small chunks can lose context; very large chunks can waste the prompt budget and dilute relevance. Overlap duplicates information and can exaggerate apparent evidence coverage if metrics count copies as independent support.

Keep a stable document or evidence identity for deduplication. Store supplied token costs only when their counting method is known. The context-packing lab uses trusted synthetic token counts to focus on budget arithmetic; an actual service must count the complete formatted prompt using the selected tokenizer and reserve space for instructions, schemas, conversation, and output.` },
      { title: 'Publish generations without weakening access', body: `Build a replacement index beside the active one, validate its completeness and relevance, then switch a versioned pointer. Keep old artifacts only under a defined retention and rollback policy. A rollback must not restore a deleted source or an access grant revoked since the old generation was built. Current authorization stays authoritative even when the index is a stale derived copy.

Test interrupted builds, duplicate events, source deletion during backfill, and a query racing a generation switch. An index can be internally complete but obsolete relative to the product's freshness contract. Report generation age and outstanding reconciliation work. The goal is an explainable data path with explicit failure states, not a claim that every asynchronous update is instantly visible everywhere.` },
    ],
    exercise: 'Write an index-generation manifest and a failure test for deletion during backfill. Then implement the context-packing lab using only the supplied synthetic evidence records.',
  }),
  reading({
    id: 'retrieval-ranking', title: 'Tune retrieval without confusing scores and evidence', group: 'Retrieval engineering lab',
    summary: 'Compare exact and approximate search, filtering, rank fusion, and deterministic context packing.',
    objectives: ['Choose a similarity contract and exact baseline.', 'Explain why approximate filtering can reduce returned candidates.', 'Implement a stable evidence budget policy without pretending it is an optimal knapsack solver.'],
    quizTopic: 'retrieval-ranking', relatedProblemIds: ['lab-context-packer', 'lab-retrieval-metrics'],
    sourceIds: ['pgvector-search', 'azure-hybrid-ranking', 'llm-course-roadmap'],
    sections: [
      { title: 'Define similarity before selecting an index', body: `An embedding model supplies vectors, but the comparison rule still matters. Dot product is affected by vector magnitude; cosine similarity compares direction after accounting for norms; Euclidean distance measures a different geometry. Normalized nonzero vectors have useful ranking relationships, but those assumptions must be explicit. A zero vector has no defined cosine direction and should not be silently treated as a normal embedding.

Use the embedding model's intended metric and evaluate it on your queries. Verify dimensions, precision, and revision compatibility at ingestion and query time. Mixing vectors from two models with equal dimensions does not make them comparable. A larger vector or a popular leaderboard score does not prove that an index improves the specific document and language slices your users need.` },
      { title: 'Establish an exact-search reference', body: `Exact nearest-neighbor search over a representative authorized subset gives a reference against which to measure approximate retrieval. In pgvector, an approximate HNSW or IVFFlat index trades some neighbor recall for speed. Index structure, build time, memory, update behavior, and query settings all affect that tradeoff. Preserve an exact baseline rather than benchmarking only approximate configurations against each other.

Distinguish neighbor recall against exact vector results from semantic relevance recall against human judgments. The closest vectors may not be the passages that answer the question. A system can have excellent approximate-neighbor recall and poor product relevance because the embedding, chunk boundaries, or query representation is unsuitable. Measure both layers and label them clearly.` },
      { title: 'Inspect filtering at the actual query boundary', body: `Approximate candidates may be collected before some filtering work, depending on the database plan and index behavior. A restrictive tenant or category filter can therefore leave fewer results than the requested limit. Inspect the actual plan and documented search settings. Iterative scans, a larger bounded candidate budget, partitioning, or an exact filtered path may be appropriate, but each needs measurement.

Never remove an authorization predicate to improve the recall chart. Apply current access checks before candidate content reaches a model or external reranker. Query-time filtering and authoritative revocation are different responsibilities. A filter that is syntactically present in SQL does not by itself prove a source's current access policy has been enforced.` },
      { title: 'Fuse and rerank with a measurable budget', body: `Lexical retrieval handles exact identifiers while dense retrieval can find paraphrases. Combine ranked lists with a tested policy such as reciprocal rank fusion instead of assuming unlike raw scores share units. Deduplicate stable evidence identities and compare the fused list against both single-retriever baselines. Query rewriting and hypothetical answers are experiments, not requirements; measure extra latency and the risk of drifting from the user's request.

A reranker can improve ordering only within its candidate set. Set a maximum candidate count and passage length, then measure relevance and deadline behavior. If the useful source is missing before reranking, fix that stage first. If it is found but removed during context packing, changing the embedding model is an indirect and expensive response.` },
      { title: 'Specify what the context packer optimizes', body: `The lab takes already ranked records and keeps eligible evidence in order, up to a supplied token budget. It ignores unauthorized or wrong-tenant records, accepts only the first eligible occurrence of an identity, and skips passages that do not fit. Importantly, an identity is consumed when its first eligible occurrence is examined, even if that passage is too large. A later duplicate does not become a different version by accident.

This is a deterministic greedy policy, not an optimal utility-per-token solver. It does not truncate a table or prove that a chosen passage is true. The authorization booleans are trusted fixture inputs, not permissions supplied by a real user. In production, access decisions come from the server, token costs include formatting, and citation provenance must survive packing. Test exact-budget, zero-budget, duplicate, and skipped-long-passage cases.` },
    ],
    exercise: 'Compare an exact baseline with approximate filtered retrieval. Implement the stated packer, then construct an example where a different packing objective would choose different evidence.',
  }),
  reading({
    id: 'retrieval-experiments', title: 'Evaluate rankings and make a release decision', group: 'Retrieval engineering lab',
    summary: 'Implement retrieval metrics with declared denominators and separate answerable queries from abstention cases.',
    objectives: ['Calculate precision, recall, and reciprocal rank consistently.', 'Prevent duplicate results and unanswerable items from inflating scores.', 'Design a paired retrieval experiment with release and rollback criteria.'],
    quizTopic: 'retrieval-experiments', relatedProblemIds: ['lab-retrieval-metrics'],
    sourceIds: ['llm-zoomcamp', 'llm-evals', 'pgvector-search'],
    sections: [
      { title: 'Turn the capstone idea into a controlled experiment', body: `LLM Zoomcamp emphasizes an end-to-end assistant with retrieval evaluation and monitoring. Our smaller lab isolates the ranking evaluator so an implementation can be checked before a model or dashboard obscures its mistakes. Begin with a labeled query set and compare a candidate to an unchanged baseline on exactly the same items.

Record source generation, query transformation, retriever settings, and relevance judgments. Keep development queries separate from final evaluation. If the same policy appears in several almost identical documents, split or group by source family to avoid an unrealistically easy test. State whether relevance is graded or binary; the executable exercise deliberately uses binary IDs with a known relevance set.` },
      { title: 'Write the denominator before the code', body: `For a query with known relevant evidence, recall at k is the number of distinct relevant retrieved IDs divided by the number of distinct relevant IDs. In this lab, precision at k divides hits by k even if fewer than k distinct results were returned. That convention penalizes unfilled result slots; other contracts may use the number returned, so do not compare unlabeled metrics from different implementations.

Deduplicate ranked IDs before taking the first k so repeated copies do not gain credit or consume useful ranking positions. Reciprocal rank is one divided by the one-based position of the first relevant result within that deduplicated top-k list, or zero if none is found. The lab rounds final reported values to six decimal places, not intermediate hit counts.` },
      { title: 'Keep unanswerable queries visible', body: `If the judged relevant set is empty, recall has a zero denominator. The lab reports null recall and excludes that query from mean recall and mean reciprocal rank. It still exposes the per-query result so the caller can evaluate abstention separately. Treating undefined recall as one would reward missing labels; treating it as zero could mix evidence discovery with a different task.

For answerable queries with no retrieved results, recall and reciprocal rank are zero. For a dataset with no answerable queries, the aggregate fields are null rather than a success-shaped perfect score. A real evaluation must distinguish genuinely unanswerable questions from incomplete relevance judgments. An empty label list alone is not proof that no correct source exists.` },
      { title: 'Separate offline improvements from user outcomes', body: `Higher recall can increase model cost if the context becomes much larger. Higher precision can suppress rare but necessary evidence. Report query slices, candidate count, latency, and context-token usage alongside ranking metrics. Test answer generation separately for supported claims, completeness, and abstention. A source ID counted as relevant does not prove the final answer used it correctly.

Use paired comparisons on shared queries and inspect the changes that matter most to users. A macro average gives equal weight to queries; a micro average weights by pooled counts and answers a different question. Repeat variable model judgments and calibrate them against reviewed examples. Do not select a winning prompt from the holdout and continue calling that set independent.` },
      { title: 'Release with an inspectable evidence trail', body: `Set acceptance thresholds before looking at the candidate score. Protect critical query slices and authorization tests, bound p95 latency and cost, and define a canary rollback trigger. A modest overall gain should not compensate for returning a revoked document or failing every exact-identifier query. Retain the versioned baseline so a rollback can be performed without rebuilding from memory.

Monitor source freshness, query failure categories, empty-result rate, user correction signals, and operational saturation. Feedback is useful but not automatically a factual label. Keep sensitive queries out of default logs and sample under a reviewed retention policy. The final experiment report should explain which component improved, what tradeoff it introduced, and which uncertainty remains, not just display one impressive number.` },
    ],
    exercise: 'Implement the ranking evaluator and verify its null and deduplication rules. Write a release note for a candidate that improves average recall but regresses exact-identifier queries.',
  }),
  reading({
    id: 'agent-tool-contracts', title: 'Tools are typed proposals, not ambient authority', group: 'Agent execution lab',
    summary: 'Build a deterministic tool gate and compare framework capabilities without confusing schemas with authorization.',
    objectives: ['Validate a named tool and exact argument shape.', 'Bind access and approval to current server-owned state.', 'Explain what MCP and agent frameworks standardize and what they do not.'],
    quizTopic: 'agent-tool-contracts', relatedProblemIds: ['lab-tool-dispatch'],
    sourceIds: ['hf-agents-course', 'mcp-tools', 'owasp-prompt-injection'],
    sections: [
      { title: 'Separate the agent idea from the framework choice', body: `The Hugging Face Agents Course explores tool use through several frameworks and an evaluated final project. This Studio follow-up uses original framework-independent JavaScript labs so you can inspect the contract without installing a provider SDK. It is not the upstream assignment or its certification. The same behavioral tests should remain useful if you later choose smolagents, LangGraph, LlamaIndex, or a small application-owned loop.

Compare frameworks on persistence, interrupts, tool validation, tracing, testability, and deployment constraints rather than package popularity alone. Model output proposes a tool name and arguments. An executor then determines whether that proposal is structurally valid, authorized, current, approved when required, and within budget. No framework label removes those decisions.` },
      { title: 'Define names, schemas, and result semantics', body: `A tool needs a stable name, meaningful description, input schema, bounded result, and explicit failure categories. Distinguish a user-correctable argument error from a transient infrastructure problem and an unknown external outcome. Reject extra fields when the tool contract is strict; accepting arbitrary hidden options can create behavior the reviewer never saw.

MCP standardizes discovery and invocation messages and can describe structured output. It does not dictate every application interaction pattern or make arbitrary server annotations trustworthy. Tool descriptions and returned content can themselves carry malicious or misleading instructions. Use an approved registry and capability boundary. A valid protocol envelope proves that a message has a shape, not that its requested business action is permitted.` },
      { title: 'Resolve resources under authenticated scope', body: `The tool-gate lab receives a trusted synthetic tenant and a resource list. It first validates the tool-specific arguments, then checks that the referenced resource belongs to that tenant. Real services derive identity from authenticated server state and recheck object access inside the operation. Never trust a model-supplied actor or an authorization boolean from an HTTP client.

The lab's read tool returns only a readiness decision; it does not load documents or contact a network. Its write-shaped tool proposes a tag change and requires the expected resource version. Keeping this model pure lets tests enumerate unsafe proposals without executing them. A passing fixture is evidence about this gate's contract, not proof of production access control or network isolation.` },
      { title: 'Approve the exact versioned action', body: `A tag proposal is ready only when a matching approval binds call identity, document identity, tag, and current resource version. A changed tag or version cannot inherit the old approval. Check current state before using approval, and reject stale expected versions even if an old approval object still exists. The lab represents time-free exact matching; a production policy additionally needs actor authority, expiry, cancellation, and audit records.

Do not execute a write while merely checking its parameters. Separate validation, approval, durable intent, and dispatch so the user interface can explain what will happen. A broad conversation-level confirmation can conceal material changes. Likewise, a schema-valid amount or destination does not establish that the person approved that exact consequence.` },
      { title: 'Make rejected proposals a useful observation', body: `Return a bounded status and reason code that the application can handle deterministically. The lab distinguishes unknown tool, invalid arguments, forbidden resource, stale version, approval required, and ready. Invalid proposals do not modify resource state. Tests cover extra keys, missing resources, another tenant, stale revisions, and mismatched approvals as well as ordinary valid requests.

An agent may use safe error feedback to ask for clarification, but retries still need a budget. Repeating the same invalid proposal should not trigger an endless repair loop. Avoid revealing whether another tenant's sensitive resource exists; a real API can use a deliberately indistinguishable forbidden-or-missing response. Keep diagnostic detail in access-controlled records rather than returning every internal policy fact to the model.` },
    ],
    exercise: 'Implement the pure tool gate for read_document and set_tag. Explain which extra checks are required before replacing the readiness result with a real external write.',
  }),
  reading({
    id: 'agent-context-state', title: 'Separate conversation, memory, and business state', group: 'Agent execution lab',
    summary: 'Choose what an agent remembers, who can read it, and which records remain authoritative after a restart.',
    objectives: ['Distinguish thread checkpoints from cross-thread memory.', 'Keep conversation summaries subordinate to operation receipts.', 'Design bounded context and memory retention with tenant isolation.'],
    quizTopic: 'agent-recovery', relatedProblemIds: ['lab-context-packer', 'lab-agent-reducer'],
    sourceIds: ['hf-agents-course', 'langgraph-persistence', 'effective-agents'],
    sections: [
      { title: 'Name the state before choosing a store', body: `An agent often needs several different data systems. Conversation history records what was said. A checkpoint records a resumable computation state. Long-term memory may store user preferences or useful facts across conversations. Business records establish current account state and confirmed operations. Combining all four into one unstructured transcript makes authority and recovery difficult to reason about.

LangGraph distinguishes thread-scoped checkpointers from application-defined cross-thread stores. The distinction is useful even outside that framework. A thread identifier selects context; it is not an authorization token. Check who may read or resume that thread, and keep shared memory scoped by tenant and user according to the product's actual collaboration rules.` },
      { title: 'Checkpoint at a meaningful boundary', body: `A checkpoint should capture enough information to continue without redoing a consequential operation blindly. Persist the task version, chosen evidence references, proposed action, operation identity, pending approvals, and progress budgets as appropriate. A process-local dictionary may help development but disappears on restart. Naming an object MemorySaver does not make it durable.

Choose a persistent backend and verify its transaction and recovery behavior. A framework can save graph state while an external tool has already completed a side effect that is not represented in the latest checkpoint. The business-operation receipt therefore needs an explicit relationship to the checkpoint. Test the gap between external completion and local persistence rather than assuming a successful in-memory trace covers it.` },
      { title: 'Build context from current evidence, not every past token', body: `A growing transcript eventually exceeds a useful prompt budget. Keep a bounded recent window, summarize lower-risk history where appropriate, and retrieve relevant authorized memories. Preserve source and time information so a stale preference or inferred fact can be corrected. Deduplicate repeated evidence and reserve space for the current task, tool schemas, and output.

Summaries are lossy model outputs, not immutable truth. They can omit negation, invent an agreement, or carry injected instructions from old source text. Do not summarize an approval into a broad statement and then use it to authorize a new action. The context-packer exercise demonstrates an explicit budget policy, but a real context builder must also account for role boundaries, formatting overhead, provenance, and current access.` },
      { title: 'Govern memory writes as carefully as reads', body: `Decide which information may become durable memory, why it is needed, and how a user can inspect or correct it. A tool result or retrieved document must not silently write new global instructions. Distinguish an explicit user preference from an inferred model guess. Store only the minimum relevant fact with an appropriate scope and retention policy.

Deletion and access revocation need to reach derived summaries, embeddings, and caches. Shared memories can outlive the conversation that created them, so a thread deletion alone may not remove them. Measure storage growth and prune checkpoints under a policy that preserves required recovery and audit records. Privacy is not solved merely by putting the same unbounded transcript in a different database.` },
      { title: 'Keep authoritative outcomes outside model memory', body: `A model may remember that an operation succeeded, but the executor should establish success from the durable operation record or provider receipt. If the record says unknown after a timeout, a confident summary must not upgrade it to confirmed. If current account state changed independently, an old conversation must not overwrite it without a valid conditional operation.

The reducer lab makes these state distinctions observable through deterministic event histories. It is a single-process model, not a production persistence layer. Reimplementing its invariant with transactions, unique keys, ownership checks, and external recovery requires integration tests. Use memory to make conversation useful and computation resumable, while keeping permission and business facts anchored to their actual authorities.` },
    ],
    exercise: 'Map a support assistant’s transcript, checkpoint, preference store, approval, and provider receipt. Identify which may be summarized and which must remain an exact authoritative record.',
  }),
  reading({
    id: 'agent-recovery', title: 'Resume an agent without replaying its side effects', group: 'Agent execution lab',
    summary: 'Model durable intent, approval, dispatch, ambiguity, and confirmation as explicit observable transitions.',
    objectives: ['Define stable operation identity and payload compatibility.', 'Preserve an unknown state after a timeout.', 'Test every history prefix and distinguish a pure reducer from durable execution.'],
    quizTopic: 'agent-recovery', relatedProblemIds: ['lab-agent-reducer', 'lab-tool-dispatch'],
    sourceIds: ['langgraph-persistence', 'stripe-idempotency', 'effective-agents'],
    sections: [
      { title: 'Choose the invariant before the event API', body: `The key invariant is that one logical operation identity remains bound to one canonical payload and consumes dispatch budget at most once in the local model. An accepted proposal can become approved, then dispatched, then confirmed or unknown. A retry with the same identity must recover compatible state instead of silently creating another operation.

The lab uses a canonical payload string supplied by the caller to focus on state semantics. Production systems need deterministic canonicalization or another reviewed payload-binding mechanism. Arbitrary JSON property order is not a safe business identity rule. Record the operation before sending it externally and preserve enough information to reconcile its outcome after a process restart.` },
      { title: 'Make duplicate and conflicting commands different', body: `Repeating an existing proposal with the same payload is a compatible replay. Reusing its key with a different payload is a conflict and must not modify the original record. Approving an unchanged proposal can be idempotent, while approving a changed payload is not allowed. The testable result should reveal whether a command advanced state, replayed a receipt, conflicted, or was invalid in the current phase.

Keep observation separate from action: reading a confirmed receipt should not dispatch again. Retain terminal records for the declared replay horizon, then define what happens when a key is too old to recover. A permanent deduplication promise with no storage or retention accounting is not a complete operational design.` },
      { title: 'Do not turn transport uncertainty into a fresh action', body: `A timeout after dispatch moves the lab operation to unknown. Another dispatch request in that state returns reconcile-required and consumes no extra budget. An authoritative confirmation can later move unknown to confirmed. This models the fact that a provider might have completed the effect even though the response was lost.

Actual recovery depends on the external contract. A provider status lookup or compatible replay under the same supported key may establish the result. If the provider supplies neither mechanism, the application may need human investigation or a domain-specific reconciliation process. A checkpoint or local database transaction cannot make arbitrary external side effects exactly once by itself.` },
      { title: 'Protect budgets at the same authority boundary', body: `In the sequential lab, the first valid dispatch decrements remaining budget once. Compatible repeats do not charge another dispatch, and proposals or approvals do not consume this particular budget. When no budget remains, the operation stays approved and returns budget-exhausted. The model does not pretend that a rejected dispatch secretly happened.

In production, concurrent workers must coordinate operation ownership, current state, and resource reservations atomically. A local counter or lease without fencing can allow both workers to dispatch. Provider charges and actual side effects also need receipts and reconciliation; the lab's integer dispatch budget is not an implementation of monetary billing or GPU admission. Name the simplified resource honestly.` },
      { title: 'Test histories rather than only the final answer', body: `Enumerate short histories containing duplicate proposals, mismatched approvals, dispatch before approval, timeout, repeated dispatch, confirmation, and conflicting receipts. Assert state and remaining budget after each prefix. The final state alone can hide an intermediate double dispatch or an invalid mutation that was later overwritten. Verify that input fixtures remain unchanged and repeated solver calls do not share mutable state.

Compare against an independent state-table oracle, not a second copy of the reference implementation. A framework replay test should additionally restart real workers and inject failures around durable boundaries. The original browser lab provides a small, inspectable contract you can reason about; it does not certify distributed correctness, provider behavior, or interview readiness. Explain those limits when presenting the completed exercise.` },
    ],
    exercise: 'Implement the event reducer, then show the complete state history for propose, approve, dispatch, timeout, redispatch, and confirm. Explain why the redispatch must not create a second logical effect.',
  }),
];
