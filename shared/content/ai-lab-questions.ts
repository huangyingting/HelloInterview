import type { Difficulty, QuizQuestion } from '../types';
import type { SourceId } from './sources';

const sources = {
  'retrieval-ranking': ['pgvector-search', 'azure-hybrid-ranking'],
  'retrieval-experiments': ['llm-zoomcamp', 'llm-evals'],
  'agent-tool-contracts': ['mcp-tools', 'hf-agents-course', 'owasp-object-auth'],
  'agent-recovery': ['langgraph-persistence', 'stripe-idempotency'],
} satisfies Record<string, SourceId[]>;

function q(number: number, topic: keyof typeof sources, prompt: string, answer: string, distractors: [string, string, string], explanation: string, difficulty: Difficulty = 'Medium'): QuizQuestion {
  const correct = (number - 1) % 4, options = [...distractors];
  options.splice(correct, 0, answer);
  return { id: `ai-lab-${number.toString().padStart(3, '0')}`, topic, prompt, options, correct, explanation, difficulty, sourceIds: sources[topic] };
}

export const aiLabQuestions: QuizQuestion[] = [
  q(1, 'retrieval-ranking', 'An approximate vector query returns fewer rows after a restrictive tenant filter. Which response is appropriate?',
    'Inspect the actual plan and bounded search settings while keeping authorization intact.',
    ['Remove the tenant filter and trust the model to hide unauthorized results.', 'Assume LIMIT guarantees enough authorized approximate candidates.', 'Increase answer temperature to generate missing index rows.'],
    'Approximate candidate collection and filtering interact according to the database plan and index implementation. Restrictive filters can leave fewer results than requested. Compare an exact filtered baseline and investigate bounded candidate or iterative-scan settings. Never weaken access controls to improve recall. Similarity, candidate availability, and authorization are distinct obligations with different evidence and failure policies.'),
  q(2, 'retrieval-ranking', 'The context budget is five tokens. Eligible ranked passages have IDs/costs A/7, A/2, and B/3. Under the lab’s first-eligible-identity rule, what is selected?',
    'Only B, using three tokens.',
    ['A and B, using five tokens.', 'The first A, even though it exceeds the budget.', 'No passages, because the first item is too long.'],
    'The contract consumes an identity when its first eligible occurrence is examined, even when that passage does not fit. Therefore the later A is ignored, while B fits and is selected. This deliberately stable greedy policy is not an optimal packing algorithm. Different deduplication or utility policies can be valid, but must be stated and tested rather than mixed silently.'),
  q(3, 'retrieval-ranking', 'Two embedding models both emit 768-dimensional vectors. What must still be established before their vectors share one search space?',
    'Compatible model revisions, representation semantics, and the intended similarity metric.',
    ['Equal dimensions alone prove their semantic coordinates align.', 'A shared JSON format makes vectors interchangeable.', 'A larger HNSW index can correct arbitrary representation mismatch.'],
    'Matching dimensions establishes only that a numeric operation can have compatible shapes. Different models may encode unrelated coordinate systems or require different normalization and similarity assumptions. Version the representation and evaluate relevance before mixing it. An approximate index accelerates a chosen comparison; it does not align incompatible semantic spaces or repair an unsuitable embedding model.', 'Easy'),
  q(4, 'retrieval-ranking', 'An ANN index reproduces exact vector neighbors almost perfectly, yet users cannot find the right policy. Which distinction matters?',
    'Neighbor recall against exact vectors is not semantic relevance against judged answers.',
    ['Exact vector neighbors are always the correct business evidence.', 'Only increasing index memory can improve semantic relevance.', 'Human query judgments are irrelevant once ANN recall is high.'],
    'Approximate-neighbor recall evaluates how closely the index matches the selected vector-distance baseline. Product relevance asks whether returned evidence answers the user’s actual question. Poor chunking, stale sources, an unsuitable embedding, or query representation can make both exact and approximate vector results unhelpful. Diagnose those stages separately instead of treating one strong infrastructure metric as proof of useful answers.'),

  q(5, 'retrieval-experiments', 'Relevant IDs are {A, B}; ranked IDs are [A, A, X, B]; k is three. After deduplication before truncation, what are precision and recall?',
    'Precision is 2/3 and recall is 1.',
    ['Precision is 1 and recall is 1.5.', 'Precision is 1/3 and recall is 1/2.', 'Precision is 2/4 and recall is 2/3.'],
    'Deduplicating the ordered ranking first gives A, X, B, so the top three contain two relevant IDs. Under the lab’s fixed-k denominator, precision is two thirds and recall is two divided by the two distinct relevant IDs. The first relevant position is one. Counting duplicate hits or truncating before the declared deduplication step changes the contract.'),
  q(6, 'retrieval-experiments', 'The judged relevant set is empty. How does the lab handle recall and its aggregate?',
    'Report null recall and exclude the query from answerable-query means; evaluate abstention separately.',
    ['Report perfect recall because there was nothing to retrieve.', 'Divide by zero and replace the result with one.', 'Delete the query so its abstention behavior cannot be inspected.'],
    'An empty relevance denominator does not define an ordinary recall value. The lab exposes null and keeps the item visible while excluding it from the specified answerable-query aggregate. This avoids inventing success from missing labels. Real evaluations must also determine whether the query is genuinely unanswerable or merely unjudged, and measure appropriate abstention separately from discovery.'),
  q(7, 'retrieval-experiments', 'A candidate improves macro recall but returns revoked sources in a small slice. What should the release gate do?',
    'Reject the authorization regression even if the overall ranking average improved.',
    ['Average the unauthorized results into a higher quality score.', 'Release because popularity of the underlying course validates the method.', 'Remove that slice after seeing its unfavorable result.'],
    'An access-control violation is not a minor ranking error that can be traded against an aggregate gain. Define critical invariants and slices before observing candidate results, and block unacceptable regressions. Keep a versioned baseline and a rollback route. Post-hoc removal of failing queries or reliance on repository popularity makes the evidence weaker rather than the system safer.', 'Hard'),
  q(8, 'retrieval-experiments', 'Only one of three query families benefits from a retriever change. What evidence is most useful next?',
    'Paired per-query and per-family results with latency, evidence budget, and source-version information.',
    ['Only an unlabeled single global score.', 'Training loss for an unrelated generator.', 'A new holdout repeatedly tuned until every score improves.'],
    'Paired results isolate how the candidate changes the same tasks, while family slices reveal whether the gain is narrow or hides regressions. Latency and evidence volume show operational tradeoffs, and versioned sources support reproduction. A single aggregate can conceal the mechanism. Keep final evaluation independent instead of repeatedly optimizing against it and continuing to call it an untouched holdout.'),

  q(9, 'agent-tool-contracts', 'A discovered MCP tool advertises a read-only annotation. What does the application still need?',
    'A trusted capability policy, validated arguments, and operation-level authorization.',
    ['No checks, because any annotation proves server behavior.', 'Only a lower model temperature.', 'Permission to call every network destination referenced in its description.'],
    'Protocol metadata describes a tool, but annotations from an untrusted server are not proof of its behavior or authority. The application must choose approved capabilities, validate inputs, enforce current actor and resource scope, and constrain execution destinations. Structured discovery improves interoperability; it does not turn external descriptions or model-selected calls into authorization grants.', 'Easy'),
  q(10, 'agent-tool-contracts', 'A tag-change approval matches the document and call ID but names a different tag. What is the correct readiness decision?',
    'Approval required for the exact proposed tag and current version.',
    ['Ready because all changes in one conversation share approval.', 'Ready if the arguments parse as JSON.', 'Silently replace the approved tag with the new one.'],
    'Approval must bind the material action parameters, not merely a document or conversation. A different tag is a different proposal under this contract, and current version and authorization checks still apply. Well-formed JSON proves neither informed consent nor business permission. Keep the old approval intact and require a matching new approval rather than changing its meaning after the fact.'),
  q(11, 'agent-tool-contracts', 'The tool-gate lab returns ready. What does that result establish?',
    'The supplied synthetic proposal passed the lab’s pure readiness checks; no external effect occurred.',
    ['The subscription provider has already committed a write.', 'The browser has proven production tenant isolation.', 'The task can skip durable intent and audit records.'],
    'This lab deliberately performs no network I/O and does not mutate real resources. Its result is evidence about a narrow deterministic contract over trusted fixture data. Actual execution still needs authenticated authority, approval lifecycle rules, durable operation identity, bounded resources, and provider recovery. Keeping the exercise pure makes rejection cases inspectable without pretending that examples prove a deployed security boundary.'),
  q(12, 'agent-tool-contracts', 'Why reject extra argument keys when a tool declares an exact strict shape?',
    'Unexpected fields can introduce behavior outside the declared and reviewed contract.',
    ['Every additional JSON key is automatically a valid permission grant.', 'Strict validation makes resource ownership checks unnecessary.', 'Unknown fields always improve backward compatibility without risk.'],
    'A strict tool contract should not silently accept hidden options that may later influence execution. Rejecting unknown keys makes the proposal’s meaning and test surface explicit. This is only one layer: valid structure does not prove resource ownership, current version, or approval. Deliberate versioned evolution can add fields, but permissive accidental behavior is not the same as a compatible migration.'),

  q(13, 'agent-recovery', 'A graph checkpoint is stored in a process-local memory saver. What survives a process restart?',
    'Nothing from that in-memory checkpoint unless it was separately persisted.',
    ['Every prior tool side effect is automatically rolled back.', 'All checkpoints survive because the class is called a saver.', 'The model regenerates an authoritative receipt from conversation text.'],
    'In-memory storage disappears when its process ends. Durable recovery requires a persistent backend and a tested relationship between graph checkpoints and business-operation records. Even a persistent checkpoint cannot automatically roll back an arbitrary external side effect. Recover actual outcomes from durable receipts or provider contracts, not a model’s recollection or the name of a development helper.', 'Easy'),
  q(14, 'agent-recovery', 'After dispatch, a timeout moves an operation to unknown. Another dispatch command arrives with the same key. What does the lab return?',
    'reconcile-required, preserving state and remaining dispatch budget.',
    ['confirmed, because timeouts imply success.', 'A new operation with a fresh key and another budget charge.', 'approved, erasing evidence that a dispatch may have occurred.'],
    'Unknown preserves the fact that a consequential attempt may already have completed. A repeated dispatch request cannot safely infer failure or create a fresh effect. The lab therefore requires reconciliation and does not consume another dispatch allowance. A real executor may recover through provider status or compatible idempotent replay, but those guarantees come from the provider contract, not the reducer alone.', 'Hard'),
  q(15, 'agent-recovery', 'Which record should determine whether a plan-change action completed after an agent resumes?',
    'The authoritative operation receipt or reconciled provider state, not a conversation summary.',
    ['A summary sentence that says the user seemed satisfied.', 'The longest message in the model context.', 'A retrieved preference from an unrelated thread.'],
    'Conversation summaries can be incomplete, stale, or simply wrong. They help context management but must not overrule an operation record or confirmed provider result. Keep task memory, approval, and business state distinct. If dispatch remains unknown, preserve that uncertainty until an authoritative recovery path resolves it instead of upgrading it based on fluent model-generated narration.'),
  q(16, 'agent-recovery', 'Why test the reducer after every event prefix rather than only at the end?',
    'An intermediate invalid mutation or double budget spend can be hidden by a later state overwrite.',
    ['The final state never matters.', 'Prefix testing proves all distributed database semantics automatically.', 'It eliminates the need to specify valid transitions.'],
    'State-machine invariants must hold throughout execution. A final snapshot can look correct even if an earlier transition consumed budget twice or temporarily authorized an invalid action. Prefix tests reveal those defects and support independent state-table comparison. They still cover a sequential model; production concurrency, persistence, and external effects require their own integration and failure-injection evidence.'),
];
