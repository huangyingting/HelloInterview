import { activity, type LessonActivity } from './activity-authoring';

export const systemDesignActivities: Record<string, LessonActivity> = {
  introduction: activity('Trace a short-link create request whose response is lost after the authoritative write.', [
    ['Agree on behavior', 'Separate creating a link from redirecting it; agree on ownership, expiry, and the response the caller can observe.'],
    ['Commit the operation', 'Validate the caller and persist the logical operation before acknowledging that the link now exists.'],
    ['Recover the outcome', 'A timed-out caller retries the same operation identity and recovers its receipt instead of creating another link.'],
  ], ['A create request times out after commit. What does the client know?', ['The outcome is uncertain and must be recovered safely.', 'No write happened because no response arrived.', 'A fresh operation key will recover the old receipt.'], 'A timeout describes a missing observation, not an uncommitted transaction. Recover using a durable operation identity with compatible parameters; a new identity requests new work.']),
  requirements: activity('Follow a seat reservation from a user journey to a concurrent invariant and a measurable objective.', [
    ['Name the journey', 'State who may hold which seat, how long the hold lasts, and what happens when it has expired.'],
    ['Protect ownership', 'The authoritative operation must prevent two live owners for the same event-seat pair, even when requests overlap.'],
    ['Measure eligible work', 'Define which reservation attempts count, what is a good result, and the window before choosing a reliability target.'],
  ], ['Which requirement needs an atomic authoritative check?', ['At most one current owner per event-seat pair.', 'Search results should usually be responsive.', 'The screen should display a friendly message.'], 'An ownership invariant must survive concurrent writers. Search freshness and presentation matter, but neither a friendly response nor a prior read enforces exclusive ownership.']),
  'capacity-estimation': activity('Change the workload assumptions, then compare peak network demand with replicated thirty-day storage.', [
    ['Declare the workload', 'Count operations per day and serialized bytes per operation; keep reads and newly stored writes conceptually separate.'],
    ['Apply explicit factors', 'Divide by 86,400 for an average rate, then apply a declared peak factor rather than calling the average peak traffic.'],
    ['Account for copies', 'Multiply retained logical bytes by replica count; payload network demand and stored copies are different resource dimensions.'],
  ], ['Doubling stored replicas changes which estimate directly?', ['Replicated stored bytes, not the logical request rate.', 'Every client operation becomes two logical requests.', 'The retained logical record count is halved.'], 'Copies increase the modeled physical payload footprint. They do not change how many user operations occur. Indexes, overhead, backups, and actual replication traffic need separate estimates.'], { kind: 'capacity' }),
  'api-design': activity('Two editors load version one; only one replacement should commit against that version.', [
    ['Read a version', 'Both editors observe the same document version and prepare changes based on that specific state.'],
    ['Condition the write', 'The server checks the expected version and replaces the document in one authoritative operation, advancing its version.'],
    ['Reject stale intent', 'The second replacement keeps its local draft but must reconcile after its old precondition no longer matches.'],
  ], ['Does a retry identity by itself prevent a different editor overwriting newer content?', ['No; the update also needs a concurrency precondition.', 'Yes; any idempotency key protects every future edit.', 'Yes; retry identity and document version are interchangeable.'], 'Idempotency recognizes one logical operation. A version precondition protects the state that operation was based on. A robust contract can need both, with distinct rejection and recovery behavior.'], { kind: 'versioned-write' }),
  'data-modeling': activity('Design the reservation lookup and ownership constraint from the actual read and write paths.', [
    ['List access paths', 'Identify lookups by event-seat and by customer; a schema must support both the query predicates and required ordering.'],
    ['Encode the invariant', 'Represent active ownership with an authoritative constraint or conditional transaction, not only a convenient application object shape.'],
    ['Measure maintenance', 'Compare plans on representative data and include index storage and write amplification before adding another access structure.'],
  ], ['A new index speeds a read. What cost still needs evaluation?', ['Extra stored index data and maintenance on relevant writes.', 'The database no longer needs uniqueness constraints.', 'Every query will automatically use the new index.'], 'An index is an additional maintained representation. Its usefulness depends on predicates, selectivity, ordering, and planner decisions; it does not replace correctness constraints.']),
  transactions: activity('Interrupt the read-check-write pattern with a competing update and inspect which state is protected.', [
    ['Observe the race', 'Two transactions may read the same availability before either changes ownership; reading first is not enough.'],
    ['Choose a boundary', 'Use a constraint, appropriate lock, or conditional write so validation and mutation share the authoritative concurrency boundary.'],
    ['Handle rejection', 'A losing writer receives a conflict or bounded transaction retry; it must not silently overwrite the accepted owner.'],
  ], ['Two readers both see version one. Which second write preserves the first update?', ['Reject the second write when expected version one no longer matches.', 'Apply the second body because it started earlier.', 'Check the version in the browser and write unconditionally.'], 'The precondition must be checked atomically where the state is changed. A client-side check races, and transaction isolation must be selected for the actual invariant.'], { kind: 'versioned-write' }),
  caching: activity('A value is cached at time zero, the origin changes at second five, and a later reader may still see the old copy.', [
    ['Populate a copy', 'A cache miss reads the authoritative origin and stores version one with a declared lifetime.'],
    ['Change the origin', 'Version two becomes authoritative; without invalidation, the cached version can remain fresh by TTL but obsolete by content.'],
    ['Choose a read policy', 'Expiry or invalidation causes a refresh; serving an unexpired copy is acceptable only under the product freshness contract.'],
  ], ['Can a cache entry be inside its TTL but already obsolete?', ['Yes; the origin may have changed after the entry was stored.', 'No; TTL continuously verifies the origin version.', 'Only if the client is unauthenticated.'], 'TTL measures a retention or freshness policy, not a live comparison with authoritative state. Current permission decisions may need a stricter revocation boundary than descriptive content.'], { kind: 'cache' }),
  'http-caching': activity('Separate reusable public bytes from personalized responses and conditional validation.', [
    ['Classify the response', 'Determine whether a representation is public, private, or unsuitable for storage before sharing it across callers.'],
    ['Check freshness', 'A stored response can be reused under its cache directives; a stale response may require conditional validation with the origin.'],
    ['Preserve the boundary', 'Keep tenant, authorization, and representation variance in the cache contract; a CDN must not turn private content into a public hit.'],
  ], ['What does an ETag conditional request primarily establish?', ['Whether the origin considers the selected representation unchanged.', 'That the caller may access every cached object.', 'That all intermediate caches have purged every old copy.'], 'A validator supports representation comparison. It is not authorization and does not globally invalidate other caches. The experiment below isolates TTL, not the full HTTP caching protocol.'], { kind: 'cache' }),
  queues: activity('Observe a worker that changes business state but loses the acknowledgement before redelivery.', [
    ['Accept durable intent', 'Persist the business request and its delivery intent together when the contract requires both to survive a crash.'],
    ['Perform the effect', 'A worker applies the identified operation; its success and the broker acknowledgement are separate observations.'],
    ['Replay safely', 'Redelivery must recover the durable result or use an idempotent effect, while bounded retries keep failures visible.'],
  ], ['Acknowledgement is lost after an effect commits. What can the broker safely infer?', ['It cannot infer whether the business effect committed.', 'The business effect definitely failed.', 'The next worker may use a new business identity without risk.'], 'Delivery and business effects have different boundaries. A retry must tolerate the uncertain outcome rather than treating a missing acknowledgement as proof of no effect.'], { kind: 'queue' }),
  'event-streams': activity('Follow one event identity through partition ordering, projection update, and replay.', [
    ['Choose an order key', 'Route events for the required entity to an ordered partition; unrelated partitions do not gain one universal order.'],
    ['Update a projection', 'The consumer uses source identity and version to avoid applying a repeated or older change over newer state.'],
    ['Replay intentionally', 'Rebuild a derived view under a versioned policy without repeating unrelated external effects such as customer charges.'],
  ], ['Does ordered consumption in one partition imply total order across all partitions?', ['No; the ordering guarantee is scoped to its partition.', 'Yes; every consumer sees one global clock order.', 'Only when partition names are sorted alphabetically.'], 'Partition order is a scoped contract. Cross-partition causal requirements need an additional design; offsets from different partitions are not a universal sequence number.'], { kind: 'queue' }),
  replication: activity('A primary accepts a write before an asynchronous follower has applied it.', [
    ['Commit on an owner', 'Identify which node can accept the write and exactly which durability observations permit the acknowledgement.'],
    ['Propagate a version', 'A follower receives and applies changes later; lag means a valid follower read can still miss a recently acknowledged write.'],
    ['Specify the read', 'Route a read requiring the observed write to an appropriate consistency boundary instead of assuming every replica is current.'],
  ], ['An asynchronous replica misses a just-acknowledged write. Which conclusion follows?', ['Its read may lag under the chosen replication contract.', 'The primary necessarily lost its committed transaction.', 'Replication means every read must be immediately identical.'], 'Replication policy determines what acknowledgement and visibility mean. A lagging follower does not by itself establish lost durability, and read-your-writes needs an explicit strategy.']),
  sharding: activity('A dataset is spread across many partitions, but one tenant dominates current requests.', [
    ['Choose a partition key', 'Use ownership, access patterns, and transaction boundaries to choose a key before dividing physical storage.'],
    ['Inspect skew', 'Aggregate headroom can hide one overloaded partition; measure the busiest key or tenant rather than only fleet averages.'],
    ['Move ownership safely', 'A split or rebalance needs versioned routing and a write-ownership rule so migration does not create conflicting authorities.'],
  ], ['Why can doubling shard count fail to relieve one hot tenant?', ['The hot tenant can still map to a single partition.', 'Shard count determines every request payload size.', 'All partition keys distribute every workload uniformly.'], 'Distribution depends on the key and workload, not only the number of buckets. The capacity lab models totals and deliberately does not prove even per-shard load.'], { kind: 'capacity' }),
  'load-balancing': activity('Follow a request from connection placement to admission during a dependency slowdown.', [
    ['Place connections', 'Choose a routing policy that accounts for connection lifetime and health; equal connections need not mean equal work.'],
    ['Bound in-flight work', 'Admit only work the service can reasonably finish; unbounded waiting consumes memory and amplifies latency.'],
    ['Control amplification', 'Retries need budgets and backoff so a failing dependency does not receive more work from every upstream caller.'],
  ], ['Why is equal request count insufficient evidence of balanced load?', ['Requests can have different costs and connection lifetimes.', 'Every endpoint consumes identical resources.', 'A load balancer removes all downstream bottlenecks.'], 'Distribution is only one part of capacity. Expensive payloads, hot data, and long-lived connections can create skew despite equal counts; benchmark actual operation mixes.'], { kind: 'capacity' }),
  'rate-limiting': activity('Exhaust a full token bucket, wait for bounded refill, then attempt another burst.', [
    ['Spend a burst', 'A full bucket admits up to its capacity before tokens are consumed; it does not allow unlimited work in a short interval.'],
    ['Refill with time', 'Elapsed time restores tokens at the stated rate, capped at bucket capacity rather than accumulating without bound.'],
    ['Return an outcome', 'A request without enough tokens is rejected or delayed under an explicit policy, and distributed updates need atomic ownership.'],
  ], ['After a long idle period, can a token bucket hold more than its configured capacity?', ['No; refill is capped at capacity.', 'Yes; every unused token is retained forever.', 'Only if every caller uses the same IP address.'], 'Capacity bounds saved burst allowance. Refill rate governs recovery, while tenant identity and atomic implementation are separate concerns not established by this local calculator.'], { kind: 'token-bucket' }),
  reliability: activity('Treat a release as a decision with explicit correctness and latency guardrails, not only a successful deployment.', [
    ['Define useful success', 'Choose the eligible user operation and bad-event classification before setting a target or evaluating a rollout.'],
    ['Exercise recovery', 'Restore a representative backup and verify state; completed backup jobs alone do not demonstrate a workable recovery path.'],
    ['Gate the rollout', 'Inspect critical regressions and operational limits independently; a high aggregate pass rate must not hide a forbidden failure.'],
  ], ['A release has excellent average results but one critical data-loss regression. What follows?', ['The critical guardrail can block release despite the average.', 'A strong average automatically compensates for data loss.', 'Only deployment completion matters to reliability.'], 'Aggregate quality and non-negotiable guardrails are different checks. The lab uses a synthetic 95% threshold; a real release policy must be negotiated for its workload.'], { kind: 'release-gate' }),
  observability: activity('Diagnose delayed asynchronous work by connecting arrival rate, completions, backlog, and user-visible waiting.', [
    ['Measure eligible work', 'Separate arriving, accepted, retried, completed, and rejected operations so a single counter does not conceal failure.'],
    ['Connect a symptom', 'A growing backlog indicates unresolved work; age and end-to-end latency reveal how that delay affects actual callers.'],
    ['Investigate the cause', 'Use bounded traces and contextual logs to locate the bottleneck without putting secrets or unbounded identifiers in metric labels.'],
  ], ['A queue stays deep while arrivals match completions. What happens to that initial backlog in the fluid model?', ['It remains; there is no spare service rate to drain it.', 'It necessarily disappears because throughput is stable.', 'Queue depth alone proves all work is equally old.'], 'A stable nonzero backlog can persist at equal rates. Age depends on the work and scheduling policy, so the calculator does not invent an oldest-job age from counts.'], { kind: 'queue' }),
  security: activity('Trace a protected document read through identity, object authorization, and the derived representation.', [
    ['Identify the actor', 'Authenticate the request without treating a submitted tenant identifier as proof of membership or ownership.'],
    ['Authorize the object', 'Check current rights for the specific operation at the server boundary, including list and update paths.'],
    ['Scope derived data', 'Cached bodies, search snippets, exports, and citations must preserve the same protection rather than bypass the original check.'],
  ], ['Does an unguessable document identifier replace object authorization?', ['No; current rights still need server-side enforcement.', 'Yes; secrecy of the URL is a complete access policy.', 'Only authenticated users can ever guess identifiers.'], 'Identifier entropy can reduce casual discovery but is not a permission decision. Derived reads and revocation paths need the same deliberate boundary as the original object.']),
  'object-storage': activity('Separate uploading bytes from publishing a validated object reference that readers may use.', [
    ['Authorize an upload', 'Issue a bounded upload capability for the intended object and owner, with explicit size and expiry constraints.'],
    ['Verify the object', 'Confirm the expected bytes and required validation before changing authoritative metadata to a usable published state.'],
    ['Manage the lifecycle', 'Handle incomplete uploads, orphan cleanup, retention, and authorized download paths as separate owned operations.'],
  ], ['Does a completed byte upload automatically mean the application should publish the object?', ['No; application validation and metadata publication remain separate.', 'Yes; the upload proves every business invariant.', 'Yes; object storage authorizes all future readers by default.'], 'Storage completion is one boundary. Application ownership, validation, and publication determine whether those bytes become a usable resource. The capacity lab counts payload copies, not multipart or metadata overhead.'], { kind: 'capacity' }),
  'search-indexing': activity('A source document changes while an older indexing event is still in flight.', [
    ['Record source truth', 'Give the document a stable identity and ordered version; the source remains authoritative for content and access.'],
    ['Apply conditional work', 'An index consumer must not let an older event overwrite a later indexed version or resurrect a deletion tombstone.'],
    ['Query within policy', 'Use the derived index for candidates while enforcing the defined freshness and current authorization contract before disclosure.'],
  ], ['What prevents an old indexing event from restoring deleted content?', ['Version-aware publication with an appropriate deletion tombstone policy.', 'Replaying every message unconditionally in arrival order.', 'Treating the index as permanently more authoritative than the source.'], 'Arrival order can differ from source order. Stable versions and deletion semantics let consumers reject obsolete work; access checks still need a current authority.']),
  realtime: activity('Reconnect a message client after it missed an interval of server events.', [
    ['Persist before notify', 'Record the message and its scoped sequence before promising durable acceptance or attempting live delivery.'],
    ['Remember a position', 'The client tracks a recoverable position and deduplicates repeated events according to the conversation ordering contract.'],
    ['Fill the gap', 'Reconnect uses durable history after that position; a live socket alone cannot recover messages sent while disconnected.'],
  ], ['What makes a reconnect recoverable rather than merely connected?', ['A durable history and a scoped resume position.', 'Opening a new socket with no previous position.', 'Assuming notification delivery is durable persistence.'], 'Transport connectivity is transient. Recovery needs retained history, ordering, duplicate handling, and a way to detect a position older than the retention window.']),
  'stream-processing': activity('A late event arrives after a window has already produced an initial result.', [
    ['Choose event time', 'Distinguish the occurrence timestamp from ingestion and processing time before assigning an event to a window.'],
    ['Set a late policy', 'A watermark and allowed lateness express a policy; they do not prove that every earlier event has arrived.'],
    ['Revise or side-route', 'Define whether late evidence updates a result, is rejected, or is sent to a visible separate path with versioned output.'],
  ], ['Does a watermark prove no earlier event can ever arrive?', ['No; it expresses a progress assumption and late-data policy.', 'Yes; it is a global acknowledgement from every source.', 'Yes; processing time and event time are always identical.'], 'Sources, delays, and failures can violate arrival expectations. Consumers need explicit late-data and retraction semantics rather than treating an initial aggregate as immutable truth.']),
  'multi-region': activity('A region becomes unreachable while a second region considers accepting writes.', [
    ['Define the owner', 'State which region owns each write and how the system prevents overlapping authorities during uncertain connectivity.'],
    ['Observe replication', 'Measure which acknowledged versions reached the recovery location; recovery objectives are promises with assumptions, not replica counts.'],
    ['Fence before promote', 'Promotion needs a split-brain prevention strategy and client-routing policy before a new writer is declared authoritative.'],
  ], ['Why is routing clients to another region insufficient for safe write failover?', ['The previous writer may still be alive and must be fenced or otherwise coordinated.', 'DNS automatically transfers every lock and committed byte.', 'Two reachable regions always agree on write order without coordination.'], 'Connectivity observations are incomplete. Safe promotion requires a defined ownership and consistency protocol; changing network routing does not itself revoke the old writer.']),
  migrations: activity('Roll out a field change while old and new application versions coexist.', [
    ['Expand compatibly', 'Introduce a representation old readers and writers can tolerate before depending on new fields or constraints.'],
    ['Backfill with evidence', 'Move historical data in bounded resumable work and validate completeness while concurrent changes continue.'],
    ['Contract deliberately', 'Switch reads and writers after verification, then remove old representation only when rollback and retention policies permit.'],
  ], ['When is removing the old field safe in expand-and-contract?', ['After compatible rollout, validated backfill, and retirement of old dependents.', 'Immediately after adding the replacement column.', 'As soon as a migration command exits successfully.'], 'Schema command success does not establish application compatibility or backfill correctness. Test mixed versions and rollback assumptions before contracting the old surface.'], { kind: 'release-gate' }),
  tradeoffs: activity('Compare two credible designs against a declared workload and identify the assumption that changes the choice.', [
    ['Name the constraint', 'Choose the user behavior or invariant that dominates the decision instead of ranking technologies without a workload.'],
    ['Compare alternatives', 'Show the baseline and a more complex option, including operating cost, failure modes, and migration effort.'],
    ['Seek useful evidence', 'Measure the uncertain quantity that could reverse the choice; avoid presenting many decimal places as stronger assumptions.'],
  ], ['What makes an architectural alternative comparison useful?', ['An explicit condition under which the preferred choice would change.', 'A list of product names with no operation contract.', 'A claim that one design is optimal for every workload.'], 'A conditional choice can be tested and revised. Capacity arithmetic supports that argument only within its declared units, workload, skew, and overhead assumptions.'], { kind: 'capacity' }),
};
