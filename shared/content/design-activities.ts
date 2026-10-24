import { activity, type LessonActivity } from './activity-authoring';

export const designActivities: Record<string, LessonActivity> = {
  introduction: activity('Follow one parcel allocation through ownership, acceptance, and a rejection that must preserve state.', [
    ['Name the operation', 'Describe a caller, compatible locker, receipt, and rejected outcomes before deciding how many classes to create.'],
    ['Locate the owner', 'Keep the capacity check and reservation creation inside the owner of the no-double-occupancy invariant.'],
    ['Trace a rejection', 'An unavailable locker must produce an explicit result without consuming unrelated capacity or leaving half a reservation.'],
  ], ['Which observation best demonstrates a coherent allocation boundary?', ['A rejected allocation preserves occupancy and returns a specific reason.', 'Every noun in the story has a separate class.', 'Callers can set locker occupancy fields directly.'], 'Ownership is demonstrated by preserved invariants and observable results. Class counts do not establish cohesion, and public mutation creates paths around the operation contract.']),
  'object-modeling': activity('Represent five inventory units as available, reserved, and committed totals under one authoritative owner.', [
    ['Separate identity', 'A reservation keeps its identity across lifecycle changes, while a quantity value is compared by its contents and units.'],
    ['Conserve the total', 'Moving units from available to reserved must happen together; releasing one reservation twice must not manufacture more stock.'],
    ['Expose a read model', 'Return intentional observations or copies rather than a mutable internal map that callers can use to bypass validation.'],
  ], ['What is wrong with returning a mutable internal reservation map?', ['Callers can bypass the owner and break its invariants.', 'It guarantees stronger database atomicity.', 'It makes reservation identities immutable by default.'], 'Encapsulation protects mutation paths only when aliases are controlled. A new outer container can still expose mutable nested records, so copying depth belongs in the contract.']),
  'design-principles': activity('Change a pricing policy without changing the lifecycle that prevents duplicate checkout.', [
    ['Find the variation', 'Weekend pricing and session ownership change for different reasons; separate the policy from the state it must not control.'],
    ['Supply a capability', 'Inject a small pricing contract with explicit units and failures rather than discovering a global provider from business code.'],
    ['Preserve behavior', 'Run the same checkout examples after the change, including exact billing boundaries and a rejected second checkout.'],
  ], ['Why can composition help a pricing-policy change?', ['Pricing can vary while session lifecycle rules remain owned separately.', 'Composition removes the need for failure semantics.', 'Every constant should become an interchangeable class.'], 'Composition localizes a demonstrated variation. It still adds a boundary to explain and test; speculative interfaces are not automatically better design.']),
  interfaces: activity('Compare two adapters using the same operation contract, including ambiguous timeout and stale-version results.', [
    ['Specify observations', 'Define valid input, units, mutation rules, and distinct business versus infrastructure outcomes beyond a matching method name.'],
    ['Supply lifecycle', 'An injected clock or repository must define what time and transaction lifetime mean, not just how it is constructed.'],
    ['Run shared evidence', 'Use contract examples across adapters, then separate integration evidence for actual locking and persistence guarantees.'],
  ], ['Can passing tests against a memory repository prove PostgreSQL locking semantics?', ['No; infrastructure concurrency needs integration evidence.', 'Yes; matching method names prove all adapter semantics.', 'Only when the memory repository has more methods.'], 'A faithful double can establish domain observations within its model. It does not implement the database protocol, network failures, or process coordination that require separate tests.']),
  'state-machines': activity('A submitted workflow may be approved only from the expected current version.', [
    ['Enumerate transitions', 'Separate states such as submitted and approved from events such as approve, and identify terminal behavior explicitly.'],
    ['Check preconditions', 'State and expected version must match together at the transition boundary before the authoritative state changes.'],
    ['Keep rejection visible', 'An illegal event returns a rejection without advancing the business version; attempt logging is a separate observation.'],
  ], ['Should a rejected stale-version transition advance the business version?', ['No, unless the contract separately defines another accepted mutation.', 'Yes; every attempted command changes the business state.', 'Only when the client retries quickly enough.'], 'Rejection and acceptance are different outcomes. The versioned-write experiment isolates this precondition rule, not a full workflow engine or distributed transaction.'], { kind: 'versioned-write' }),
  'error-contracts': activity('A provider timeout occurs after a possibly committed operation; the caller must distinguish uncertainty from business rejection.', [
    ['Classify the outcome', 'Insufficient capacity, malformed input, and unknown remote outcome require different caller behavior and should not collapse to false.'],
    ['Preserve owned state', 'On a known rejection, leave the protected state unchanged; on uncertainty, expose a recovery path instead of fabricating success.'],
    ['Retry by identity', 'Recover the same logical effect through its durable identity before deciding whether another attempt is safe.'],
  ], ['What is unsafe about converting every provider exception into an empty successful result?', ['It hides failed or uncertain work from the caller.', 'It preserves every business distinction automatically.', 'It proves retries can never duplicate effects.'], 'Success-shaped fallbacks destroy information needed for recovery. Make outcomes explicit and use repository-standard error reporting rather than presenting missing evidence as successful empty work.']),
  concurrency: activity('Two callers use the same observed version; a local model accepts only the first matching conditional replacement.', [
    ['Share an observation', 'Both callers base their intended updates on version one, which is not a lock or reservation of that version.'],
    ['Commit atomically', 'The real store must compare and update together; the sequential browser model only demonstrates the desired observations.'],
    ['Reject stale work', 'After one accepted update advances the version, the other caller must reread and reconcile rather than blindly overwrite.'],
  ], ['Does a process-local mutex protect writers in another application process?', ['No; the authority must coordinate every relevant writer.', 'Yes; a lock name is automatically global.', 'Only if both callers loaded the same screen.'], 'Lock scope is a semantic boundary. A local simulation or mutex can show transitions but cannot establish cross-process isolation, durability, or fairness.'], { kind: 'versioned-write' }),
  collections: activity('An ordered collection must expose its mutation and retention rules rather than relying on accidental container behavior.', [
    ['Name the observation', 'Insertion order, frequency order, recency order, and sorted order answer different questions even when stored in similar containers.'],
    ['Update owned indexes', 'When one operation changes recency or membership, update every related lookup and order representation consistently.'],
    ['Bound retained state', 'Capacity eviction and time expiry are distinct policies; expired logical state cannot remain valid merely because cleanup has not run.'],
  ], ['Is TTL expiry the same rule as least-recently-used eviction?', ['No; age policy and recency-based capacity policy differ.', 'Yes; both always remove the same key.', 'Only when keys are represented as strings.'], 'Choose the policy required by the contract. The cache lab deliberately models only TTL and invalidation, so it should not be mistaken for a complete LRU implementation.'], { kind: 'cache' }),
  patterns: activity('Introduce a pattern only after showing which decision changes and which state must remain protected.', [
    ['Describe the pressure', 'Show a real policy variation, notification need, or construction problem before selecting a named design pattern.'],
    ['Assign one boundary', 'A strategy can vary a decision while the aggregate retains ownership of its lifecycle and invariants.'],
    ['Evaluate the cost', 'Compare the localized change with extra indirection, interface obligations, and failure paths introduced by the pattern.'],
  ], ['When is adding a strategy abstraction most justified?', ['A demonstrated policy varies independently under a stable contract.', 'A pattern name makes every design production-ready.', 'The goal is the largest possible class hierarchy.'], 'Patterns describe useful tradeoffs, not quality certificates. Keep the simplest implementation that accommodates the demonstrated change without weakening behavior.']),
  persistence: activity('Persist a versioned update where the constraint check and accepted mutation share one transaction boundary.', [
    ['Identify durable truth', 'Decide which data must survive process exit and which in-memory views can be reconstructed from authoritative records.'],
    ['Protect the write', 'Use database constraints and conditional operations that cover all writers rather than assuming an object method is globally atomic.'],
    ['Recover the outcome', 'A lost response after commit needs an operation-recovery contract; a rollback only describes work that did not commit.'],
  ], ['Does wrapping a method in a class make its writes durable?', ['No; persistence and transactional boundaries need an actual backing mechanism.', 'Yes; private fields survive every process restart.', 'Only when the class name ends in Repository.'], 'Names and encapsulation do not provide storage semantics. The browser experiment is intentionally a sequential precondition model and does not write an account or database.'], { kind: 'versioned-write' }),
  'testing-designs': activity('Exercise accepted and rejected state histories rather than only testing one happy-path method call.', [
    ['Choose a history', 'Sequence commands that expose reuse, expiry, stale versions, and terminal behavior instead of testing each method in isolation.'],
    ['Observe invariants', 'After every command, compare state and outcomes; a rejected command must preserve the state promised by the contract.'],
    ['Vary a collaborator', 'Inject deterministic time and failures, then use integration tests for infrastructure guarantees the double cannot reproduce.'],
  ], ['What makes a duplicate-release test useful for an inventory owner?', ['It checks conservation after a repeated command, not only a single success.', 'It proves all network effects occur exactly once.', 'It removes the need for any persistence tests.'], 'State histories expose interactions hidden by isolated examples. They establish behavior inside their model; stronger infrastructure claims need evidence at the corresponding boundary.'], { kind: 'release-gate' }),
  'design-walkthrough': activity('Defend one complete design by tracing a success, a rejection, and a deliberate extension.', [
    ['Choose a vertical slice', 'Follow one operation through inputs, state owner, acceptance, and response before expanding the diagram with optional features.'],
    ['Challenge the boundary', 'Interrupt or repeat the operation and explain which state changes, which state remains, and what the caller can recover.'],
    ['Change one assumption', 'Introduce the next requirement and show the precise contract and implementation seam it affects rather than claiming unlimited flexibility.'],
  ], ['Which finish best supports a low-level design argument?', ['A complete operation trace with an invariant, rejection, and scoped extension.', 'A diagram with every known pattern and no execution path.', 'An assertion that all future requirements need no changes.'], 'A scoped working model is inspectable. Explain what it proves and what is excluded, especially concurrency, remote effects, persistence, and input-domain assumptions.']),
};
