import type { Problem, WorkedCase } from '../types';

export const aiEngineeringProblems: Problem[] = [
  {
    id: 'ai-knowledge-assistant', track: 'ml-system-design', title: 'Design a Permission-Aware Knowledge Assistant', difficulty: 'Medium',
    description: 'Answer employee questions over changing private documents with grounded citations and immediate access revocation.',
    requirements: ['Version source documents and derived chunks.', 'Compare lexical, dense, and hybrid retrieval.', 'Enforce current access before evidence reaches a model.', 'Return supported claims or explicit abstention.', 'Evaluate retrieval, answer quality, freshness, latency, and cost separately.'],
    keywords: [['chunk', 'version', 'index'], ['hybrid', 'lexical', 'retrieval'], ['authorization', 'permission', 'tenant'], ['citation', 'evidence', 'abstain'], ['evaluation', 'recall', 'latency']],
  },
  {
    id: 'ai-support-agent', track: 'ml-system-design', title: 'Design an Approval-Gated Support Agent', difficulty: 'Hard',
    description: 'Draft support answers and propose subscription changes while retaining human control and recovering ambiguous tool outcomes.',
    requirements: ['Choose explicit workflow states and terminal outcomes.', 'Authorize each narrow tool using authenticated identity.', 'Bind approval to exact versioned action parameters.', 'Persist intent and recover unknown external outcomes safely.', 'Bound steps, time, tokens, and cost; evaluate actual state changes.'],
    keywords: [['workflow', 'state', 'checkpoint'], ['authorization', 'tool', 'scope'], ['approval', 'version', 'payload'], ['idempotency', 'unknown', 'reconcile'], ['budget', 'evaluation', 'limit']],
  },
  {
    id: 'ai-inference-gateway', track: 'ml-system-design', title: 'Design a Bounded LLM Inference Gateway', difficulty: 'Hard',
    description: 'Serve multiple tenants through a measured inference pool with token budgets, deadline-aware admission, and truthful streaming failures.',
    requirements: ['Define first-token and completion SLO boundaries.', 'Estimate model and KV memory under stated assumptions.', 'Apply atomic tenant budgets and global admission bounds.', 'Version compatible caches and restrict provider fallback.', 'Observe failures and reconcile usage without storing sensitive prompts by default.'],
    keywords: [['first token', 'prefill', 'decode'], ['kv', 'memory', 'concurrency'], ['quota', 'reservation', 'admission'], ['cache', 'fallback', 'version'], ['usage', 'trace', 'privacy']],
  },
  {
    id: 'ai-document-review', track: 'ml-system-design', title: 'Design a Traceable Document Review Pipeline', difficulty: 'Medium',
    description: 'Extract invoice fields from scans and tables, preserve source evidence, and publish only verified or approved records.',
    requirements: ['Persist immutable source versions with bounded asynchronous jobs.', 'Preserve layout and field-level evidence.', 'Represent missing or conflicting values explicitly.', 'Validate business constraints and bind review to an extraction revision.', 'Measure critical-field accuracy, backlog, correction rate, and privacy.'],
    keywords: [['version', 'queue', 'idempotency'], ['layout', 'page', 'provenance'], ['missing', 'abstain', 'uncertain'], ['validation', 'approval', 'revision'], ['accuracy', 'backlog', 'retention']],
  },
];

export const aiEngineeringCaseStudies: WorkedCase[] = [
  {
    problemId: 'ai-knowledge-assistant',
    summary: 'Keep source authority outside the language model: version evidence, recheck access, and evaluate supported answers against a search baseline.',
    assumptions: [
      'Hypothetical workload: 200,000 source documents, averaging 12 chunks each; 40,000 questions per working day.',
      'Each indexed embedding has 1,536 float32 components; logical vector bytes exclude index structure, metadata, and replication.',
      'The product targets p95 first-token latency under three seconds for admitted questions; document updates may lag five minutes, but authorization is rechecked before prompt construction.',
      'The assistant is read-only. Missing authorized evidence produces abstention or an authorized source-search view, never a fabricated answer.',
    ],
    diagram: `Source connectors -> versioned objects + outbox -> chunk/embed workers
     |                                                |
     +-> authoritative access policy                  v
User -> authenticated query API -> lexical + vector index
                |                         |
                +-> current access check <- candidate IDs
                |                         |
                +-> rerank -> context -> model -> supported answer
                                     |
                              bounded evaluation traces`,
    calculations: [
      { label: 'Indexed chunk count', factors: [200000, 12], divisor: 1, result: 2400000, unit: 'chunks', assumption: 'Twelve chunks per source is an explicit illustrative average.' },
      { label: 'Logical embedding payload', factors: [200000, 12, 1536, 4], divisor: 1000000000, result: 14.7456, unit: 'GB', assumption: 'Decimal GB at four bytes per component; no graph index, metadata, or replica overhead.' },
      { label: 'Average question rate during eight working hours', factors: [40000], divisor: 28800, result: 1.39, unit: 'questions/second', assumption: 'Eight-hour window; peak demand and per-request tokens require separate measurement.' },
    ],
    sections: [
      { title: 'Make answerability and access part of the contract', body: `Start with ranked source search and measure whether authorized employees can find the correct policy. The generated-answer version must improve that outcome without increasing unsupported decisions. Define supported claims, source-version visibility, appropriate abstention, and the latency boundary. A source title or summary may itself be confidential, so metadata is part of the access contract.

POST /questions takes a query and an optional conversation ID. The server derives the tenant and actor from the session. A conversation ID is not an authorization token. Reauthorize every turn and avoid carrying forward evidence that the actor can no longer read. The model receives bounded evidence and task instructions, not credentials or a privileged list-all-documents capability.` },
      { title: 'Ingest versions without resurrecting deleted content', body: `Connectors assign a stable source ID and monotonic source version. Persist the immutable source and ingestion intent together before publishing work. Workers deduplicate by source version, extraction configuration, and embedding revision. They preserve page or section locations and update only if the event is not older than the accepted source version. A delayed update must not overwrite a newer deletion tombstone.

Store chunk IDs independently from their text content, plus tenant, source version, tokenizer or embedding revision, and derivation metadata. Reindex into a new generation when representations change, compare relevance, and switch an index pointer only after validation. Keep an explicit rollback policy that does not restore revoked documents or obsolete permissions along with an older index.` },
      { title: 'Retrieve candidates and authorize before reading evidence', body: `Run bounded lexical and vector queries using authenticated tenant and access filters. Merge candidates by stable identity using a tested rank-fusion policy. Before loading text into the prompt or sending it to a reranker outside the trusted boundary, verify current access and accepted source version. If the authorization service cannot establish permission, withhold that evidence rather than trusting a stale index field.

Rerank a bounded candidate set, then pack distinct passages with their source identifiers and locations. Preserve enough surrounding table or heading context to interpret the claim. Record which stage lost relevant material in evaluation. Search recall is not rescued by a better generator when the correct source never entered the final evidence set.` },
      { title: 'Generate claims that can be inspected', body: `Ask for an answer tied to the provided evidence, with a structured mapping between claims and source spans where practical. Treat this as a proposal. Validate citation IDs against the exact evidence supplied, and reject invented references. Entailment and completeness still require task evaluation or review: a syntactically valid source ID does not prove the passage supports the claim.

When authorized evidence is missing or contradictory, state the limitation and offer the underlying search results that the user may inspect. Do not silently fall back to general model knowledge for an internal policy question. Separate explicit general guidance from source-backed policy if the product permits both. Stream only under a contract that explains how invalid or incomplete answers are handled.` },
      { title: 'Contain caches and diagnose failures', body: `A source cache uses source version and current access checks. An answer cache also depends on the authorization scope, evidence versions, model, and prompt configuration; question text alone is an unsafe key. Reuse computation only when the privacy and freshness contracts remain valid. For this workload, avoid answer caching initially unless measured cost or latency justifies the invalidation complexity.

Bound query length, candidate count, reranker work, model output, concurrency, and total deadline. On a model outage, return authorized source results with a visible generation-unavailable state rather than a fabricated successful answer. Log identifiers, timings, and failure categories by default. Store raw queries or documents only under a reviewed purpose, access policy, and retention limit.` },
      { title: 'Ship with adversarial and ordinary query slices', body: `Create judged sets for exact policy names, paraphrases, document revisions, conflicting sources, empty evidence, and access revocation. Report candidate recall, context usefulness, supported-claim rate, appropriate abstention, first-token latency, and cost per useful answer. Compare identical evidence sets when testing prompt changes, and identical queries when testing retrieval changes. Avoid collapsing every metric into an unexplainable single score.

Exercise revocation while a conversation remains open, while caches are warm, and while indexing is delayed. Include source text that instructs the assistant to reveal another tenant's material. The decisive evidence is what content entered the model and what the server returned, not merely whether the final wording sounds cautious. Release gradually and retain a working search-only rollback path.` },
    ],
    followUps: [
      { question: 'Why not put the entire document collection into a larger context window?', answer: 'The corpus is far larger than an economical per-request context, and a large window does not establish authorization, source freshness, or reliable use of every passage. Focused retrieval can reduce cost and make evidence inspectable. Compare retrieval and long-context baselines on the same tasks, but maintain access checks and answer evaluation under either representation. Context capacity is not a correctness guarantee.' },
      { question: 'Can fine-tuning replace the retrieval index?', answer: 'Fine-tuning may improve a stable response format or domain behavior, but daily policy updates and per-user access revocation require a data path that can change without retraining. Weight updates do not provide a reliable source citation or permission boundary. Keep changing facts in authorized versioned retrieval and test adaptation only against an error category that the prompt and retrieval baseline do not adequately address.' },
      { question: 'What happens if an index replica is five minutes stale?', answer: 'The stated content-freshness budget permits some old document text only when the accepted source-version policy allows it; it does not permit stale authorization. Recheck access before evidence leaves the trusted boundary and withhold deleted or disallowed versions. Measure index lag and show source versions. If the source requires immediate content correction, that requirement needs a stricter version check or temporary suppression rather than silently using the normal five-minute budget.' },
    ],
    lessonIds: ['llm-foundations', 'rag-retrieval', 'llm-evaluation', 'ai-safety', 'model-adaptation'],
    sourceIds: ['azure-hybrid-ranking', 'owasp-object-auth', 'llm-evals', 'owasp-prompt-injection'],
  },
  {
    problemId: 'ai-support-agent',
    summary: 'A durable application-owned state machine lets the model propose actions while authorization, approval, and external receipts establish what actually happened.',
    assumptions: [
      'Hypothetical workload: 12,000 tickets per day; 30% require a proposed account change and a human decision.',
      'Allow at most six model turns and eight tool attempts per task, with a two-minute automated deadline excluding an explicit human waiting state.',
      'Illustrative model-turn cost ceiling is USD 0.004; tool charges and staff time are excluded from the arithmetic.',
      'The subscription provider supports a stable operation key and status lookup. If an outcome cannot be established, the task remains unknown and is escalated.',
    ],
    diagram: `Ticket -> authenticated intake -> durable task
                                  |
                     retrieve -> draft -> action proposal
                                             |
                                      human approval
                                             |
                          policy + resource version check
                                             |
                    durable intent -> bounded tool executor
                                             |
                       provider receipt / status reconciliation
                                             |
                               confirmed result or escalation`,
    calculations: [
      { label: 'Daily proposed account changes', factors: [12000, 0.3], divisor: 1, result: 3600, unit: 'proposals/day', assumption: 'Thirty percent is a scenario assumption, not an observed automation rate.' },
      { label: 'Maximum daily model-turn cost under the scenario cap', factors: [12000, 6, 0.004], divisor: 1, result: 288, unit: 'USD/day', assumption: 'Every ticket consumes all six turns at the stated ceiling; excludes tool, storage, and human costs.' },
    ],
    sections: [
      { title: 'Use a workflow until variable planning is justified', body: `The predictable path classifies a ticket, retrieves authorized support material, drafts a response, and optionally proposes an account change. Begin with explicit application routing for these steps. Add model-selected investigation only if task diversity produces measured failures in the fixed workflow. Read-only answers can finish without entering the write path, reducing both authority and operational complexity.

Specify terminal outcomes: answered with evidence, action confirmed, declined, canceled, escalated, and unknown external outcome. The assistant cannot mark a provider action successful because it generated a reassuring sentence. Persist authoritative receipts and use them to build the final response. A human waiting period pauses only the budget explicitly defined as automated elapsed time, not every resource limit.` },
      { title: 'Give tools narrow contracts and no ambient identity', body: `Define separate tools for reading the caller's account, retrieving policy, and proposing a plan change. A write executor validates the canonical parameters and derives the acting user and support permissions from the server-owned task. It must verify resource ownership, current account status, allowable transitions, and price rules. Model arguments cannot select a different acting user or bypass policy.

Use bounded result schemas and expose only fields necessary for the task. Secrets and unrestricted provider credentials remain in the executor, not in prompt context. A malicious ticket or source article might ask the model to export records, but the available capabilities and destination policy prevent such an action even if the model proposes it. Tool-description standards do not supply these checks automatically.` },
      { title: 'Approve an immutable, inspectable proposal', body: `Store proposal ID, task ID, target resource, expected version, exact new plan and price, material consequences, and expiry. Present those facts to an authorized approver. Approval records the canonical proposal fingerprint and actor, rather than a broad "yes" attached to a conversation. A different plan, amount, or target invalidates the previous approval.

Immediately before dispatch, recheck current authorization and the resource version. A concurrent human account edit can make the approved proposal stale. Return to review rather than silently applying the old instruction to the new state. Persist cancellation and approval expiry as real states so a delayed worker cannot revive obsolete authority. Approval limits risk but never grants capabilities that the approver did not possess.` },
      { title: 'Recover the provider boundary without inventing certainty', body: `Commit an operation record and dispatch intent before making the provider call. Use a stable key bound to the approved parameters and compatible provider API. Once dispatch begins, record the attempt and distinguish a verified rejection from a timeout. A timeout after send is unknown, not a confirmed failure eligible for a new logical operation.

On worker recovery, query the provider using its stable identity, reconcile any receipt, and replay only when its documented idempotency contract permits it. If the provider cannot resolve the outcome, keep it unknown and escalate rather than guessing from account display text. Finalizing the local confirmed receipt, task state, and next durable work should share one business transaction. External I/O stays outside that transaction.` },
      { title: 'Bound progress and retain only useful memory', body: `Before every model turn or tool attempt, check remaining steps, tokens, deadline, and reserved cost. Concurrency must not let two workers spend the same remaining budget or dispatch the same approved intent. Use transactional ownership or a correctly fenced execution mechanism. A lease alone does not stop a delayed worker unless the authoritative boundary rejects its obsolete attempt.

Repeated identical validation failures lead to a clarification or escalation, not an infinite self-correction loop. Store compact checkpoints with evidence IDs, current proposal, and confirmed operations. Conversation summaries are helpful context but not authority over resource state. Apply retention and access rules to transcripts, approvals, and provider receipts according to their different purposes; do not retain every prompt indefinitely for convenience.` },
      { title: 'Test the action history under failures', body: `Create deterministic tool fixtures for rejection before send, timeout after a completed provider write, duplicate delivery, worker restart, stale approval, and concurrent resource edits. Assert the actual external-operation count and final business state, not just a successful final message. Check that the task stops or escalates within budgets and that no unauthorized intermediate read occurred.

Measure support resolution quality, confirmed change rate, escalation reasons, duplicate-effect incidents, unknown-outcome age, model cost, and review wait. A higher automation rate is not automatically better when sensitive changes should remain human-controlled. Start in read-only shadow mode with external writes technically disabled, then enable a small approved action set. Rollback should stop new dispatches while preserving reconciliation of operations already sent.` },
    ],
    followUps: [
      { question: 'Why not retry with a new provider key after a timeout?', answer: 'The first attempt may already have changed the subscription. A new key represents a different logical operation and can create another effect. Reuse the original identity under the provider contract and recover authoritative status. If status is unavailable, keep the outcome unknown, reserve any unresolved usage appropriately, and escalate. Returning a confident failure and asking the user to repeat the action does not solve the ambiguity.' },
      { question: 'Can the user interrupt a voice agent while it is changing a plan?', answer: 'Interrupting playback or model generation should stop obsolete audio and future planning, but it cannot undo a dispatched provider operation. Keep audio-turn state separate from durable business-operation state. Cancel undispatched intents when allowed, reconcile already dispatched ones, and communicate the confirmed or unknown result. Late audio packets must carry a generation identity so the old response cannot resume after the new turn starts.' },
      { question: 'What makes the system an agent rather than a workflow?', answer: 'The distinction concerns who chooses the next path. A fixed classify-retrieve-draft-review sequence is a workflow even if several steps use a model. If the model chooses additional evidence gathering or tools dynamically within permitted capabilities, that portion is agentic. Neither label changes the need for authorization, approval, bounded resources, durable intent, and evaluation. Prefer the simpler arrangement that meets the measured task requirements.' },
    ],
    lessonIds: ['agent-workflows', 'ai-safety', 'llm-evaluation', 'multimodal-systems'],
    sourceIds: ['effective-agents', 'stripe-idempotency', 'outbox', 'owasp-prompt-injection'],
  },
  {
    problemId: 'ai-inference-gateway',
    summary: 'A gateway coordinates bounded reservations, compatible routing, and truthful attempt states while the serving pool is sized for actual token distributions.',
    assumptions: [
      'Hypothetical self-hosted decoder: 24 layers, 8 KV heads, head dimension 128, two-byte KV elements, maximum retained sequence length 8,192 tokens.',
      'Use a dense 8-billion-parameter two-byte-weight model only for arithmetic; no specific model, hardware throughput, or fit is claimed.',
      'Admitted requests target p95 first-token latency under 1.5 seconds and p95 full completion under 12 seconds for a separately fixed evaluation workload.',
      'Each request has a bounded output allowance. Routes must preserve tenant data policy and required model capabilities; interrupted streams are visibly incomplete.',
    ],
    diagram: `Tenant -> identity + request key -> atomic budget reservation
                                             |
                                  deadline-aware admission
                                             |
                               policy-compatible router
                                  /                 \\
                     managed provider           serving pool
                                               prefill/decode
                                  \\                 /
                                   versioned attempt
                                          |
                        bounded stream -> receipt + usage settlement
                                          |
                                 metrics without raw prompts`,
    calculations: [
      { label: 'KV state for one full-length sequence', factors: [2, 24, 8, 128, 8192, 2], divisor: 1073741824, result: 0.75, unit: 'GiB', assumption: 'Uniform full-context layout; no sliding window, compression, allocator overhead, or weights.' },
      { label: 'KV state for sixteen full-length sequences', factors: [2, 24, 8, 128, 8192, 2, 16], divisor: 1073741824, result: 12, unit: 'GiB', assumption: 'All sixteen sequences retain the maximum context simultaneously.' },
      { label: 'Logical model-weight payload', factors: [8000000000, 2], divisor: 1000000000, result: 16, unit: 'GB', assumption: 'Decimal GB for weights alone; do not add this numerically to GiB without conversion.' },
    ],
    sections: [
      { title: 'Define a route contract before provider abstraction', body: `A route describes the task, permitted data destinations, model and tokenizer revisions, output schema, supported tools, and operational budgets. Two providers with a similar API are not necessarily interchangeable. Their context behavior, tool semantics, retention policies, and output quality can differ. Begin with one measured route and add alternatives only when the product needs them.

POST /generations uses an authenticated tenant, stable request key, route revision, bounded input, and output ceiling. A repeated compatible request key returns the existing attempt or result; a conflicting payload is rejected. Define whether a retry starts a new billed attempt. A gateway cannot promise provider-level exactly-once processing unless the downstream contract actually supports it.` },
      { title: 'Reserve budget and admission atomically', body: `Estimate or count input tokens with the selected tokenizer and reserve the allowed output cost under the route's pricing revision. Concurrent requests must not all observe the same remaining tenant budget and then overspend it. Use an authoritative transactional reservation and a bounded global admission mechanism. Separate queued, admitted, dispatched, completed, failed, canceled, and unknown states.

Queue deadlines include time already spent waiting. Reject expired work before it reaches an expensive provider or serving pool. Fair scheduling prevents one tenant's long prompts from monopolizing the queue. Reconcile reservations with actual usage when reliable receipts arrive. A timeout after dispatch may still incur cost; keep unresolved liability explicit rather than releasing every reservation as though nothing happened.` },
      { title: 'Size the pool with units and workload distributions', body: `Calculate weights and KV state separately and convert decimal GB and binary GiB consistently. The illustrative sixteen-sequence KV payload is 12 GiB before weights and other buffers. Actual peak memory includes activations, allocator behavior, graph captures where used, and serving headroom. Sequence length distribution and active concurrency matter more than a single advertised maximum-context number.

Benchmark prompt-length and output-length buckets under realistic arrival bursts. Record first-token latency, inter-token latency, successful completions, throughput, and preemption. A smaller batch may improve one latency target while reducing aggregate throughput. Capacity conclusions must identify model, hardware, precision, kernels, runtime version, and workload, not just a device name or parameter count.` },
      { title: 'Optimize the observed bottleneck', body: `If prefill dominates, reduce unnecessary context, investigate compatible prefix reuse, and evaluate chunked prefill scheduling. If decode is constrained, inspect active batch shape, memory pressure, and supported precision choices. Paged KV allocation improves memory management but does not erase the state needed by retained tokens. Recomputing preempted sequences can make tails much worse even while the service remains technically available.

Quantization and speculative decoding require task-quality and workload validation. Do not copy a benchmark speedup from unrelated hardware or a different acceptance rate. Managed inference can be cheaper at low utilization despite a higher apparent per-token price. Compare total operational cost, reliability, privacy, and staffing before introducing a self-hosted pool into the critical path.` },
      { title: 'Keep caches and fallback semantically compatible', body: `A prefix cache key must capture the compatible model, tokenizer, template, and exact prefix. Isolation rules must prevent sensitive cross-tenant reuse. An answer cache additionally depends on task semantics, evidence freshness, and access scope. It is not interchangeable with a KV computation cache. Version configuration changes so old artifacts cannot be reused under a newly incompatible route.

Before first output, a compatible fallback may be attempted if budget and deadline permit and the first attempt's side effects are understood. After output is streamed, do not silently splice a second model's continuation into the same response. Mark the attempt incomplete and expose an explicit restart contract. Tool-bearing generations need durable operation recovery separately from text-generation retries.` },
      { title: 'Observe and roll back without hiding failures', body: `Emit request and attempt identities, route revision, stage timings, token counts, admission decisions, and error categories. Keep raw prompts and generated sensitive text out of default telemetry. Use access-controlled sampling only when necessary to diagnose a defined failure. Treat provider-reported usage and local estimates as different evidence, and reconcile discrepancies rather than silently normalizing them away.

Canary new routing, runtime, or precision configurations against a fixed workload and quality set. Include long-context bursts, tenant fairness, canceled streams, disconnects, and provider ambiguity. Rollback changes routing for new attempts while preserving settlement for in-flight work. An increased tokens-per-second chart does not justify a release if user-visible latency, correctness, or privacy regressed.` },
    ],
    followUps: [
      { question: 'Can the stage p95 latencies simply be added to produce the end-to-end p95?', answer: 'No. Stage latency distributions can be correlated, and some stages overlap. The p95 of a sum is not generally the sum of the p95 values. Trace individual requests over a clearly defined client or server boundary and compute the end-to-end distribution directly. Stage percentiles remain diagnostic, while a sequential arithmetic budget is only a planning assumption, not an observed service percentile.' },
      { question: 'Why retain an unknown attempt instead of immediately refunding every timeout?', answer: 'The provider may have processed input or generated tokens before its response was lost. Immediate release can let repeated ambiguous attempts evade budgets and understate cost. Persist dispatch and the unresolved reservation, recover receipts or status when available, and use a documented reconciliation or expiry policy. The interface should distinguish an incomplete user response from the separate question of whether provider usage occurred.' },
      { question: 'Would one lower-precision model automatically solve overload?', answer: 'Lower precision may reduce weights or improve supported kernels, but its benefit depends on hardware and runtime support and may not reduce KV state equally. Overload can still arise from queueing, long contexts, slow tools, or unbounded admission. Validate quality and actual stage timing, then combine any measured model optimization with explicit budgets, fairness, deadlines, and concurrency limits. Faster execution does not establish safe resource ownership.' },
    ],
    lessonIds: ['llm-foundations', 'inference-serving', 'llm-evaluation', 'ai-safety'],
    sourceIds: ['vllm-optimization', 'torch-attention', 'sre-overload', 'sre-monitoring'],
  },
  {
    problemId: 'ai-document-review',
    summary: 'Immutable evidence and versioned proposals separate probabilistic extraction from the approved business record.',
    assumptions: [
      'Hypothetical workload: 18,000 documents per day, averaging six pages; page count and file size are bounded at admission.',
      'A fourfold daily-average arrival burst is used for planning, not as a measured peak forecast.',
      'The illustrative layout-processing charge is USD 0.0015 per page, excluding generation, storage, review labor, and taxes.',
      'The system proposes invoice records but never automatically initiates payment. Missing, conflicting, or critical unsupported fields require review.',
    ],
    diagram: `Upload -> object version + job intent -> bounded worker queue
                                            |
                                  layout / OCR extraction
                                            |
                              schema proposal + evidence spans
                                            |
                                 deterministic validation
                                      /           \\
                              review needed     eligible proposal
                                      \\           /
                              authorized revision-bound approval
                                            |
                                approved record + audit receipt`,
    calculations: [
      { label: 'Daily page volume', factors: [18000, 6], divisor: 1, result: 108000, unit: 'pages/day', assumption: 'Six pages is a hypothetical average; use the distribution to plan worker memory.' },
      { label: 'Planning burst arrival rate', factors: [18000, 6, 4], divisor: 86400, result: 5, unit: 'pages/second', assumption: 'Four times the full-day mean arrival rate; processing time per page still needs measurement.' },
      { label: 'Illustrative daily layout charge', factors: [18000, 6, 0.0015], divisor: 1, result: 162, unit: 'USD/day', assumption: 'Scenario price, not a vendor quote; excludes all non-layout charges.' },
    ],
    sections: [
      { title: 'Accept evidence with a stable identity', body: `Authenticate the uploader, validate tenant access, and bound file size, page count, media type, and processing resources. Use the deployment's reviewed file-handling boundary for untrusted documents. A filename extension is not enough validation. Persist a source object version, content checksum, metadata, and processing intent before returning durable acceptance. An accepted upload is not a completed extraction.

Deduplicate compatible client retries using a stable request identity. Content equality does not necessarily mean two business invoices are the same; the same scan may be attached to different authorized workflows. Separate upload identity, source version, processing attempt, and proposed business-record identity. This prevents a retry optimization from accidentally merging distinct ownership or accounting contexts.` },
      { title: 'Preserve layout before asking for fields', body: `Extract text, geometric regions, page structure, tables, and header relationships. Keep bounding regions and source coordinates so a reviewer can inspect the evidence behind a value. Flattening every table into a plain paragraph can attach the wrong unit price to a quantity or confuse a subtotal with the amount due. Rotated scans and multi-column pages deserve explicit evaluation slices.

Use native text when reliable, layout analysis where structure matters, and selected image regions when a visual interpretation is needed. Compare quality and cost before sending every page to a large multimodal model. Store derivation versions so a new OCR or layout configuration creates a new extraction rather than silently changing the meaning of an old approved record.` },
      { title: 'Represent absence instead of fabricating completeness', body: `The extraction schema includes field value, normalized representation where appropriate, evidence locations, and status such as present, missing, or conflicting. Distinguish an absent currency from a recognized currency and an impossible date from an unreadable one. Never require a numeric guess merely to satisfy a non-null field in the proposed schema.

Run deterministic checks for numeric ranges, currency consistency, date relationships, tax arithmetic, and line-total agreement. Define currency-specific units and rounding before comparing totals. Duplicate invoice detection uses reviewed business rules and evidence, not only embedding similarity. The model's confidence may help triage only after calibration; it does not authorize publication or override a contradictory source span.` },
      { title: 'Make correction and approval revision-aware', body: `An authorized reviewer sees the source region, proposed value, validation results, and meaningful consequences. Store corrections as versioned observations with the original value, corrected value, actor, and reason. Bind approval to the source version and exact proposal revision. If another process reruns extraction or a reviewer changes a critical field, an old approval must not publish the new payload.

Publish the approved business record and an audit receipt atomically, using a stable operation identity to recover duplicate requests. This pipeline does not initiate payment, so there is no need to grant it bank-write credentials. If a future product adds payment, that is a separate explicitly approved capability with its own authorization and ambiguous-external-outcome handling.` },
      { title: 'Bound asynchronous work and make retries inspectable', body: `A job records source version, layout revision, prompt or model revision, and attempt state. Workers acquire bounded ownership and write results conditionally against the expected processing revision. Old attempts cannot overwrite newer proposals. Retries preserve the logical extraction identity, while a deliberate reprocess creates an explicit new revision. A crash after saving results must not cause duplicate published records.

Track queued, running, review-needed, failed, and approved states independently. Apply retry limits and a visible failure path for malformed documents or persistent provider errors. Oldest-job age and review age expose user delay better than queue length alone. Admission limits should prevent one tenant's huge batch from starving ordinary uploads. Usage receipts and unknown provider cost remain separate from extraction correctness.` },
      { title: 'Evaluate the fields and downstream decisions', body: `Build a held-out set with expert field labels and evidence spans, including missing pages, scan noise, multiple currencies, credit notes, table splits, and contradictory totals. Report exact or normalized match by field, unsupported-value rate, correction effort, critical-field errors, and successful review outcomes. A correct summary of the document does not compensate for the wrong amount due.

Monitor backlog, time to review, cost per approved record, repeat processing, and privacy-policy compliance. Keep sensitive source documents out of general logs and use synthetic fixtures for routine debugging. Define retention across originals, derived text, embeddings if used, prompts, reviewer exports, and audit records. Document which legal or business obligations require retention instead of assuming one global deletion policy fits every copy.` },
    ],
    followUps: [
      { question: 'Why is valid JSON not enough to publish an invoice?', answer: 'JSON validity establishes syntax and perhaps types, not that the values came from the correct source or satisfy business rules. An absent amount can still be represented by a fabricated valid number. Require evidence provenance, deterministic constraints, and the configured review policy before publication. Keep the probabilistic proposal separate from the approved record so corrections and disputes can be traced without rewriting history.' },
      { question: 'How should a later model improvement affect previously approved records?', answer: 'Treat it as a new processing revision, not a silent rewrite. Evaluate the new model on a holdout, optionally generate a comparison proposal, and route material differences through the appropriate review contract. Previously approved records retain their source and derivation provenance. If a critical error requires correction, publish an explicit audited correction under current authorization rather than pretending the original system produced the new value.' },
      { question: 'Could a voice interface safely collect a reviewer correction?', answer: 'It can propose a correction, but speech recognition errors can change digits, currencies, or negation. Show the interpreted field and evidence and require the same authenticated revision-bound approval as a typed edit. Speaker clustering is not identity verification. If the user interrupts, discard obsolete audio and proposals by turn identity while preserving any business record that already committed. Measure critical-field errors rather than relying only on average word error rate.' },
    ],
    lessonIds: ['multimodal-systems', 'llm-evaluation', 'model-adaptation', 'ai-safety'],
    sourceIds: ['document-layout', 'llm-evals', 'outbox', 'owasp-prompt-injection'],
  },
];
