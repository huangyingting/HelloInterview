import type { LearningFlow, Lesson } from '../types';

function reading(content: Omit<Lesson, 'minutes'>): Lesson {
  const text = content.sections.flatMap(section => [section.body, ...(section.bullets ?? [])]).join(' ');
  return { ...content, minutes: Math.max(3, Math.ceil(text.trim().split(/\s+/).length / 200)) };
}
function flow(title: string, summary: string, steps: [string, string][]): LearningFlow {
  return { title, summary, steps: steps.map(([title, detail], index) => ({ id: `step-${index + 1}`, title, detail })) };
}

export const dojoLessons: Lesson[] = [
  reading({
    id: 'attention-mechanics', title: 'Read an attention map without overclaiming', group: 'Model behavior lab',
    summary: 'Trace causal masking and normalized attention, then separate a useful calculation from a causal explanation of model behavior.',
    objectives: ['Calculate a causal attention row with the mask applied first.', 'Explain the roles and dimensions of Q, K, and V.', 'Recognize the limits of attention visualizations and efficient kernels.'],
    quizTopic: 'attention-mechanics', relatedProblemIds: ['ai-knowledge-assistant'],
    sourceIds: ['dojo-topic-map', 'torch-attention', 'llm-evals'],
    sections: [
      { title: 'Turn the model-foundations topic into a test', body: `The local LLM Dojo curriculum separates model foundations into attention, sampling, and context. This independent Studio course uses that topic map to choose a small set of inspectable mechanisms. No captured pages, proprietary lesson text, diagrams, or compiled components are imported. The diagrams here are original, and their invented values are not measurements from a trained model. Primary documentation supplies the operational definitions.

Start with a falsifiable question: can a later token affect an earlier output in a causal attention layer? Choose a four-position sequence and change only a future key or value. The earlier output must remain unchanged. A picture of a triangle is a useful reminder, but a tested behavioral invariant is stronger evidence than its appearance.` },
      { title: 'Follow the computation and its dimensions', body: `For one head, a sequence representation is projected into queries Q, keys K, and values V. If queries and keys have width d_k, their matrix product produces one score for every query-key pair. Divide those scores by the square root of d_k before applying the mask and row-wise softmax. Multiplying the normalized matrix by V gives a weighted mixture of value vectors for each query position.

The explorer begins with already scaled synthetic scores so that the mask and normalization remain visible. It does not implement tokenization, learned projections, residual connections, positional encoding, or a whole transformer. The selected query highlights a row, not a special privileged token. Keep those omissions explicit when explaining what the exercise demonstrates.`, flow: flow('A causal attention pass', 'Data flows through four distinct operations; select a step to inspect its responsibility.', [
        ['Project Q/K/V', 'Learned projections create queries, keys, and values from representations. Equal sequence lengths do not mean their feature widths are all identical.'],
        ['Score and scale', 'Compute QK-transpose and divide by sqrt(d_k). The explorer starts after this step with invented scaled scores.'],
        ['Mask then normalize', 'Exclude future positions before softmax. Each visible row assigns total mass one only to allowed keys.'],
        ['Mix values', 'Multiply by V to form an output representation; the diagram does not model later layers or predict a factual answer.'],
      ]) },
      { title: 'Exclude a position rather than merely reducing its score', body: `A causal query at position i can use keys at positions zero through i. A forbidden position receives zero probability, conventionally by adding negative infinity to its logit before normalization. Setting its score to zero is not the same operation: exp(0) is positive, so forbidden content would still contribute. Mask conventions vary by API; confirm whether true means allowed or blocked in the function you actually call.

The first row must assign all its mass to the first key. Every later row must sum to one across the visible prefix. Changing a masked score must not change that row's visible distribution. These are independent assertions for a test suite, and they remain useful when the implementation switches from a simple matrix calculation to a fused kernel.`, visualization: 'attention' },
      { title: 'Do not confuse a heatmap with an explanation', body: `A large attention weight describes a particular weighted mixture inside a particular head. It does not prove that a token caused the final answer, that the model understood a concept, or that retrieved evidence is true. Other heads, residual paths, value contents, and later layers also influence the result. Comparing a colorful cell across models without those details is especially misleading.

Use controlled interventions and task evaluation to investigate behavior. Keep the source question and expected invariant alongside the visualization. If the assistant cites an obsolete policy, an attention map alone cannot tell you whether ingestion, retrieval, context ordering, or generation caused the failure. Check which evidence actually reached the model before interpreting a model-internal diagnostic.` },
      { title: 'Distinguish memory-efficient attention from linear work', body: `A straightforward dense attention score matrix has quadratic size in sequence length. Efficient exact-attention kernels can avoid materializing that entire matrix and reduce memory traffic. That improvement does not mean dense attention universally performs only linear arithmetic as sequence length grows. Windowed or otherwise restricted attention changes a different part of the computational contract.

For an interview, state the model and kernel assumptions before giving a complexity claim. For a product, benchmark the context distribution and hardware that will actually be used. The local explorer deliberately stays tiny and exact; it is a teaching device, not a throughput benchmark. Its useful outcome is a precise explanation of normalization, causality, and the limits of the evidence a visualization provides.` },
    ],
    exercise: 'Change the self-attention score, inspect every row sum, and explain why masked cells remain zero. Sketch a future-value intervention test for a real attention implementation.',
  }),
  reading({
    id: 'decoding-controls', title: 'Change decoding without inventing confidence', group: 'Model behavior lab',
    summary: 'Inspect temperature, top-k, and top-p as distribution transforms rather than truth or permission controls.',
    objectives: ['Normalize logits stably after temperature scaling.', 'Specify the ordering of top-k and nucleus filtering.', 'Separate decoding variability from factual quality and reproducibility.'],
    quizTopic: 'decoding-controls', relatedProblemIds: ['ai-inference-gateway'],
    sourceIds: ['dojo-topic-map', 'hf-generation', 'llm-evals'],
    sections: [
      { title: 'Start with a distribution, not a sentence', body: `An autoregressive decoder produces one score per vocabulary token at the current step. A score is not yet a probability. Softmax exponentiates scaled scores and divides by their sum. Subtracting the largest score before exponentiation preserves the result while avoiding overflow. The lab uses five invented action-like labels so that every candidate stays visible; those labels do not grant permission to execute the named action.

A production vocabulary is much larger, and its next-token distribution depends on the entire current context and model state. After one token is chosen, the next distribution changes. This lab is a single-step calculation rather than a text generator. It deliberately does not contact a provider, download weights, or pretend to simulate an entire conversation.` },
      { title: 'Temperature changes relative preference', body: `With positive temperature T, use softmax(logits divided by T). Smaller temperatures sharpen relative probabilities around higher scores. Larger temperatures flatten them. Neither operation inserts missing evidence or validates a claim. A strongly preferred continuation can still be false, unauthorized, or inappropriate for the task. Greedy selection is a separate choice of a maximum-scoring token, not a finite-temperature sampling guarantee.

The control begins above zero because division by zero is undefined. Frameworks often expose a separate greedy mode rather than accepting zero temperature literally. Ties need an explicit policy when deterministic selection matters. Reproducibility also depends on the model revision, kernels, request context, and random-number handling, so a seed or low temperature alone is not a durable cross-provider output contract.`, visualization: 'sampling' },
      { title: 'Declare how filters compose', body: `Top-k keeps a fixed number of highest-probability candidates. Nucleus or top-p filtering keeps the smallest ranked prefix whose cumulative mass reaches a threshold. The lab first scales temperature, then applies top-k, renormalizes that shortlist, and applies top-p within it. Finally it renormalizes the surviving probabilities. Equal scores use the original token order to make the displayed result stable.

This order is part of the exercise, not a universal claim about every inference engine. A threshold of one keeps the whole top-k shortlist; a very small threshold still retains its most probable candidate. Setting k to one leaves exactly one candidate regardless of the positive temperature. Verify the provider or library's actual transform ordering before comparing configurations from two implementations.`, flow: flow('One decoding decision', 'Filtering changes which continuations are sampled, not which statements are true.', [
        ['Scale logits', 'Divide the invented logits by a positive temperature and normalize using a stable softmax.'],
        ['Keep top k', 'Sort by probability with a stable tie policy, retain k candidates, then renormalize.'],
        ['Keep top p', 'Keep the shortest prefix reaching the requested mass within the top-k distribution.'],
        ['Sample or select', 'The lab displays the final distribution only. No model call or business action is executed.'],
      ]) },
      { title: 'Measure the task after changing settings', body: `For structured extraction, useful outcomes include supported field values, appropriate abstention, and correct refusal handling. For brainstorming, diversity may be valuable. Evaluate the settings against that task rather than assuming one temperature is universally best. A more concentrated probability distribution is not a calibrated probability that the resulting answer is correct.

Run repeated trials when sampling introduces variance, and compare the same versioned cases across candidates. Preserve prompt, model, decoding settings, and source evidence in the experiment record under an appropriate privacy policy. Deterministic validators should still check schemas, resource ownership, and numeric constraints. Sampling parameters operate at the decoder boundary; they do not replace application checks or a release gate.` },
      { title: 'Budget for length and incomplete responses', body: `Output length controls interact with latency and cost. A maximum-new-token limit caps additional generation, while a total-length limit may also include the input depending on the interface. A stopped response can be incomplete even when its visible prefix looks plausible. Check the finish reason and structured-output status before treating generated text as an accepted result.

Retries can cost more than selecting a slightly larger model once. Define a bounded correction policy and count failures in cost per useful answer. Do not repeatedly resample until an unsafe proposal happens to satisfy a shallow string check. The distribution diagram teaches probability bookkeeping; a production workflow still needs evidence, explicit terminal states, and independent authority to decide what may be committed.` },
    ],
    exercise: 'Set top-k to one, then vary temperature and explain the unchanged final shortlist. Compare that observation with a factuality claim the experiment cannot establish.',
  }),
  reading({
    id: 'kv-capacity', title: 'Account for KV memory before admitting work', group: 'Inference economics lab',
    summary: 'Calculate full-attention cache size with explicit units and identify the memory costs the estimate leaves out.',
    objectives: ['Derive KV bytes from layers, heads, width, tokens, and concurrency.', 'Separate weights, KV state, and allocation overhead.', 'Explain when cache layout and attention architecture change the estimate.'],
    quizTopic: 'kv-capacity', relatedProblemIds: ['ai-inference-gateway'],
    sourceIds: ['dojo-topic-map', 'hf-kv-cache', 'vllm-optimization'],
    sections: [
      { title: 'Name the resource being reserved', body: `During autoregressive generation, earlier keys and values can be reused instead of recomputed from scratch. That state belongs to active sequences and grows with the tokens retained for their attention layers. It is distinct from the model weights, temporary activations, runtime workspaces, and the allocator's own bookkeeping. A model's parameter count therefore cannot establish how many long requests a device can serve concurrently.

Before admitting work, estimate the cache under the actual model architecture and reserve capacity for the request's growth. Output tokens can extend the cached sequence beyond its input length. Keep a deliberate policy for output limits, active concurrency, queued work, and cancellation. An unbounded queue does not solve a cache shortage; it moves the failure into latency and saturation.` },
      { title: 'Derive bytes and report the unit', body: `For uniform dense full-attention layers, a simple estimate is two times layers times KV heads times head dimension times cached tokens times active sequences times bytes per element. The factor two accounts for keys and values. Query-head count is not necessarily KV-head count: grouped-query attention can share fewer KV heads among more query heads.

The calculator fixes thirty-two layers and a head dimension of 128 so you can vary one assumption at a time. With eight KV heads, 4096 tokens, one sequence, and two-byte elements, the result is 536870912 bytes, or 512 MiB, or 0.5 GiB. Binary GiB divides by 2^30; decimal GB divides by one billion. Mixing those units can turn a seemingly safe capacity statement into an inaccurate one.`, visualization: 'kv-cache' },
      { title: 'Explain what changes the shape', body: `A dynamic cache grows as generation proceeds. A static cache can allocate for a larger maximum shape so compiled execution can reuse a stable layout, trading capacity for predictable shapes. Sliding-window or chunked attention can bound some layers' retained history instead of making every layer scale with the whole sequence. Hybrid architectures therefore need a per-layer accounting model rather than one universal multiplier.

Quantizing cached elements can reduce payload bytes but may introduce scales, metadata, conversion work, and quality or latency tradeoffs. The lab's bytes-per-element control changes only the payload estimate. It is not a complete quantization cost model, and it does not claim that all cache strategies are interchangeable for every architecture. Check implementation support and measure the specific workload.`, flow: flow('A serving memory decision', 'The cache estimate is one input to admission, not a guarantee that the request fits.', [
        ['Read architecture', 'Obtain actual layer count, KV-head count, head dimension, cache precision, and attention layout.'],
        ['Estimate growth', 'Include retained input and expected output under the model-specific cache strategy.'],
        ['Reserve capacity', 'Account separately for weights, runtime overhead, and in-flight requests before admitting work.'],
        ['Measure and revise', 'Observe allocation, preemption, latency, and failures; replace estimates with validated operating limits.'],
      ]) },
      { title: 'Sharing and paging are conditional savings', body: `A paged implementation can improve allocation efficiency and avoid reserving one contiguous worst-case block for every sequence. Prefix caching can share compatible repeated work. Neither mechanism means that all sequences become free or that every byte calculated by the formula disappears. Fragmentation, reference counts, and cache eviction still matter, and sharing depends on exact compatibility requirements.

Consider model revision, token identity, relevant adapters, and isolation policy before reusing a prefix. A cache key must not let one tenant recover another tenant's sensitive content or infer it through an unintended boundary. Likewise, an answer cache is a different object with different authorization and freshness requirements. State which kind of cache a proposed optimization actually changes before claiming a benefit.` },
      { title: 'Use measurements to choose the operating envelope', body: `Benchmark mixed input lengths, output lengths, and concurrency rather than only short requests. Observe peak allocation, request latency, cache preemptions, and out-of-memory failures. Reserve safety margin for workload drift and runtime changes. Lower cache precision may shift the bottleneck to compute or kernel overhead, so reduced bytes alone do not establish improved goodput.

The local calculator is exact arithmetic for a simplified payload model, not a GPU simulator. It cannot certify a device fit or an availability target. Its role is to expose the assumptions that must be checked. A defensible serving plan combines the accounting model with repeatable load tests, bounded admission, visible rejection reasons, and a rollback path when a new configuration performs worse.` },
    ],
    exercise: 'Double cached tokens and concurrency separately. Explain the linear effects on payload bytes, then list four real allocation costs not included in the calculator.',
  }),
  reading({
    id: 'streaming-service-levels', title: 'Measure the first token and the useful finish', group: 'Inference economics lab',
    summary: 'Trace a request timeline and distinguish first-token latency, completion latency, throughput, and quality-qualified goodput.',
    objectives: ['Calculate first-token and final-token timing without an off-by-one interval.', 'Define latency boundaries before comparing measurements.', 'Evaluate throughput together with quality, deadlines, and useful outcomes.'],
    quizTopic: 'streaming-service-levels', relatedProblemIds: ['ai-inference-gateway'],
    sourceIds: ['dojo-topic-map', 'sre-slos', 'vllm-optimization'],
    sections: [
      { title: 'Choose the clock at the product boundary', body: `A user waits for a usable result, not an internal GPU event. Define whether timing begins at the browser, service ingress, queue admission, or model execution. State whether it ends at the first visible token, the final generated token, validated structured output, or a confirmed business result. Comparing two systems with different boundaries produces a persuasive but misleading performance chart.

Use a monotonic clock for elapsed intervals within one process. Cross-machine timestamps need synchronization assumptions and a tracing strategy. Include failed and canceled requests in the measurement policy rather than dropping slow failures from a successful-only chart. A system can stream text quickly yet fail to complete the task, so timing is only part of the product contract.` },
      { title: 'Separate initial work from incremental generation', body: `Queueing and prompt processing usually contribute to first-token latency. Subsequent autoregressive tokens arrive over additional decode intervals. The lab defines prefill to include producing the first token; with n output tokens, only n minus one further intervals are added. For one output token, final-token time equals first-token time. That boundary convention prevents double-counting the initial token.

With 100 milliseconds queued, 400 milliseconds of prefill, fifty output tokens, and forty milliseconds per later token, first-token time is 500 milliseconds and completion is 2460 milliseconds. These are invented constant intervals, not a benchmark. Real token intervals vary, and network delivery or rendering may batch several tokens into one visible update. Read the definition before comparing this estimate with a provider metric.`, visualization: 'streaming' },
      { title: 'Distinguish aggregate throughput from individual experience', body: `A server can increase total tokens per second by batching more work while making each request wait longer. Aggregate throughput and per-request latency answer different questions. Measure the distribution of first-token latency, time between visible updates, and completion latency under representative concurrency. Queue time often dominates as utilization approaches a saturated operating point.

Goodput counts work that meets the declared usefulness and service targets. A syntactically complete but factually unsupported answer should not count as a useful success merely because it met a deadline. The timeline lab reports only whether its simplified completion latency meets one threshold; it does not compute production goodput. Build the full metric from outcome quality, arrival population, and explicit timing rules.`, flow: flow('A user-visible inference request', 'Each boundary needs a timestamp and an outcome definition.', [
        ['Accept or reject', 'Validate the request and budget; rejection is observable rather than silently queued forever.'],
        ['Queue and prefill', 'Wait for capacity, process the prompt, and produce the first token under the lab convention.'],
        ['Stream decode', 'Produce later tokens. Their intervals and the transport delivery pattern can vary independently.'],
        ['Validate finish', 'Check completion, refusal, schema, and task quality before counting a useful result.'],
      ]) },
      { title: 'Avoid a misleading percentile calculation', body: `Percentiles describe a distribution, not an interchangeable unit of work. The p95 queue time plus p95 execution time is not generally the p95 end-to-end time because the slow components may occur on different requests. Calculate end-to-end percentiles from matched complete observations. Retain enough joint information to diagnose which component dominates without exposing sensitive request content.

Separate important slices such as long context, large output, cache misses, and cold starts. A global percentile can hide a critical minority of failures. Compare the same arrival process and output-quality contract across serving configurations. Report sample size and test duration, and make the success, timeout, refusal, and cancellation rules part of the report rather than undocumented dashboard assumptions.` },
      { title: 'Optimize cost per useful outcome', body: `Pricing and utilization affect cost, but cheap tokens are not necessarily cheap task completion. Count retries, invalid output, repeated retrieval, and fallback calls in the total. If a smaller model requires three corrections while a larger model succeeds once, a per-token comparison alone can reverse the actual economic decision. Route only under a policy that preserves quality and safety requirements.

Bound queue length, request size, retries, and execution budgets. Define what cancellation can actually stop and how abandoned provider work is accounted for. The local controls let you see timing tradeoffs without spending tokens or connecting services. Use them to formulate a measurable hypothesis, then validate it under a real load test instead of presenting a deterministic toy timeline as production capacity evidence.` },
    ],
    exercise: 'Set output tokens to one, then to fifty, and explain the timing difference. Define a goodput numerator that excludes fast but unsupported answers and a denominator that includes observed failures.',
  }),
  reading({
    id: 'context-contracts', title: 'Assemble context under evidence and token contracts', group: 'Prompt and context lab',
    summary: 'Keep instructions, history, evidence, and output reserves distinct while making packing and overflow observable.',
    objectives: ['Calculate available evidence capacity after fixed reservations.', 'Apply eligibility before ordered context selection.', 'Preserve provenance and authority when summarizing or compressing context.'],
    quizTopic: 'context-contracts', relatedProblemIds: ['lab-context-packer', 'ai-knowledge-assistant'],
    sourceIds: ['dojo-topic-map', 'owasp-prompt-injection', 'hf-generation'],
    sections: [
      { title: 'Build the request from named artifacts', body: `A prompt is an assembled request with several distinct responsibilities. Application instructions define behavior; the user's task defines the current goal; retrieved sources provide evidence; history supplies relevant conversational state; tool schemas define possible proposals. Version these artifacts and preserve their boundaries instead of concatenating unlabelled text and hoping its origin remains clear.

The local Dojo topic map motivates a focused context-engineering path, but the lesson and visual packer are original Studio material. Neither the browser fixture nor an instruction hierarchy supplies authentication. A source document that claims to be a system administrator is still source content. The server must decide which resources are eligible before any content crosses the retrieval, reranking, or generation boundary.` },
      { title: 'Reserve capacity before selecting evidence', body: `Under the lab's single-window contract, subtract output reserve, instructions and schemas, and selected history from the context window. The remainder is evidence capacity. Real providers may expose separate input, output, and total limits, so apply the limits for the exact model and endpoint. A maximum window is not a promise that every fact inside it will be used correctly.

The visual fixture reserves 512 tokens for instructions and schemas. It then packs already ranked eligible passages in order, skipping ones that do not fit. If fixed reservations alone exceed the window, it reports an error and packs nothing. Negative available capacity is not silently clamped into a successful zero-evidence request. All costs are invented token counts, not a character counter or a production tokenizer.`, visualization: 'context-budget' },
      { title: 'Rank useful evidence, not just similar text', body: `Semantic similarity can find related passages that do not answer the question. Keep the user's task, source version, and necessary evidence span in the retrieval judgment. An older summary might resemble the question more than the current authoritative policy. Rank and deduplicate before packing, but do not let a high score override an eligibility check or a source freshness rule.

The fixture has unique evidence IDs and a clearly labeled simulated eligibility switch. It is not a real permission editor. Production eligibility comes from current server-owned identity and policy, not a checkbox or model output. The related coding lab additionally specifies how duplicate identities are handled. Different packing objectives can be legitimate, but their observable tie, deduplication, and oversized-item rules must be explicit.`, flow: flow('From task to bounded context', 'Evidence selection and authority remain separate operations.', [
        ['Resolve scope', 'Derive identity and current access at the server. Model instructions cannot grant resource access.'],
        ['Reserve tokens', 'Account for instructions, tool schemas, relevant history, and output before packing evidence.'],
        ['Select evidence', 'Use ranked, eligible, current sources and preserve their identities under the declared budget.'],
        ['Validate claims', 'Check whether the output is supported; a packed passage or citation is not itself proof of correctness.'],
      ]) },
      { title: 'Compression must preserve what the task needs', body: `A summary can save tokens but remove exceptions, dates, uncertainty, or the distinction between a proposal and a confirmed event. Decide which fields must remain exact before compressing. Resource identity, approval payloads, and authoritative operation outcomes should not be reconstructed from fluent conversational memory. Keep a route from each important claim back to its source span or business record.

Test context ordering and compression using the same held-out tasks. Long-context position effects are empirical and workload-dependent, not a universal curve you can assume from a diagram. Measure whether the required evidence survives packing and whether the generated answer uses it correctly. If evidence was absent, a generation-only prompt tweak cannot repair the missing information reliably.` },
      { title: 'Version the assembly and inspect failures safely', body: `Record enough non-sensitive metadata to reproduce an assembly decision: prompt version, model revision, source generations, token-counting method, and selected evidence identifiers. Logs should not default to retaining every full prompt or private document. Apply access, retention, and redaction policies to traces and cached assemblies as carefully as to the underlying sources.

When a request fails, distinguish fixed-budget overflow, no eligible evidence, missing source coverage, unsupported generation, and invalid output. Those failures need different fixes and user messages. The diagrams are diagnostic tools, not an automatic quality gate. Completing this lesson should leave you able to defend one packing policy, show a counterexample to it, and identify which production evidence would justify changing that policy.` },
    ],
    exercise: 'Overcommit the window, restore a valid budget, and inspect which evidence is packed. Then implement the related coding lab and compare its duplicate-identity rule with the visual fixture.',
  }),
  reading({
    id: 'structured-proposals', title: 'Validate generated structures before business actions', group: 'Prompt and context lab',
    summary: 'Separate schema adherence, semantic correctness, authorization, approval, and confirmed execution.',
    objectives: ['Handle completed, refused, incomplete, and invalid responses separately.', 'Explain why schema-valid fields are not sufficient business authority.', 'Version a prompt-and-validator contract and test unsafe proposals without side effects.'],
    quizTopic: 'structured-proposals', relatedProblemIds: ['lab-tool-dispatch', 'lab-agent-reducer'],
    sourceIds: ['dojo-topic-map', 'structured-output-contracts', 'owasp-object-auth', 'mcp-tools'],
    sections: [
      { title: 'Describe an output contract rather than a formatting wish', body: `A prompt can ask for JSON, but a request for formatting is not the same as a provider-enforced schema. Where the selected endpoint supports constrained structured output, specify required fields, enums, and allowed extra properties using its documented schema subset. Keep the schema version alongside the prompt and validator so a deployment cannot accidentally combine an old consumer with a new field meaning.

Even a schema-enforced response needs lifecycle handling. The provider may refuse, generation may be interrupted, or transport may fail before a complete response arrives. Inspect those states rather than feeding partial text into the happy-path decoder. The course uses no live model; the existing pure tool-gate lab lets you inspect proposal contracts safely without performing a consequential action.` },
      { title: 'Validation has several independent layers', body: `Structural validity checks types, required keys, bounds, and enums. Semantic validity asks whether the values correspond to the task and current facts. Authorization asks whether the authenticated actor may operate on the referenced resource. Approval asks whether the exact material action was accepted by a permitted approver under current policy. These questions cannot be collapsed into one successful JSON parse.

A valid document identifier can still point to another tenant. A valid expectedVersion can be stale. A correctly typed tag can differ from the one the user approved. Resolve identity from the server session, load current resource state, and apply the relevant checks again at execution. Passing a browser example does not establish production authority, isolation, or atomicity.`, flow: flow('A proposal is not an effect', 'Each stage has its own evidence and rejection category.', [
        ['Read response state', 'Distinguish complete structured content, refusal, interruption, and transport failure before parsing a proposal.'],
        ['Validate meaning', 'Check schema and business facts. Correct shape alone does not establish truth or resource ownership.'],
        ['Authorize action', 'Resolve server-owned scope, current version, exact approval, and resource budgets.'],
        ['Commit and recover', 'Persist intent, dispatch under the actual provider contract, and confirm or reconcile the outcome.'],
      ]) },
      { title: 'Treat source text as data at every boundary', body: `Instructions embedded in a retrieved document or tool result can try to redirect the model. Labels and delimiters clarify origin but do not make the model immune to prompt injection. Keep capabilities narrow, credentials outside model context, destinations constrained, and tool outputs bounded. A model-selected tool name and argument object remain an untrusted proposal until application checks accept them.

Use test documents that contain plausible administrative language and requests to reveal unrelated data. Verify that your executor cannot perform the requested forbidden operation even when the model produces a syntactically valid proposal. The independent authority boundary is essential because an instruction hierarchy is model behavior, while permission enforcement is a server responsibility that must hold regardless of model compliance.` },
      { title: 'Keep retries bounded and observable', body: `If a completed output fails a deterministic validator, return a bounded correction category or terminate according to policy. Limit repair attempts, total tokens, and elapsed time. Do not retry a schema mismatch indefinitely or turn an authorization failure into a hint revealing another tenant's resource details. Preserve a distinction between invalid proposal, rejected authority, and an already dispatched operation whose outcome is unknown.

A transport timeout after a consequential dispatch is not an invitation to generate another action key. Recover the original operation through its receipt or provider reconciliation contract. A prompt revision cannot retroactively fix an external side effect. Use the reducer exercise to reason about unknown state and compatible replay independently from how fluently the model narrates its progress.` },
      { title: 'Release prompt changes like executable contracts', body: `Few-shot examples and instructions change observable behavior even when application code is unchanged. Evaluate them against a versioned set containing ordinary tasks, refusals, stale resources, missing evidence, malformed output, and adversarial sources. Keep authoritative validators fixed while comparing candidate prompt behavior. Check both accepted outcomes and the categories of rejected proposals.

Review whether a new schema field changes consent or business meaning before rolling it out. Keep compatible readers or perform an explicit migration where saved artifacts need it. Compare quality and cost on the same tasks and define rollback conditions before release. The diagrams provide a clear sequence of responsibilities; the goal is not to make every model response succeed, but to make each acceptance and failure honest, bounded, and explainable.` },
    ],
    exercise: 'Trace a schema-valid tag change for the wrong tenant through the diagram. Implement the pure tool gate, then explain which additional checks and durable records real execution would require.',
  }),
];
