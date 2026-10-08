import type { Problem, WorkedCase } from '../types';

export const additionalSystemDesignProblems: Problem[] = [
  {
    id: 'object-storage', track: 'system-design', title: 'Design a Tenant Object Store', difficulty: 'Medium',
    description: 'Design an object service for private project assets with resumable uploads, versioned reads, and auditable deletion.',
    requirements: ['Support resumable uploads and checksum verification.', 'Publish object versions without exposing incomplete data.', 'Enforce tenant and object authorization.', 'Provide bounded listing pagination and lifecycle cleanup.', 'Explain durability, recovery, and storage amplification.'],
    keywords: [['multipart', 'resumable', 'checksum'], ['version', 'manifest', 'metadata'], ['authorization', 'tenant', 'policy'], ['pagination', 'cursor', 'lifecycle'], ['replication', 'backup', 'durability']],
  },
  {
    id: 'video-delivery', track: 'system-design', title: 'Design an Adaptive Video Service', difficulty: 'Hard',
    description: 'Design private educational video uploads, asynchronous rendition generation, and adaptive playback under a launch-day audience spike.',
    requirements: ['Accept large resumable video uploads.', 'Generate and publish consistent rendition manifests.', 'Deliver segmented playback through an edge cache.', 'Protect private playback and handle revocation.', 'Control transcode retries, backlog, and bandwidth cost.'],
    keywords: [['upload', 'multipart', 'checksum'], ['transcode', 'rendition', 'manifest'], ['cdn', 'segment', 'bitrate'], ['authorization', 'signed', 'token'], ['queue', 'retry', 'idempotency']],
    premium: true,
  },
  {
    id: 'notification-platform', track: 'system-design', title: 'Design a Preference-Aware Notification Platform', difficulty: 'Medium',
    description: 'Design transactional and digest notifications across in-app, email, and mobile push with preferences and provider failures.',
    requirements: ['Accept notification intents with stable identifiers.', 'Apply channel preferences and quiet hours.', 'Separate transactional traffic from bulk campaigns.', 'Track acceptance, provider outcomes, and user-visible status.', 'Bound retries and duplicate delivery without promising exactly-once effects.'],
    keywords: [['idempotency', 'deduplication', 'intent'], ['preference', 'quiet', 'digest'], ['queue', 'priority', 'isolation'], ['provider', 'receipt', 'status'], ['retry', 'backoff', 'dead letter']],
  },
  {
    id: 'payment-ledger', track: 'system-design', title: 'Design a Balanced Payment Ledger', difficulty: 'Hard',
    description: 'Design a marketplace ledger that records balanced money movements, protects available balances, and reconciles ambiguous processor outcomes.',
    requirements: ['Maintain immutable balanced entries in integer minor units.', 'Atomically post transfers and enforce balance constraints.', 'Deduplicate client commands and processor events.', 'Represent pending and ambiguous external outcomes.', 'Reconcile settlements and support auditable corrections.'],
    keywords: [['double entry', 'balanced', 'journal'], ['atomic', 'transaction', 'lock'], ['idempotency', 'unique', 'deduplication'], ['pending', 'unknown', 'reconciliation'], ['audit', 'reversal', 'settlement']],
    premium: true,
  },
  {
    id: 'api-gateway', track: 'system-design', title: 'Design a Multi-Tenant API Gateway', difficulty: 'Easy',
    description: 'Design the entry point for a collection of tenant APIs with routing, authentication, overload protection, and safe retries.',
    requirements: ['Authenticate requests and preserve verified identity downstream.', 'Route by version and service without leaking internal addresses.', 'Apply tenant quotas and global overload protection.', 'Use deadlines and safe retry policies.', 'Observe traffic without logging credentials or sensitive payloads.'],
    keywords: [['authentication', 'token', 'identity'], ['route', 'version', 'discovery'], ['rate limit', 'quota', 'token bucket'], ['deadline', 'timeout', 'idempotency'], ['latency', 'trace', 'redaction']],
  },
  {
    id: 'metrics-platform', track: 'system-design', title: 'Design a Bounded-Cardinality Metrics Platform', difficulty: 'Hard',
    description: 'Design ingestion, time-series storage, and dashboard queries for operational metrics while defending against cardinality explosions.',
    requirements: ['Ingest timestamped samples with tenant isolation.', 'Define duplicate and late-sample behavior.', 'Bound series cardinality and query cost.', 'Retain raw samples and long-lived rollups.', 'Preserve monitoring visibility during overload.'],
    keywords: [['time series', 'labels', 'cardinality'], ['timestamp', 'duplicate', 'late'], ['quota', 'admission', 'limit'], ['rollup', 'retention', 'downsample'], ['lag', 'overload', 'availability']],
    premium: true,
  },
  {
    id: 'search-service', track: 'system-design', title: 'Design a Private Workspace Search Service', difficulty: 'Medium',
    description: 'Design keyword search over tenant documents with asynchronous indexing, permission changes, and safe index rebuilds.',
    requirements: ['Index document changes with explicit freshness bounds.', 'Support ranked results, filters, and bounded pagination.', 'Prevent stale permissions from leaking document content.', 'Handle duplicate and reordered indexing events.', 'Rebuild an index while keeping search available.'],
    keywords: [['index', 'token', 'ranking'], ['cursor', 'filter', 'pagination'], ['authorization', 'permission', 'tenant'], ['version', 'outbox', 'tombstone'], ['rebuild', 'alias', 'migration']],
  },
  {
    id: 'collaborative-editor', track: 'system-design', title: 'Design a Concurrent Text Editor', difficulty: 'Hard',
    description: 'Design live text editing with concurrent inserts, offline reconnects, durable operations, and access revocation.',
    requirements: ['Define convergent semantics for concurrent text operations.', 'Persist acknowledged operations before broadcasting them.', 'Resume disconnected clients from a durable cursor.', 'Compact history without breaking active replicas.', 'Separate ephemeral presence from authorized document changes.'],
    keywords: [['crdt', 'transformation', 'convergence'], ['operation', 'log', 'durable'], ['cursor', 'reconnect', 'snapshot'], ['compaction', 'epoch', 'tombstone'], ['authorization', 'presence', 'membership']],
    premium: true,
  },
  {
    id: 'location-matching', track: 'system-design', title: 'Design Nearby Resource Matching', difficulty: 'Medium',
    description: 'Design a dispatch service that matches requests to nearby available field technicians despite stale locations and concurrent offers.',
    requirements: ['Ingest frequent location updates with freshness checks.', 'Search nearby candidates without scanning every technician.', 'Atomically assign each resource to at most one active task.', 'Expire offers and reject stale worker actions.', 'Protect precise locations and measure matching quality.'],
    keywords: [['geospatial', 'cell', 'distance'], ['timestamp', 'sequence', 'freshness'], ['atomic', 'constraint', 'assignment'], ['lease', 'fencing', 'expiry'], ['privacy', 'authorization', 'match']],
  },
  {
    id: 'webhook-delivery', track: 'system-design', title: 'Design a Reliable Webhook Delivery Service', difficulty: 'Easy',
    description: 'Design outbound tenant webhooks with signed payloads, durable retry scheduling, replay tools, and endpoint isolation.',
    requirements: ['Persist event and delivery intent together.', 'Sign exact payload bytes and support secret rotation.', 'Retry bounded transient failures with stable delivery IDs.', 'Prevent destinations from accessing internal network resources.', 'Expose attempt history and controlled replay without exactly-once claims.'],
    keywords: [['outbox', 'transaction', 'event'], ['signature', 'hmac', 'rotation'], ['retry', 'backoff', 'idempotency'], ['ssrf', 'egress', 'destination'], ['attempt', 'replay', 'dead letter']],
  },
];

export const systemDesignCaseStudies: WorkedCase[] = [
  {
    problemId: 'short-links',
    summary: 'A revocable redirect service separates a small authoritative mapping from a large, cacheable read workload.',
    assumptions: ['Hypothetical workload: 600,000 new links and 60,000,000 redirects per day; peak traffic is eight times average.', 'Redirect p99 target is 120 ms in the serving region; 99.95% monthly successful redirects for valid active links.', 'Owners can edit destinations; emergency abuse blocks must take effect within 30 seconds. Metadata retention is 365 days.'],
    diagram: `Creator -> Auth API -> Mapping DB + outbox
                            |          |
                            v          v
Browser -> Edge redirect -> Cache <- invalidator
                   |           |
                   +-----> Mapping DB
                   |
                   +-----> bounded analytics queue -> aggregates`,
    calculations: [
      { label: 'Average redirect rate', factors: [60000000], divisor: 86400, result: 694.44, unit: 'requests/second', assumption: 'Uniform daily average, not a traffic forecast for the busiest minute.' },
      { label: 'Peak redirect rate', factors: [60000000, 8], divisor: 86400, result: 5555.56, unit: 'requests/second', assumption: 'An explicit eightfold peak multiplier on the average.' },
      { label: 'Annual logical mapping payload', factors: [600000, 365, 320], divisor: 1000000000, result: 70.08, unit: 'GB', assumption: '320 bytes per mapping; decimal GB; excludes indexes, replicas, and analytics.' },
    ],
    sections: [
      {
        title: 'Define link identity and revocation semantics',
        body: `The product is not merely a hash table followed by a redirect. Decide whether links are permanent, editable, private, or subject to takedown before choosing cache policy. Here an owner may change a destination, while readers expect a short public URL to keep working. A random token identifies a mapping but does not authorize edits. Public resolution and authenticated administration are separate endpoints with separate rate limits.\n\nPOST /v1/links accepts destination, optional expiry, and a request key. Store link_id, token, owner_id, destination, version, state, and expires_at. A unique token index arbitrates collisions; generate another token after a conflict instead of trusting collision probability alone. Reject unsupported URL schemes, oversized destinations, and control characters. Avoid normalizing away meaningful query parameters. Never fetch the destination synchronously merely to create a link: that would add latency and an outbound-request security surface.`,
        code: `POST /v1/links
Idempotency-Key: create-451
{"destination":"https://example.org/guide?edition=3"}

links(token UNIQUE, owner_id, destination, version, state, expires_at)
requests(owner_id, request_key, body_hash, response_id, UNIQUE(owner_id, request_key))`,
      },
      {
        title: 'Walk through creation and resolution',
        body: `Creation authenticates the owner, validates the destination, and inserts both the mapping and request record in one transaction. An outbox row announces the new version. Returning success means the database committed, not that analytics or every edge cache is updated. Repeating the same request key returns the same link; repeating it with a different destination is a conflict. This makes a lost creation response recoverable without minting several URLs.\n\nResolution checks an emergency denylist first, then an in-process cache, shared cache, and finally the mapping database. An expired or disabled mapping does not redirect. Return a temporary redirect for editable destinations, with an explicitly bounded cache lifetime; a permanent redirect can become sticky outside the service's control. A cache entry contains version and expiry, so service-side expiry checks do not depend on eviction timing. Record analytics asynchronously and shed those events before sacrificing redirects.`,
      },
      {
        title: 'Make caches subordinate to the mapping',
        body: `An edit uses an expected version, increments it atomically, and commits an invalidation event alongside the update. Without this condition, two browser tabs can silently overwrite one another. An invalidator ignores older events for a token and evicts or replaces the cached value. Invalidation alone is not a proof of freshness: events may lag, consumers may restart, and a cache may be disconnected. The normal maximum stale interval is therefore bounded by a short TTL, with emergency blocks handled by the separate denylist.\n\nNegative caching protects the database from random-token scans, but its TTL must be short enough that a newly created token is not hidden after an earlier miss. Coalesce concurrent misses for one token, add jitter to expiration, and cap database fallbacks. A viral token is a cache-distribution problem, not automatically a reason to shard the authoritative table more finely.`,
      },
      {
        title: 'Recover without confusing availability with correctness',
        body: `If the shared cache fails, serve from healthy local entries and limit fallback concurrency. Unbounded fail-open database reads can turn a cache outage into a database outage. For ordinary editable links, serving an unexpired cached version can preserve availability within the stated freshness budget. For a confirmed abuse block, inability to consult a sufficiently fresh denylist should instead reject resolution. This is a policy-specific partition decision, not a slogan about choosing two properties all the time.\n\nDatabase replication helps survive machine failure, but accidental deletion can propagate to replicas. Keep independent backups and a tested point-in-time restore procedure. Restore into an isolated environment, replay legitimate changes, and verify that removed abusive links do not reappear. Analytics consumers deduplicate event IDs when exact counts matter; sampling and approximate aggregates are acceptable only if the dashboard labels them clearly.`,
      },
      {
        title: 'Defend the public surface and measure user outcomes',
        body: `A public redirect service attracts phishing, enumeration, and traffic amplification. Creation limits should combine owner quotas with network signals, while allowing legitimate enterprise imports through a controlled bulk path. Administrative reads and mutations verify ownership on every object access. An unguessable token is not a substitute for that check. Abuse reviewers need audited takedown access, not a general ability to browse all destination metadata.\n\nMeasure redirect success and latency by region, cache hit rate, stale-version detections, denylist age, and fallback saturation. A high cache hit ratio can conceal widespread wrong destinations, so synthetic checks should resolve known links after edits and expiry. Keep destination query strings and visitor identifiers out of routine logs. Track analytics loss separately from redirect errors, because they represent different promises. Alert on creation conflicts and unusual miss ratios that could indicate token scanning.`,
      },
      {
        title: 'Choose scale and alternatives deliberately',
        body: `The capacity estimates imply a modest metadata store but a read path that needs careful caching. Database indexes, write-ahead logs, and replicas add physical bytes beyond the logical estimate. Partition mappings by token hash only after a single database approaches measured limits; owner-based partitioning helps administration but can produce hot tenant partitions. A secondary owner index supports listing without scanning tokens. Analytics storage may grow faster than mapping storage and deserves independent retention.\n\nA monotonic numeric identifier encoded compactly simplifies uniqueness but makes discovery easier and may reveal business volume. Random tokens trade that property for collision checks. Fully immutable links allow longer edge caching and cheaper operation, but fail the owner's edit requirement. Global active-active edits require explicit conflict semantics; a home-region write authority with global cached reads is simpler for this workload. Cross-region latency and disaster recovery objectives remain separate from the regional redirect SLO.`,
      },
    ],
    followUps: [
      { question: 'What happens if the database commit succeeds but the client receives a timeout?', answer: 'The client repeats the owner-scoped request key. The server looks up the stored request hash and response identifier, verifies the body matches, and returns the original mapping. If the first transaction is still running, the unique request constraint serializes competing attempts. Do not use a fresh key just because the response was lost. The mapping and request record must share a transaction; a separate best-effort request cache would leave a duplicate-creation window.' },
      { question: 'Can you guarantee immediate revocation from every browser?', answer: 'No. A browser or intermediary that already cached a redirect may act without contacting us, and a user can copy the destination. Short cache lifetimes reduce exposure but do not retract knowledge. The service can promise a bounded response change for requests reaching its controlled edge, backed by denylist propagation monitoring. Highly sensitive access belongs behind destination authorization, not behind possession of a public short URL.' },
      { question: 'How would you test a viral-link failure?', answer: 'Drive a skewed workload where one token dominates, expire its cache entry, and interrupt shared-cache access. Verify miss coalescing, local-cache behavior, and bounded database concurrency rather than only aggregate throughput. Then edit and block that token during the test to expose stale-serving policy errors. Record p99 latency and rejection rates at each stage. The experiment should include cold replicas and invalidation lag, since a warm-cache benchmark hides the dangerous recovery path.' },
    ],
    lessonIds: ['requirements', 'capacity-estimation', 'caching', 'http-caching', 'security', 'reliability'],
    sourceIds: ['http-semantics', 'http-cache', 'redis-eviction', 'owasp-object-auth', 'pg-recovery'],
  },
  {
    problemId: 'document-sync',
    summary: 'An offline file-sync service publishes immutable file versions through an authorized metadata change log.',
    assumptions: ['Hypothetical workload: 200,000 active devices, 12 committed changes per device per day, and 1 MB average new file bytes per change.', 'Metadata commit p99 target is 300 ms excluding upload time; connected devices should discover changes within five seconds.', 'Offline devices may reconnect after 30 days; concurrent binary-file edits produce explicit conflicts rather than silent merging.'],
    diagram: `Device -> Upload grants -> Immutable object store
   |                               |
   +-> Commit API -> Metadata DB <-+
                       |
                 transactional outbox
                       |
                 workspace change log -> wakeup channel
                       ^
Device -> cursor-based sync --------+`,
    calculations: [
      { label: 'Average metadata changes', factors: [200000, 12], divisor: 86400, result: 27.78, unit: 'changes/second', assumption: 'Daily average across devices; uploads and downloads are additional requests.' },
      { label: 'Daily logical new file bytes', factors: [200000, 12, 1000000], divisor: 1000000000, result: 2400, unit: 'GB/day', assumption: 'Decimal 1 MB new data per change before deduplication, version retention, or replication.' },
      { label: 'Hypothetical replicated daily bytes', factors: [200000, 12, 1000000, 3], divisor: 1000000000, result: 7200, unit: 'GB/day', assumption: 'Three full copies in a self-managed design, not a claim about managed object-store internals.' },
    ],
    sections: [
      {
        title: 'Separate file contents from file identity',
        body: `A synced document has a stable file identifier even when its path or contents change. Paths belong to workspace metadata; content versions refer to immutable objects. This prevents a rename from forcing a large upload and lets readers pin a version while another device writes. Model files with workspace_id, file_id, parent_id, name, current_version, and deletion state. Model versions with version_id, blob_key, checksum, size, author, and base_version.\n\nThe client maintains a local manifest and durable outgoing journal, not just an in-memory list of filesystem events. Events can be duplicated or coalesced by an operating system watcher. A client first computes what changed relative to its manifest, then creates a stable operation ID. Conflict handling is part of the product: binary files retain competing versions for user resolution, while rename conflicts receive a deterministic visible suffix rather than silently displacing another file.`,
        code: `POST /workspaces/w7/uploads
{"fileId":"f12","bytes":1000000,"checksum":"sha256:..."}

POST /workspaces/w7/files/f12/versions
{"operationId":"device9-88","baseVersion":14,"uploadId":"u51"}

GET /workspaces/w7/changes?after=cursor_140&limit=200`,
      },
      {
        title: 'Publish a version only after verified upload',
        body: `The server authorizes the workspace and issues a bounded upload grant for a server-selected staging key. A device uploads content directly, resumes interrupted parts, and submits a completion request. The service verifies object existence, expected length, checksum evidence, and grant ownership before publishing metadata. An object upload and database commit are not one distributed transaction. Upload first, then atomically create the version, advance the file pointer, record the operation result, and append the metadata change or its outbox intent.\n\nA reader fetches changes after its cursor, updates the local manifest, and downloads exact immutable versions. It writes to a staging file, verifies the checksum, then atomically replaces the local visible file when supported. Advance the local cursor only after the corresponding manifest update is durable. Push notifications merely wake the client; the persistent change stream, not the websocket, is the recovery mechanism.`,
      },
      {
        title: 'Handle conflicting commits and ordered discovery',
        body: `Commit compares base_version with the current file version under a database transaction. Two devices that edited version fourteen cannot both unconditionally replace it. One succeeds; the other creates a recorded conflict branch or receives a conflict response with both version references. The operation identifier has a tenant-scoped unique constraint so a retry does not create another conflict artifact. Directory moves also check for cycles and unique sibling names within the same transactional boundary.\n\nWorkspace change cursors must not assume sequence numbers equal commit order. A transaction can allocate an early number and commit late. Use a serialized per-workspace append point or a commit-ordered log, and return only a safe published high-water mark. Cursor pages include tombstones, not merely currently existing files. Otherwise an offline device cannot discover deletions and may resurrect them during its next upload.`,
      },
      {
        title: 'Make offline recovery and garbage collection compatible',
        body: `Retain change history for the promised reconnect interval, then require an authoritative snapshot when a cursor is too old. Build the snapshot at a defined workspace high-water mark and replay subsequent changes. Do not mix a live directory listing with an unrelated cursor: files could move between pages and disappear from the result. A device reports acknowledged progress, but abandoned devices cannot retain all history forever; expiry and reinitialization are explicit protocol states.\n\nUnpublished uploads are garbage after a grace period that exceeds valid grant and retry windows. Published versions remain referenced until retention and conflict rules release them. Garbage collection marks candidates, rechecks references, and deletes later so it cannot race a delayed commit. A missing blob is a correctness incident, not an invitation to return the newest different version. Metadata backups must be coordinated with retained objects to make restore useful.`,
      },
      {
        title: 'Protect access without breaking efficient transfer',
        body: `Every metadata request checks workspace membership and the requested file's scope. Signed download grants bind to a precise immutable object, expiration, and allowed operation. Revocation cannot cancel bytes already downloaded, so local-device policy and server authorization solve different problems. Content hashes enable deduplication, but global hash-existence APIs can reveal whether another tenant possesses a sensitive file. Prefer tenant-scoped deduplication unless the privacy and accounting implications are deliberately addressed.\n\nTrack metadata commit latency, upload completion failures, change-log age, cursor resets, conflict rates, and missing-object checks. Network bandwidth and client disk capacity frequently dominate database throughput. Apply workspace storage quotas before issuing grants and reconcile reserved bytes after abandoned uploads expire. Encrypt transport, minimize path and filename logging, and audit privileged exports. Malware scanning may delay sharing while still allowing an owner to see the upload's pending state.`,
      },
      {
        title: 'Choose limits and an appropriate consistency boundary',
        body: `The workload creates terabytes of logical content daily despite modest metadata writes. Version retention, full-file rewrites, and downloads by several devices amplify cost. Chunked transfer can reduce repeated bytes for large files, but it introduces chunk manifests, reference counting, and small-object overhead. Start with whole-file immutable versions for ordinary office documents and add chunking only after measuring change distributions. A delta algorithm cannot safely substitute for checksum verification of the final reconstructed file.\n\nPartition metadata by workspace because listings, permissions, and change order share that boundary. Very large workspaces may require a separate change-log partition and carefully scoped directory transactions. Multi-region read replicas can serve old metadata if clients tolerate bounded lag; conflicting writes still need a home authority or a defined merge model. This design synchronizes files, not keystrokes. A live collaborative editor requires a different operation model and should not be implied by fast file propagation.`,
      },
    ],
    followUps: [
      { question: 'Why not use object listing as the synchronization protocol?', answer: 'Object keys do not by themselves encode workspace permissions, moves, conflict branches, or the application cursor contract. Supported S3 object operations have strong consistency, but that does not make a listing and several metadata changes one transaction. Use the metadata change log as the authoritative protocol and object storage for immutable bytes. Listing can assist audits and garbage collection without deciding which version a client should display or which deletion it has acknowledged.' },
      { question: 'What happens when an upload succeeds but version publication fails?', answer: 'The uploaded object remains staged and invisible to normal readers. The client retries the same operation ID, allowing the server to revalidate and publish it once or report the recorded result. A cleanup worker removes unreferenced staging data only after the retry window and a reference recheck. This leaks bounded temporary storage rather than exposing incomplete files. If publication succeeded but its response was lost, the operation record points to the already published version.' },
      { question: 'How do you recover a device that missed forty days of changes?', answer: 'Return a cursor-expired response and obtain a consistent manifest snapshot at a known high-water mark. Compare it with the local manifest without deleting unsent local edits. Those edits remain in the outgoing journal and may become conflicts against newer server versions. Install the snapshot, replay later changes, and advance the durable cursor. A reset is a state-reconciliation workflow, not simply deleting the local directory and hoping the user kept another copy.' },
    ],
    lessonIds: ['object-storage', 'data-modeling', 'transactions', 'realtime', 'reliability', 'security'],
    sourceIds: ['s3', 'pg-isolation', 'outbox', 'owasp-object-auth', 'pg-recovery'],
  },
  {
    problemId: 'ticket-reservations',
    summary: 'A seat-sale service enforces ownership in the database while treating payment confirmation as an asynchronous, potentially ambiguous workflow.',
    assumptions: ['Hypothetical event has 40,000 numbered seats and 100,000 visitors attempting purchase during a five-minute release.', 'Each visitor makes three hold requests on average; successful hold requests target p99 below 500 ms after admission.', 'Holds last five minutes. The invariant is at most one confirmed owner per event and seat; payment completion has a separate deadline.'],
    diagram: `Buyers -> waiting room -> Hold API -> Seat ownership DB
                                       |          |
                                       |       outbox
                                       v          v
                                  Payment worker -> processor
                                       ^
Processor webhook -> inbox -> confirmation transaction
Expiry worker -> conditional release -> Seat ownership DB`,
    calculations: [
      { label: 'Release-window hold attempt rate', factors: [100000, 3], divisor: 300, result: 1000, unit: 'requests/second', assumption: 'Average within the five-minute sale window, not the first-second peak.' },
      { label: 'Seat ownership logical bytes', factors: [40000, 256], divisor: 1000000, result: 10.24, unit: 'MB', assumption: '256 bytes per seat row; decimal MB; excludes indexes, history, and replicas.' },
      { label: 'Maximum five-minute admitted holds', factors: [40000], divisor: 300, result: 133.33, unit: 'holds/second', assumption: 'A ceiling averaged across the window if each seat is held once; retries and churn increase attempts.' },
    ],
    sections: [
      {
        title: 'Model ownership rather than cached availability',
        body: `A seat map is a useful read projection, not an allocation authority. Buyers may see a seat as available and still lose a race. Store one ownership row for each event and seat, with state, hold_id, holder_id, lease_until, and generation. A primary key on event_id and seat_id ensures one row exists; a separate booking-seat uniqueness constraint protects confirmed ownership. A request can ask for several seats, which this design treats as all-or-nothing within one database shard.\n\nPOST /events/e8/holds accepts seat IDs and a buyer-scoped idempotency key. Return an opaque hold ID, expiry time, and status endpoint. The hold ID does not confer ownership: subsequent checkout and cancellation authorize the authenticated buyer. Explain that expiry is evaluated by the authoritative database clock. A countdown in the browser is informative and cannot decide whether a hold is still valid.`,
        code: `UPDATE seats
SET state='held', hold_id=:hold, holder_id=:buyer,
    lease_until=:until, generation=generation+1
WHERE event_id=:event AND seat_id=:seat
  AND (state='available' OR (state='held' AND lease_until < now()))
RETURNING generation;

-- Execute for all requested seats in a transaction; roll back if any fail.
-- Lock seats in stable seat_id order to reduce deadlock risk.`,
      },
      {
        title: 'Walk through a hold and a purchase',
        body: `Admission control assigns buyers a waiting-room token and limits concurrent database work. After authentication, the hold transaction locks requested seat rows in a deterministic order, verifies every seat is available or reclaimable, creates the hold and request record, and updates ownership. The conditional predicate is checked at the write boundary. A prior SELECT followed by unconditional UPDATE is insufficient under concurrency. Return success only after commit; cached seat maps update asynchronously.\n\nCheckout verifies the active hold and generation, then records a payment attempt and outbox event. A worker calls the processor using a stable attempt key. During the checkout window, ownership moves into a distinct payment-pending state with a bounded reconciliation policy. On an authoritative successful outcome, a transaction confirms the booking only if the expected ownership generation still matches. The browser reads booking status from this state machine rather than interpreting a processor redirect as a final ticket.`,
      },
      {
        title: 'Fence stale expiry and confirmation work',
        body: `An expiry worker must update only the hold and generation it observed. Imagine worker A pauses while worker B expires a hold and a new buyer acquires the seat. If A later releases the seat without checking generation, it destroys the new ownership. The same problem affects delayed payment callbacks. Include expected hold_id and generation in conditional transitions; a stale operation affects zero rows and is investigated or ignored according to its type.\n\nA database constraint is the final protection against duplicate confirmed seat allocation. Redis locks can reduce duplicate work but cannot replace that invariant. When serializable transactions are used for broader group rules, retry complete transactions on serialization failures with the original request identity. Avoid holding database locks while calling a payment provider. That converts external latency into ownership contention and still does not make the provider part of the database transaction.`,
      },
      {
        title: 'Resolve uncertain money outcomes explicitly',
        body: `A timed-out processor call may have charged the buyer. Record unknown outcome rather than automatically releasing ownership and initiating a second charge. Query the provider with its stable reference, accept verified asynchronous events through a deduplicated inbox, and reconcile outstanding attempts. If the business chooses to release a seat before certainty, a later successful charge requires a refund or manual resolution; it must not steal the seat from its new owner.\n\nPublisher confirmation means the payment command reached a durable broker configuration, not that money moved or a ticket was issued. A worker acknowledges only after persisting its outcome or recoverable next state. Duplicate deliveries are expected. Provider idempotency retention and semantics must be understood; retries outside that window need reconciliation rather than blind replay. Cancellation, refund, and ticket issuance are distinct states with their own audit records and compensation rules.`,
      },
      {
        title: 'Survive the sale while preserving fairness',
        body: `The release-window request estimate is already much larger than the maximum rate of new seat ownership. Most work may be rejected races, retries, and bots. A waiting room protects scarce write capacity and gives the product an explicit fairness policy. Bind admission tokens to a session, expire them, cap seat count per buyer, and detect account farms. Do not trust a client-supplied queue position. Use cacheable seat-map snapshots with visible freshness and avoid polling every seat individually.\n\nObserve hold conflicts, transaction lock waits, payment-pending age, stale-generation rejections, and the invariant count of duplicate seat assignments. Separate legitimate sold-out responses from server failures in the availability SLI. Audit administrative releases and ticket transfers. Limit personally identifiable information in event logs. Test clock skew at clients, expiry-worker pauses, callback reorderings, and database failover during checkout, because those expose correctness failures that ordinary throughput tests miss.`,
      },
      {
        title: 'Scale by event and acknowledge product boundaries',
        body: `Partition by event to keep a multi-seat purchase atomic. Large single events remain hot even if there are many shards, so additional generic sharding does not remove row contention on popular seats. Split admission and read distribution from allocation. A single-writer event allocator can make order easier to reason about, but needs durable commands, failover fencing, and bounded queueing; it is not automatically simpler than transactional ownership rows.\n\nGeneral-admission inventory uses an atomic remaining-capacity update plus a booking record, not one row per seat. Cross-event bundles require either a shared transactional boundary or an explicit reservation-and-compensation workflow. During a partition, this design stops authoritative allocations if safe ownership cannot be established while still serving clearly stale seat maps. That sacrifices some purchase availability to preserve the no-double-sale promise. Backups, reconciled payment state, and ticket validation records are necessary for recovery; replicas alone do not cover operator mistakes.`,
      },
    ],
    followUps: [
      { question: 'Can a five-minute Redis lock guarantee no seat is sold twice?', answer: 'No. Lock expiry, network partitions, and paused workers can permit overlapping owners. Keep authoritative ownership transitions and the confirmed-seat uniqueness constraint in the database. A lease can coordinate work, but each action also carries a generation that the protected storage checks. If a lock is only an optimization, losing it should increase redundant attempts rather than break allocation correctness. Demonstrate this by pausing an old worker past lease expiry and attempting its stale update.' },
      { question: 'What if payment succeeds after the seat has been released?', answer: 'Record the late success against the original payment attempt, reject confirmation when ownership generation no longer matches, and enter compensation. Usually that means refunding or providing a controlled alternative with user communication. The system must not silently issue a duplicate ticket or overwrite a later booking. A pending-payment grace policy reduces this scenario, but cannot remove all external ambiguity. Finance and support need an auditable link between the original charge, release decision, and compensation result.' },
      { question: 'How do two concurrent requests for the same three seats behave?', answer: 'Both acquire row locks in the same seat order. The winner verifies availability and commits the full set. The loser then sees the updated state and rolls back its entire attempted hold. A buyer-scoped request key deduplicates retries of either request. Deadlocks can still occur through other transaction paths, so retryable errors remain part of the API. Return a clear conflict with a refreshed selection option, not a partially successful three-seat purchase unless the product explicitly supports it.' },
    ],
    lessonIds: ['transactions', 'data-modeling', 'queues', 'rate-limiting', 'reliability', 'tradeoffs'],
    sourceIds: ['pg-isolation', 'stripe-idempotency', 'stripe-webhooks', 'rabbitmq-acks', 'sre-overload'],
  },
  {
    problemId: 'team-chat',
    summary: 'Durable per-room message history supports reconnectable chat, while presence and typing remain disposable realtime signals.',
    assumptions: ['Hypothetical workload: 300,000 daily active users sending 40 messages each; peak send rate is six times average.', 'Average stored message envelope is 700 bytes before indexes and attachments; retention is 180 days.', 'Committed messages target regional p99 below 250 ms; online fanout target is one second, with cursor-based catch-up after disconnects.'],
    diagram: `Clients -> Gateway -> Message API -> room history DB
   ^           |                         |
   |           | presence                +-> outbox -> room event bus
   |           v                                          |
   +-------- realtime fanout <----------------------------+
Clients -> History API -> authorized room cursor pages
Attachments -> scoped grants -> object store`,
    calculations: [
      { label: 'Average message writes', factors: [300000, 40], divisor: 86400, result: 138.89, unit: 'messages/second', assumption: 'Daily average; typing, reads, and fanout are separate traffic.' },
      { label: 'Peak message writes', factors: [300000, 40, 6], divisor: 86400, result: 833.33, unit: 'messages/second', assumption: 'Sixfold hypothetical peak multiplier.' },
      { label: 'Logical retained message bytes', factors: [300000, 40, 700, 180], divisor: 1000000000, result: 1512, unit: 'GB', assumption: 'Decimal GB; excludes attachments, secondary indexes, replicas, and edit history.' },
    ],
    sections: [
      {
        title: 'Specify ordering, acknowledgment, and membership',
        body: `Users need durable history and sensible ordering within a room; they do not need one total order across unrelated rooms. Define a server-assigned room sequence that advances at the room's serialized commit point. A message contains room_id, sequence, message_id, sender_id, client_message_id, body, and revision. A unique sender-and-client identifier makes a retried send return the same message instead of creating a duplicate. It does not allow the sender to impersonate another member.\n\nPOST /rooms/r4/messages authenticates the sender and checks current membership. A successful response means the message is durable, not that every recipient has displayed it. GET /rooms/r4/messages?after=218 returns an ordered bounded page and a high-water mark. Edits and deletes produce versioned history events, so reconnecting clients can update previously seen messages. Decide retention and administrator visibility before promising permanent history.`,
        code: `POST /rooms/r4/messages
{"clientMessageId":"phone-72","body":"Review starts at 14:00"}

messages(room_id, sequence, message_id, sender_id, body, revision)
UNIQUE(room_id, sequence)
UNIQUE(room_id, sender_id, client_message_id)
membership(room_id, user_id, role, access_epoch)`,
      },
      {
        title: 'Follow a message from commit to several devices',
        body: `The message API verifies membership, allocates room order under the chosen serialization boundary, and inserts the message plus outbox row atomically. The response gives the authoritative sequence and ID. A publisher later places the event on a room-partitioned stream. Fanout workers find gateways with interested connections and deliver the event; each client deduplicates by message ID and orders by sequence. A missing sequence triggers history fetch rather than assuming the socket stream is complete.\n\nA reconnecting device supplies its durable room cursor. The gateway establishes a catch-up boundary, retrieves history through that boundary, and then continues live events. If live subscription begins before history fetch, buffer and deduplicate the overlap. If it begins afterward without a boundary, messages can fall into the gap. Read receipts are separate per-user maximum-seen sequences, updated monotonically across devices rather than moving backward when an old phone reconnects.`,
      },
      {
        title: 'Treat realtime state and durable state differently',
        body: `Presence and typing indications expire automatically and may be lost. Persisting every keystroke or presence heartbeat would inflate the durable workload without improving the core message guarantee. Gateways maintain local connections and a bounded shared registry with heartbeat expiry. A crashed gateway's entries disappear after a lease interval; clients reconnect with jitter to avoid a coordinated surge. Slow clients receive bounded buffers and then a resync instruction, not unlimited server memory.\n\nRoom membership changes are durable. Revocation increments an access epoch and invalidates gateway subscriptions, but history endpoints still check current permissions. Cached membership has an explicit freshness policy. A websocket authenticated at connection time is not permanently authorized to every later room event. Attachment download grants also expire and bind to an authorized immutable object. Deleting a chat message cannot retract an attachment that a recipient already downloaded.`,
      },
      {
        title: 'Recover duplicates, ordering gaps, and storage failures',
        body: `Outbox publication can repeat after a crash between broker acceptance and marking the row published. Consumers therefore deduplicate or apply monotonic versions. Broker partition order helps with room events but does not repair a publisher that emits database changes in the wrong commit order. Read authoritative history when a gap or conflicting revision appears. A room sequencer that fails over needs an ownership generation checked by its storage writes, so an old leader cannot keep appending.\n\nIf fanout fails, message sends can remain available while users see a delayed-delivery indicator and poll history. If authoritative storage is unavailable, do not acknowledge new durable messages from gateway memory. Backups and tested recovery preserve history after destructive changes; replication covers different failure modes. Retention jobs remove messages and attachment references carefully, keeping tombstones long enough for clients to converge and respecting legal holds where the product requires them.`,
      },
      {
        title: 'Bound fanout and observe the room experience',
        body: `The write-rate calculation hides the main scaling multiplier: recipients. A thousand-member room can turn one write into hundreds of active deliveries. Track active subscribers rather than all members, aggregate gateway routing, and avoid one broker message per offline user. A very large announcement room may use a shared recent-event cache with client pull instead of direct per-member fanout. Per-room send limits and attachment quotas keep one tenant from exhausting the shared system.\n\nObserve commit latency, commit-to-gateway lag, reconnect gap frequency, queue age, slow-client disconnects, and membership invalidation age. Delivery metrics should distinguish broker acceptance, gateway receipt, device acknowledgment, and user read state. These are not interchangeable. Avoid message bodies in routine traces and audit moderator actions. Authorization tests should include removed members, guessed room IDs, cross-tenant attachment keys, and edits attempted by someone other than the sender.`,
      },
      {
        title: 'Evaluate ordering and encryption alternatives',
        body: `A relational room log is an effective starting point at this workload and supports atomic membership checks with message writes. Partition by tenant or room when measurements demand it, while keeping room order local. A hot room remains a concentrated sequencing bottleneck; batching can improve throughput but adds latency. Time-sortable identifiers are useful for indexing, yet clock skew means they do not alone establish a reliable room commit order.\n\nEnd-to-end encryption changes server-side search, moderation, attachment scanning, and key distribution. It cannot be added as a label without redesigning those features and handling membership key rotation. A purely ephemeral chat product could skip durable history, but that is a different requirement. Multi-region active-active writes can offer lower latency while introducing reconciliation and ordering choices. A room home region with replicated read history gives a simpler correctness story, at the cost of remote sender latency and controlled failover.`,
      },
    ],
    followUps: [
      { question: 'Does a websocket guarantee that no messages were missed?', answer: 'No. It is a transport connection, not a durable subscription cursor. A disconnect, gateway crash, buffer overflow, or membership transition can create gaps. Clients persist the highest contiguous room sequence and fetch authoritative history after reconnect or a detected gap. A reconnect protocol deliberately overlaps catch-up and live delivery, deduplicating by message ID. The server should expose resync-required explicitly when retained history no longer covers the requested cursor.' },
      { question: 'How do you avoid duplicate messages from two devices retrying?', answer: 'Each intentional send gets its own stable client_message_id scoped to the sender and room. Retries of that send reuse the ID, and the database unique constraint returns the original committed result. Two devices composing different messages must not share identifiers merely because the text matches. Server fanout also carries a stable message ID so recipients can deduplicate repeated events. Text equality is not a deduplication rule; people legitimately send the same message more than once.' },
      { question: 'Why not write directly to Kafka and call that the chat database?', answer: 'A durable partitioned log can be a sound authority if the design also specifies membership enforcement, idempotent append, history indexing, retention, and materialized-view recovery. It does not remove those responsibilities. Kafka transactions have a scoped processing model and do not make websocket delivery exactly once. For this workload, a database plus outbox keeps permission and message commit boundaries easier to explain. A log-first alternative becomes compelling when sustained append scale and replay needs justify its operational complexity.' },
    ],
    lessonIds: ['realtime', 'transactions', 'event-streams', 'sharding', 'observability', 'security'],
    sourceIds: ['outbox', 'kafka-design', 'pg-isolation', 'owasp-object-auth', 'sre-monitoring'],
  },
  {
    problemId: 'activity-feed',
    summary: 'A hybrid feed materializes ordinary authors into follower inboxes while merging high-fanout authors at read time.',
    assumptions: ['Hypothetical workload: 1,000,000 daily active readers, 20 feed opens each, and 200,000 new posts per day.', 'Ordinary authors have 150 followers on average; a small high-fanout set is excluded from that average.', 'Feed p95 target is 200 ms regionally; ordinary new posts should appear within ten seconds, but permission revocation must be checked on reads.'],
    diagram: `Author -> Post API -> post DB + outbox -> fanout workers
                                              |           |
                                              |       inbox store
                                              v           |
                                      high-fanout log      |
Reader -> Feed API -> merge candidates <-------------------+
                          |
                    authorize + hydrate -> ranked page`,
    calculations: [
      { label: 'Average feed opens', factors: [1000000, 20], divisor: 86400, result: 231.48, unit: 'requests/second', assumption: 'Daily average excludes pagination and background refreshes.' },
      { label: 'Ordinary daily inbox references', factors: [200000, 150], divisor: 1, result: 30000000, unit: 'references/day', assumption: 'Assumes all estimated posts are ordinary-author posts for a conservative baseline; celebrity fanout excluded.' },
      { label: 'Thirty-day logical inbox references', factors: [200000, 150, 30, 40], divisor: 1000000000, result: 36, unit: 'GB', assumption: '40-byte reference for 30 days; excludes storage-engine overhead, replicas, and post bodies.' },
    ],
    sections: [
      {
        title: 'Define what a feed page promises',
        body: `A feed is a derived view over posts, relationships, and access rules. This design begins with reverse chronological candidates and a simple optional ranking pass, not an unexplained machine-learning box. Each page exposes a stable cursor and a snapshot boundary. New posts appear on refresh rather than being inserted above a scrolling reader and displacing items between pages. The service promises bounded freshness, not a single globally consistent view across every follower.\n\nStore posts with author_id, post_id, creation time, visibility, version, and deletion state. Store follow edges separately, with a uniqueness constraint on follower and author. An inbox contains post references, not copies of private post text. POST /posts accepts a request key; GET /feed?cursor=... returns visible hydrated candidates. Decide whether a new follow backfills recent posts and whether unfollow immediately removes old entries, because those rules determine both write cost and filtering.`,
        code: `posts(post_id, author_id, created_at, visibility, version, state)
follows(follower_id, author_id, created_at, UNIQUE(follower_id, author_id))
inbox(reader_id, post_id, sort_key, UNIQUE(reader_id, post_id))

GET /feed?limit=30&cursor=snapshot_912_last_885
-> {"items":[...],"nextCursor":"...","freshnessSeconds":4}`,
      },
      {
        title: 'Trace a post into an ordinary follower feed',
        body: `The post transaction creates the authoritative record and an outbox intent. A worker expands the author's follower list in bounded pages and inserts inbox references idempotently. Store progress for the fanout job, because a worker can crash halfway through millions of recipients. Marking a job complete before its final writes would strand some followers; repeating pages is safe because reader-and-post uniqueness removes duplicates. The API returns committed post status without waiting for every inbox.\n\nA reader retrieves recent inbox candidates and recent posts from followed high-fanout authors, merges them by the chosen sort key, deduplicates post IDs, and hydrates authoritative bodies. It then applies current visibility and relationship checks. Fetch more candidates when filters remove items, but enforce a maximum scan budget. Sparse results are preferable to an unbounded expensive query. Return freshness information when fanout lag is significant instead of concealing a degraded pipeline.`,
      },
      {
        title: 'Handle celebrity authors and relationship races',
        body: `Fanout-on-write makes ordinary reads cheap, but one author with millions of followers can dominate worker capacity. Classify authors by measured active-follower cost and move expensive authors to fanout-on-read. Keep recent posts for that set in compact author timelines. The threshold depends on post rate, follower activity, and storage cost, not just a fixed follower count. Switching strategies requires overlap and deduplication so readers do not miss posts during migration.\n\nA follow concurrent with publication raises a product question: which posts should the new follower see? Use a documented backfill window rather than trying to make an asynchronous expansion magically atomic with every relationship change. Unfollow and private-account revocation are enforced at read time even if inbox deletion is delayed. Block relationships override candidate inclusion. Versions prevent an older visibility event from resurrecting a newer private or deleted post.`,
      },
      {
        title: 'Recover derived state without reviving deleted content',
        body: `Inbox stores can be rebuilt from retained posts and relationship history within the supported window. They are not the sole copy of content. A deleted post becomes an authoritative tombstone first, then is removed from inboxes and search projections. Cached post bodies carry versions and short lifetimes; authorization and deletion checks remain necessary before returning sensitive text. Do not assume a queued removal instantly reaches every cache.\n\nWhen fanout falls behind, reserve capacity for fresh interactive posts and rate-limit bulk imports. Replay workers use a separate budget so recovery does not overwhelm serving storage. Preserve the oldest outstanding-job age as an operational signal. Database backups retain the content authority, while projection snapshots only accelerate restoration. A partially rebuilt feed should be labeled degraded and can fall back to direct recent-author reads for a limited set rather than issuing unlimited scatter-gather requests.`,
      },
      {
        title: 'Keep ranking, privacy, and measurement explicit',
        body: `Ranking can reorder candidates by recency, relationship strength, and engagement, but its inputs and version should be logged without storing private text. A stable page cursor pins the ranking snapshot or candidate boundary; otherwise score changes can cause repeats and omissions. Avoid treating engagement counts as strongly consistent counters when they are asynchronous aggregates. A modest stale count is acceptable for ranking but not for authorization.\n\nMeasure feed latency, empty-page rate, candidate rejection ratio, fanout lag, high-fanout merge cost, and duplicate suppression. Add synthetic private-post and block tests to verify that fast pages are also safe pages. Rate-limit posting, following, and expensive refreshes independently. A coordinated follow storm can create much more work than its HTTP request volume suggests. Audit moderator changes and use tenant or account boundaries for any private organizational feeds. Cursor contents must not expose another reader's identifiers or allow arbitrary backend offsets.`,
      },
      {
        title: 'Compare storage amplification with read amplification',
        body: `The thirty-million-reference estimate shows why post volume alone is a misleading capacity measure. Inbox retention and active-user targeting reduce amplification; cold users can reconstruct recent feeds on demand. Partition inboxes by reader for efficient pagination, and posts by author or stable ID for hydration. Batch fetches by partition and cap the number of high-fanout timelines merged for one page. One reader following thousands of celebrities can be a read hotspot even when every author timeline is healthy.\n\nPure fanout-on-read eliminates inbox writes but increases query cost and tail latency. Pure fanout-on-write simplifies reads but makes high-fanout publishing and relationship changes expensive. A hybrid earns its complexity when the workload has strong skew. Globally ordered feeds require more coordination than this product needs. Cross-region projection lag can be tolerated for ordinary freshness, while sensitive access checks should reach a sufficiently current authority or conservatively omit uncertain candidates.`,
      },
    ],
    followUps: [
      { question: 'How do you stop a deleted private post leaking from an old inbox?', answer: 'An inbox reference is only a candidate. Hydration consults current post state and current access rules before returning content. Deletion creates a tombstone and invalidation event, while asynchronous cleanup removes references later. A cache cannot be the sole permission authority. If the access authority is unavailable, private candidates are omitted or the request fails according to policy. Public stale content may have a different budget, but that exception must not accidentally apply to private posts.' },
      { question: 'How would you change an author from write fanout to read fanout?', answer: 'Record a strategy version and transition boundary, start the read-time path before stopping inbox expansion, and deduplicate overlapping post IDs. Keep enough recent author history to cover existing page windows. Observe readers for missing boundary posts and compare shadow results before finalizing the switch. Do not simply flip a boolean while queued fanout jobs remain ambiguous. The reverse transition requires controlled backfill and the same overlap discipline, with a storage and worker budget.' },
      { question: 'Can Kafka transactions guarantee every follower receives a post once?', answer: 'They can scope atomic processing and offset updates inside Kafka when configured appropriately, but inbox databases and client displays are external effects. Store stable post IDs, make inbox insertion idempotent, and track job progress durably. Client responses also deduplicate candidates. The user-visible goal is one displayed post with recoverable gaps, not a claim that every network callback executed exactly once. Consumer crashes and rebalances should be tested against the actual inbox sink, not only the broker.' },
    ],
    lessonIds: ['queues', 'event-streams', 'caching', 'sharding', 'security', 'tradeoffs'],
    sourceIds: ['outbox', 'kafka-design', 'owasp-object-auth', 'sre-overload', 'pg-indexes'],
  },
  {
    problemId: 'job-scheduler',
    summary: 'A durable scheduler separates due-time selection, broker acceptance, worker ownership, and business completion.',
    assumptions: ['Hypothetical workload: 5,000,000 jobs created per day, with a fourfold due-time burst and 500 ms average worker service time.', 'Ninety-nine percent of admitted jobs should begin within 30 seconds of due time; completion deadlines vary by job type.', 'Jobs may be scheduled up to one year ahead. Worker execution is at least once, with explicit application idempotency requirements.'],
    diagram: `Producer -> Jobs API -> schedule DB + request records
                              |
                      due-time dispatchers
                              |
                      durable ready broker
                              |
Workers -> fenced claim -> job DB -> result + completion outbox
   |
   +-> external action with stable operation identity
Reaper -> expired claims -> retry schedule`,
    calculations: [
      { label: 'Average new jobs', factors: [5000000], divisor: 86400, result: 57.87, unit: 'jobs/second', assumption: 'Daily average, separate from synchronized due-time bursts.' },
      { label: 'Peak service concurrency', factors: [5000000, 4, 0.5], divisor: 86400, result: 115.74, unit: 'concurrent jobs', assumption: 'Little-law estimate at fourfold rate and 0.5-second mean service time, before safety margin and retries.' },
      { label: 'Thirty-day logical schedule payload', factors: [5000000, 30, 400], divisor: 1000000000, result: 60, unit: 'GB', assumption: '400 bytes per retained job; excludes large payload objects, indexes, replicas, and attempt history.' },
    ],
    sections: [
      {
        title: 'Define the states behind the word scheduled',
        body: `A job can be accepted, waiting for its due time, dispatched, claimed, running, succeeded, failed, or cancelled. Those states have different evidence. A successful create response means the schedule is durable. A broker confirmation means a ready message was accepted according to the broker's durability configuration. Neither means a worker began, completed, or performed an external side effect. Expose those distinctions in GET /jobs/j6 instead of a single misleading delivered flag.\n\nPOST /jobs accepts due_at, job_type, a bounded payload reference, tenant, and request key. Store a body hash with the request record to reject key reuse for different jobs. The schedule row includes state, next_attempt_at, attempt_count, generation, lease_until, and result_ref. Validate that the tenant may invoke the job type, limit future scheduling horizon, and define cancellation as stopping unstarted work or requesting cooperative cancellation, not reversing an already completed external action.`,
        code: `jobs(job_id, tenant_id, due_at, next_attempt_at, state,
     generation, lease_until, attempt_count, payload_ref, result_ref)
INDEX(next_attempt_at, job_id) WHERE state IN ('scheduled','retry')

POST /jobs
{"requestKey":"export-82","dueAt":"2026-10-08T10:00:00Z",
 "type":"workspace-export","payloadRef":"tenant7/export82"}`,
      },
      {
        title: 'Walk from the time index to a worker claim',
        body: `Dispatchers scan bounded due-time windows using an index, claim rows with transactional coordination, and create durable dispatch intents. Publishing directly after selecting rows has a crash window: a row may be marked sent even though no broker message exists. An outbox or recoverable dispatch state closes that gap. Publishing can repeat after an uncertain confirmation, so ready messages carry job ID and expected dispatch generation. The broker holds ready work, not every distant-future timer.\n\nA worker receives a message and conditionally claims the job, incrementing its ownership generation and setting a lease. It verifies cancellation and due-time eligibility. After processing, it commits result and terminal state only if its generation still matches, then acknowledges the delivery. A duplicate message for an already terminal job is acknowledged without rerunning it. A stale message for an older dispatch generation cannot reset current progress.`,
      },
      {
        title: 'Keep leases from becoming false completion guarantees',
        body: `A heartbeat extends a claim only for the current generation. If a worker pauses, the reaper can schedule another attempt after lease expiry. The old worker may resume, so protected database writes need a fencing condition. A lease by itself does not prevent two processes from being alive at once. For external effects, the downstream API must support a stable idempotency identity or another reconciliation mechanism. The scheduler cannot enforce its generation inside an arbitrary remote service.\n\nUse a logical action key derived from job ID, not a new random key per retry, when the goal is one business effect. Persist request intent before calling outside. A timeout produces an unknown outcome requiring lookup or reconciliation. Retrying a non-idempotent email or physical command may repeat the effect. Such job types need an explicit delivery policy and user expectations instead of a universal exactly-once checkbox.`,
      },
      {
        title: 'Design retries, cancellation, and recovery separately',
        body: `Classify failures into transient infrastructure errors, permanent input errors, and unknown external outcomes. Retry transient errors with exponential backoff, jitter, a maximum age, and an attempt cap. Send exhausted or malformed jobs to an inspectable failure state rather than an endlessly cycling queue. Recovery tools preserve the original job identity and record who requested replay. A replay after changed input is a new job linked to the old one, not hidden mutation of history.\n\nCancellation races with claim and completion. A transaction can cancel a scheduled job before ownership begins; a running job sees a cancellation request and cooperates at safe checkpoints. Completion wins only under documented transition rules. After database failover, reapers inspect expired claims and outbox rows. Retained attempt records explain what happened. Backups protect schedule history and results from corruption or operator errors; replicas do not provide that independent recovery boundary.`,
      },
      {
        title: 'Preserve fairness when many jobs become due together',
        body: `A midnight batch can overwhelm the system even if daily averages are small. Partition admission by tenant and job class, reserve capacity for interactive deadlines, and distribute bulk schedules over an allowed jitter window. Worker pools have separate concurrency and resource limits for CPU-heavy exports, network callbacks, and short database jobs. A slow downstream dependency should not consume every worker. Bounded prefetch prevents one worker from holding a large invisible backlog.\n\nMonitor schedule-to-dispatch delay, dispatch-to-claim delay, runtime, lease expirations, retry age, and terminal failure rate. These show different bottlenecks. Queue depth alone can be misleading if jobs have widely different costs. Keep an oldest-due-job signal and compare it with the start-time SLO. Redact payloads in logs and require tenant authorization for status, cancellation, results, and replay. Export jobs should use current permission checks when accessing data, not an indefinitely trusted creation token.`,
      },
      {
        title: 'Choose timer and recurrence mechanisms with limits',
        body: `A relational due-time index is easy to inspect and adequate for the estimated rate. Time-bucketed partitions make retention and scanning manageable, while a near-term timing wheel can reduce repeated database polling at much higher scale. Keep a durable authority beneath any in-memory timer. A broker with delay support can simplify short waits, but long horizons, cancellation, inspection, and broker-specific delay guarantees still matter.\n\nRecurring jobs require calendar semantics: timezone, daylight-saving transitions, missed-run policy, and whether runs overlap. Expand the next occurrence only after recording the previous scheduling decision, using a unique recurrence-and-occurrence key. Do not assume every day has exactly 86,400 local-clock seconds. Multi-region dispatch needs one authority per schedule partition or a fenced leader. During loss of that authority, delayed starts are safer than concurrent unfenced execution. The stated start SLO is conditional on admission and supported downstream capacity, not a guarantee for unbounded submissions.`,
      },
    ],
    followUps: [
      { question: 'When should a worker acknowledge a broker delivery?', answer: 'After it has durably recorded completion or a recoverable retry or failure state, not merely after receiving the message. If it crashes after completion but before acknowledgment, redelivery finds the terminal record and does not rerun protected work. For a long job, claim and heartbeat state still matter because the delivery may reappear. Publisher confirms and consumer acknowledgments cover different links; neither proves the business effect occurred. The job status API must retain the actual result evidence.' },
      { question: 'How do you stop a paused worker writing after another takes over?', answer: 'Increment generation on each new ownership claim and require the expected generation in every protected completion or progress update. The database rejects stale writes. Where a downstream store supports fencing, pass the generation and have that store reject older operations too. For an arbitrary external API that lacks fencing or idempotency, the scheduler cannot guarantee suppression. Use reconciliation or restrict retries, and document the remaining duplicate-effect risk instead of overstating lease guarantees.' },
      { question: 'What is the smallest useful overload test?', answer: 'Schedule a large synchronized due-time burst with mixed short and long jobs, then slow one downstream dependency. Verify that short interactive jobs retain reserved capacity, prefetch stays bounded, retry traffic does not dominate new work, and oldest-due age returns below target after recovery. Pause a worker beyond lease expiry and restart a dispatcher during publication. Those fault injections test ownership and lost-intent behavior in addition to throughput, which a steady uniform load would miss.' },
    ],
    lessonIds: ['queues', 'transactions', 'reliability', 'rate-limiting', 'observability', 'tradeoffs'],
    sourceIds: ['rabbitmq-acks', 'outbox', 'pg-isolation', 'stripe-idempotency', 'sre-overload'],
  },
  {
    problemId: 'object-storage',
    summary: 'An application object service commits verified immutable versions through metadata, with explicit cleanup and tenant-scoped grants.',
    assumptions: ['Hypothetical workload: 800,000 uploads per day averaging 5 MB, with downloads totaling four times daily uploaded bytes.', 'Objects range from kilobytes to 20 GB; control-plane requests target p99 below 250 ms, excluding byte transfer.', 'An acknowledged published version must be retrievable until authorized deletion or retention expiry; listing pages contain at most 1,000 entries.'],
    diagram: `Tenant -> Object API -> metadata DB + publication outbox
              |                 |
              +-> upload grant  +-> authorized version pointer
                      |
Client -> multipart staging -> immutable blob store
Client <- scoped read grant <- Object API
Auditor/GC -> reference recheck -> abandoned upload cleanup`,
    calculations: [
      { label: 'Daily logical uploaded data', factors: [800000, 5, 1000000], divisor: 1000000000, result: 4000, unit: 'GB/day', assumption: 'Decimal MB and GB; excludes old versions, replication, and multipart overhead.' },
      { label: 'Average download bandwidth', factors: [800000, 5, 1000000, 4, 8], divisor: 86400000000000, result: 1.48, unit: 'Gbps', assumption: 'Downloads are four times upload bytes, converted from bytes to bits and decimal Gbps; daily average only.' },
      { label: 'Thirty-day logical new-object storage', factors: [800000, 5, 1000000, 30], divisor: 1000000000, result: 120000, unit: 'GB', assumption: 'No deletion or compression; logical payload, not physical provider storage.' },
    ],
    sections: [
      {
        title: 'Choose application semantics above the blob store',
        body: `This exercise builds a tenant object API on a durable blob substrate; it does not pretend that reimplementing distributed disks is a small extension. The application owns names, permissions, quotas, publication state, and retention. Each object has a stable object_id and immutable version records containing blob key, checksum, size, creation identity, and state. A metadata pointer selects the current published version. Object names are labels scoped to a tenant, not filesystem paths with implied security.\n\nPOST /objects/uploads creates a reservation and upload grant. POST /objects/{id}/versions publishes a verified upload against an expected current version. GET /objects/{id} returns authorized metadata or a short-lived read grant for a specific version. DELETE changes application visibility and schedules byte cleanup. Specify whether listing includes old versions and delete markers. Without those rules, clients cannot distinguish an absent object from a pending upload or an intentionally removed current pointer.`,
        code: `objects(tenant_id, object_id, name, current_version, state)
versions(tenant_id, object_id, version_id, blob_key, bytes, checksum, state)
uploads(upload_id, tenant_id, reserved_bytes, expires_at, state)

POST /objects/o5/versions
{"uploadId":"u9","expectedVersion":6,"requestKey":"publish-91"}`,
      },
      {
        title: 'Walk through a large resumable upload',
        body: `Authorize the tenant, reserve expected bytes atomically against its quota, and create an upload record before issuing narrow grants. The client uploads bounded parts directly to the blob store. Part identifiers and checksums support resumability; the service records enough state to avoid charging quota twice when a completion request repeats. Completion verifies the final length and integrity evidence, then marks the upload ready. A malicious client cannot choose another tenant's key or inflate the grant into unrestricted bucket access.\n\nPublication creates an immutable version, conditionally advances the current pointer, finalizes quota accounting, and records an outbox event in one metadata transaction. If pointer comparison fails, retain the uploaded version as an unpublished candidate or report conflict according to policy. A read first checks metadata authorization, then retrieves the exact version through a scoped grant. It never guesses the newest blob by listing a prefix, which would bypass publication state and version concurrency rules.`,
      },
      {
        title: 'Respect the actual consistency boundary',
        body: `Amazon S3 supports strong consistency for its documented object operations, including supported reads and listings after successful writes. That property is useful, but it does not supply application transactions spanning several objects and a metadata database. This design therefore writes immutable bytes before committing the pointer. An interrupted workflow can leave an orphan object; it must not leave a published pointer to incomplete bytes. Concurrent pointer changes use expected versions or database locks rather than relying on object-name randomness.\n\nThe upload record and publication request have unique identities. Repeating publication with the same request body returns the same committed result. Reusing the key with a different upload is rejected. When a response is ambiguous, look up the recorded operation before uploading again. A checksum identifies content integrity, not permission. Sharing storage by hash across tenants requires careful privacy, reference accounting, and encryption policy; tenant-scoped objects are the safer initial boundary.`,
      },
      {
        title: 'Delete and recover without racing delayed publication',
        body: `Deletion first writes a tombstone and removes normal access. Physical removal follows after a grace period and legal or product retention checks. A signed read URL already issued may remain usable until it expires, so the revocation promise must account for that interval. Garbage collection enumerates expired uploads and unreferenced versions, marks candidates, waits, and rechecks metadata immediately before deletion. Delayed completion requests cannot resurrect a cancelled upload because their state transition is conditional.\n\nLifecycle policies bound abandoned multipart storage and old-version cost, but they must agree with metadata retention. A restore requires both metadata and reachable bytes. Keep backups or protected retained versions separate from ordinary replication and test restoring deleted objects under realistic permissions. A replica faithfully copying an accidental delete is not a backup. Periodic audits compare published metadata with blob existence and checksum records; missing data is escalated, not silently replaced with another version.`,
      },
      {
        title: 'Secure grants and observe the byte path',
        body: `Grant scope includes tenant-controlled identity, exact key, allowed method, expiry, and where supported size or content constraints. Keep administrative credentials off clients and public buckets disabled by default. Object IDs, UUIDs, and high-entropy keys only reduce guessing; every metadata access still checks authorization. Downloads may need a separate hostname and safe content disposition to prevent active uploaded content from executing with application privileges. Scanning can gate publication for shared assets while leaving a visible pending state.\n\nTrack control-plane latency separately from transfer throughput, upload abandonment, checksum failure, publication conflicts, reserved-byte leakage, and download egress. Audit access-policy changes and deletions without logging signed URLs. Quotas should include active reservations and retained versions, with an explicit billing policy for temporary parts. A surge of tiny objects stresses request and metadata capacity; a few huge uploads stress bandwidth and storage. Aggregate byte averages alone hide both extremes.`,
      },
      {
        title: 'Compare replication, erasure coding, and managed storage',
        body: `The estimated 120 TB of logical new bytes over thirty days excludes every retention and durability multiplier. A self-managed store using three full copies would require roughly three times payload before indexes and spare capacity. Erasure coding can reduce storage amplification but adds repair bandwidth, placement constraints, and degraded-read complexity. Those are substrate design decisions; a managed object service does not expose a simple customer-selected replica factor, so do not attribute that hypothetical multiplier to S3.\n\nFor this product, managed storage keeps effort focused on authorization and lifecycle correctness. A self-managed alternative needs failure-domain-aware placement, repair scheduling, integrity scrubbing, metadata availability, and measured recovery objectives. Cross-region copies improve disaster resilience but introduce lag and cost; they do not create atomic publication across regions. List APIs use stable cursors and bounded pages, accepting documented concurrent-change semantics. If callers need a snapshot inventory, build a versioned inventory artifact rather than promising a live listing is a transaction.`,
      },
    ],
    followUps: [
      { question: 'Does strong object consistency eliminate the need for a metadata transaction?', answer: 'No. It establishes documented object-operation behavior, not an atomic commit across the blob store, quota counters, application permissions, and version pointers. Write immutable bytes first, verify them, and transactionally publish metadata afterward. Failure before publication leaves cleanup work; failure afterward leaves a valid referenced version. Concurrent publications compare the expected current version. This ordering makes the application invariant explicit while benefiting from strong supported object reads and listings without claiming multi-object transactions.' },
      { question: 'How would you avoid quota leakage from abandoned uploads?', answer: 'Reserve bytes when granting an upload, associate the reservation with an expiring upload record, and finalize or release it through conditional state transitions. An expiry worker cannot release a reservation already finalized by publication. Periodic reconciliation compares reservations, published logical bytes, and active uploads to detect drift. The grace period must cover supported resumptions. Physical multipart cleanup can lag accounting cleanup under a bounded budget, but billing and admission semantics should state which temporary bytes count.' },
      { question: 'What does a checksum failure mean for publication?', answer: `Do not publish the version or advance its pointer. Mark the upload failed, revoke further completion attempts for that state, retain enough diagnostic metadata, and let the client restart or retry verified parts according to protocol. A checksum supplied only by the client is not independent proof of server-received integrity; use the storage system's supported checksum evidence or server verification. Failures can arise from bugs or corruption, so monitor their rate and avoid exposing other tenants' object information during diagnosis.` },
    ],
    lessonIds: ['object-storage', 'transactions', 'capacity-estimation', 'security', 'replication', 'reliability'],
    sourceIds: ['s3', 'pg-isolation', 'owasp-object-auth', 'outbox', 'pg-recovery'],
  },
  {
    problemId: 'video-delivery',
    summary: 'Immutable video segments and atomically published rendition metadata make retryable transcoding compatible with efficient private playback.',
    assumptions: ['Hypothetical workload: 2,000 uploads per day, each 15 minutes long; 50,000 concurrent viewers at a 3 Mbps average delivered bitrate.', 'Four-second segments are used for estimation; startup p95 target is below two seconds on supported broadband connections.', 'Ninety-five percent of supported uploads should become playable within ten minutes after upload completion; private playback grants expire within two minutes.'],
    diagram: `Uploader -> upload API -> source object store
                 |
              asset DB + outbox -> transcode queue -> fenced workers
                                                |          |
                                                +-> immutable segments
                                                           |
                                                manifest publication DB
Viewer -> entitlement API -> signed manifest -> CDN -> segment origin`,
    calculations: [
      { label: 'Peak viewer delivery bandwidth', factors: [50000, 3], divisor: 1000, result: 150, unit: 'Gbps', assumption: '3 Mbps delivered per concurrent viewer; excludes protocol overhead and CDN origin savings.' },
      { label: 'Segment request rate', factors: [50000], divisor: 4, result: 12500, unit: 'requests/second', assumption: 'One segment every four seconds per viewer; excludes manifests, retries, and separate audio requests.' },
      { label: 'Daily source duration', factors: [2000, 15], divisor: 60, result: 500, unit: 'video-hours/day', assumption: 'Source duration, not CPU-hours; rendition count and encoder speed determine compute.' },
    ],
    sections: [
      {
        title: 'Separate upload acceptance from playable publication',
        body: `A video asset has states such as uploading, verifying, processing, playable, rejected, and deleted. An upload success does not imply playback readiness. Store asset_id, owner, source_version, processing_profile, generation, and current_manifest_version. The source object is immutable and private. A completion request validates length and integrity before a transaction records the source version and outbox intent. User-facing status shows processing progress without claiming an exact completion time from queue position alone.\n\nPOST /assets creates an upload session; POST /assets/{id}/complete begins verification and processing. GET /assets/{id}/playback checks entitlement and returns a short-lived manifest grant only for a published version. The processing profile identifies codecs, segment duration, audio handling, and rendition targets. Record the profile version with every output so a later encoder upgrade does not mix incompatible artifacts into an existing manifest.`,
        code: `assets(asset_id, owner_id, source_version, state, generation, manifest_version)
renditions(asset_id, generation, profile_version, rendition, output_prefix, state)

GET /assets/a6/playback
-> {"manifest":"/media/a6/v3/master.m3u8?grant=...","expiresIn":120}

segment key: tenant8/assets/a6/g3/720p/segment_0042`,
      },
      {
        title: 'Trace processing and adaptive playback',
        body: `A worker claims a generation, reads the verified source, and produces each rendition into a generation-specific prefix. It reports durable progress and retries individual failed stages where the encoder permits deterministic restart. Validate expected segment counts, duration continuity, and audio alignment before publication. Publish a manifest version only when its required rendition set is complete, then atomically update the asset pointer. Readers never see a manifest referring to partially written segments.\n\nPlayback authorization issues a bounded grant. The player fetches the manifest, selects a rendition based on measured bandwidth and buffer health, and requests immutable segments through the CDN. Switching occurs at aligned segment boundaries. The origin is not the application server; it serves private objects through controlled edge access. Immutable versioned segment keys support long cache lifetimes, while entitlement responses and grants have short lifetimes and must not be cached across users.`,
      },
      {
        title: 'Make retry and generation ownership precise',
        body: `Transcode messages can be duplicated. A unique asset-generation-profile job identity and conditional claim prevent duplicate publication, while generation fencing rejects stale progress from an earlier worker. Two encoders may still consume compute during a lease race, so output prefixes are isolated and only the current generation may publish. Do not let the last worker to finish overwrite a newer source version. A database transition protects the pointer even when the queue redelivers old work.\n\nOutput creation and metadata publication are separate systems. Successful object writes do not transactionally update the manifest pointer; publish immutable output first and metadata second. Supported S3 operations are strongly consistent, but that does not create a transaction for all segments and application state. Orphan generation outputs are safe temporary waste and are cleaned after a grace period. A failed validation leaves the asset unplayable or on its previous valid manifest, never half upgraded.`,
      },
      {
        title: 'Degrade gracefully during compute or origin failure',
        body: `A backlog of uploads should not affect already published playback. Isolate transcode compute, control-plane APIs, and media serving. Queue age and measured encoding speed drive admission and user messaging. Unsupported or malicious media is a permanent rejection, not an infinitely retried job. Limit source size, decoded duration, resolution, and parser resources to defend workers. Sandboxed processing and narrow object permissions contain failures, while an inspectable failure record supports support teams.\n\nCDN cache hits reduce origin load but do not remove cold-start or purge risk. Protect origin with bounded concurrent misses and prewarm expected popular assets when justified. If one rendition is broken after publication, publish a corrected manifest version excluding it rather than mutating cached segment bytes. Keep a previous known-good manifest for rollback. Backups or protected source retention allow re-encoding after output loss; replication alone does not protect against accidental source deletion.`,
      },
      {
        title: 'Authorize playback and measure actual viewing quality',
        body: `Private playback requires entitlement checks on asset and tenant, not simply possession of an unpredictable asset ID. Signed grants should bind scope and expiry, and edge cache configuration must separate authorization from shared immutable bytes. A cache key containing every short-lived token can destroy hit rate; blindly ignoring tokens can leak private content. Use an edge authorization mechanism that validates access before serving a safely shared cached object. Revocation is bounded by grant lifetime and cannot retrieve already downloaded segments.\n\nMeasure startup delay, rebuffering ratio, manifest failures, segment error rate, origin bytes, cache hit ratio, and transcode-to-playable age. API latency is not a sufficient playback SLI. Collect player telemetry with consent and bounded labels; asset IDs as unrestricted metric dimensions can create cardinality problems. Rate-limit grant issuance and protect against download scraping. Logs must not contain reusable grants or private titles unnecessarily.`,
      },
      {
        title: 'Tie bandwidth and compute decisions to workload',
        body: `The 150 Gbps estimate is viewer-facing traffic, not necessarily origin bandwidth. A high CDN hit rate changes origin demand but not delivered-byte cost or user-network limits. Four-second segments balance request overhead with adaptive switching and startup granularity; shorter segments can improve responsiveness while increasing request rate. Multiple renditions multiply stored output and encoding work. Source duration of 500 hours per day must be multiplied by profile-specific encoder time, measured on representative content, before sizing workers.\n\nProgressive download is simpler for short clips but gives less adaptive control and may transfer unused bytes. Just-in-time transcoding saves storage for rarely viewed assets but exposes viewers to compute latency and capacity risk. Precomputed renditions fit predictable educational playback. This design omits live broadcast, DRM key management, and global live-chat synchronization; those are separate extensions. Multi-region origins improve resilience only if manifests, grants, and output availability share a documented failover policy.`,
      },
    ],
    followUps: [
      { question: 'How do you publish a video without exposing incomplete segments?', answer: 'Write all required outputs to immutable generation-specific keys, validate them, then atomically publish the manifest pointer in metadata. A reader receives only published versions. If processing crashes before pointer publication, cleanup can remove orphan outputs later. If the pointer commit succeeds but its response is lost, the job identity returns the existing manifest result. Never build a public manifest incrementally under a stable key while clients are reading it, because intermediate references may not be ready.' },
      { question: 'Why does a signed URL not solve immediate access revocation?', answer: 'A previously issued grant can remain valid until expiry, and a viewer may have buffered or downloaded segments. Short lifetimes and edge revocation checks can bound new service-controlled access, but cannot retract bytes. State that bound in the product contract. Entitlement changes should invalidate issuance caches promptly. Highly sensitive video may need stronger content protection and device policy, with corresponding operational complexity, rather than a claim that random URLs or signatures make downloaded media revocable.' },
      { question: 'What if a new encoder produces worse quality than the old one?', answer: 'Treat the profile as versioned and generate new outputs without replacing old segments. Evaluate representative clips and shadow quality metrics before changing the published pointer. Rollback selects the previous manifest atomically; cacheable immutable outputs remain valid. Store source and profile provenance so failures can be reproduced. Reprocessing has a bounded compute budget and must not starve new uploads. A successful transcode exit code is not enough: duration, audio alignment, and playback tests validate useful output.' },
    ],
    lessonIds: ['object-storage', 'http-caching', 'queues', 'reliability', 'security', 'capacity-estimation'],
    sourceIds: ['s3', 'http-cache', 'outbox', 'rabbitmq-acks', 'sre-slos', 'owasp-object-auth'],
  },
  {
    problemId: 'notification-platform',
    summary: 'Notification intent, preference evaluation, provider submission, and user receipt are separate durable and observable stages.',
    assumptions: ['Hypothetical workload: 4,000,000 notification intents daily, averaging 1.4 selected channels after preferences.', 'Transactional intents target p99 provider submission within five seconds; bulk campaigns may wait up to one hour.', 'Provider callbacks can duplicate or arrive out of order. Email and push cannot be promised exactly once or guaranteed read.'],
    diagram: `Product transaction -> outbox -> intent inbox
                                     |
                              preference planner
                               /      |       \\
                          in-app     email     push
                             |         |        |
                          durable   provider workers
                           inbox       |        |
                                       +-> receipt inbox -> status DB
Quiet-hour scheduler -> delayed channel tasks`,
    calculations: [
      { label: 'Average intent rate', factors: [4000000], divisor: 86400, result: 46.3, unit: 'intents/second', assumption: 'Daily average; campaign peaks require independent admission budgets.' },
      { label: 'Average channel submissions', factors: [4000000, 1.4], divisor: 86400, result: 64.81, unit: 'submissions/second', assumption: '1.4 channels per intent after preference selection, excluding retries.' },
      { label: 'Thirty-day logical intent and task payload', factors: [4000000, 30, 900], divisor: 1000000000, result: 108, unit: 'GB', assumption: '900 bytes combined per intent on average; excludes rendered bodies, indexes, replicas, and callback history.' },
    ],
    sections: [
      {
        title: 'Model intent independently from delivery',
        body: `The originating product asks for a notification intent, not a specific provider HTTP request. An intent carries tenant, recipient, event identity, category, template version, and bounded substitution data. It may produce zero, one, or several channel tasks. Store a uniqueness constraint on tenant, event identity, recipient, and category to deduplicate repeated ingestion. A transactional product event should write an outbox record with its own state change, so a successful purchase does not lose its receipt intent during a process crash.\n\nPOST /notification-intents returns accepted intent status after durable storage. It does not claim the email was delivered. GET /notification-intents/{id} exposes planned, suppressed, deferred, submitted, provider-accepted, failed, and where supported delivered outcomes. User-read status is available only for channels that supply reliable application evidence. Template content and category determine consent rules; labeling every message transactional to bypass preferences is an abuse of the design.`,
        code: `intents(intent_id, tenant_id, event_key, recipient_id, category, template_version)
UNIQUE(tenant_id, event_key, recipient_id, category)
tasks(intent_id, channel, state, next_attempt_at, preference_version)
UNIQUE(intent_id, channel)

POST /notification-intents
{"eventKey":"order-82-paid","recipientId":"u4","category":"receipt","template":"receipt-v3"}`,
      },
      {
        title: 'Walk through planning and an email attempt',
        body: `An ingestion worker stores the intent and acknowledges only after the inbox transaction commits. A planner reads recipient preferences, category policy, timezone, and suppression records. It creates channel tasks atomically with its planning result, recording why any channel was suppressed. Quiet hours move eligible tasks to a due-time scheduler; emergency categories follow a separately documented override. Timezone and daylight-saving behavior must be explicit rather than assuming every local day is twenty-four hours.\n\nAn email worker claims a task, renders a versioned template with escaped data, and persists a submission attempt before calling the provider. It records the provider reference and response, then acknowledges the queue delivery after a recoverable state is committed. Callback ingestion verifies authenticity, durably deduplicates the event, and applies a valid status transition. In-app notifications use a unique intent-recipient record and can offer much stronger local deduplication than external channels.`,
      },
      {
        title: 'Handle preferences, duplicates, and unknown outcomes',
        body: `Preferences can change between planning and submission. For marketing and revocable categories, recheck the current preference version immediately before the provider call, including unsubscribe and invalid-address suppression. A local check cannot retract a request already accepted externally; document that small race and minimize it. Digest tasks aggregate a bounded set of intent IDs and seal a digest version before rendering, so retries do not produce a different body under the same submission key.\n\nIf a provider supports idempotency, use a stable task-level key and understand its retention window. If a call times out after the provider accepted it, mark outcome unknown and query by reference or await a callback. A blind retry may send twice when the provider lacks deduplication. Broker redelivery is not proof the provider call failed. Templates, recipients, and parameters are immutable for one attempt identity; corrections create a new linked intent instead of silently changing a retry.`,
      },
      {
        title: 'Isolate provider failures and preserve important traffic',
        body: `Transactional and bulk queues have separate concurrency budgets, retry policies, and provider quotas. A campaign burst must not starve password-reset or receipt tasks. Circuit breakers stop repeatedly calling a failing provider, while delayed retries use jitter and age limits. Automatic provider failover is not always safe: an unknown outcome at provider A followed by submission to provider B can duplicate delivery. Fail over only from a known nonaccepted state or an explicitly accepted duplicate-risk policy.\n\nPermanent failures such as invalid destinations update suppression data and end the task. Exhausted transient failures enter an inspectable terminal state with reason and replay controls. Retain raw callback evidence under a bounded privacy policy. During recovery, replay workers receive a separate budget and preserve stable intent IDs. Independent backups protect preferences, intent history, and suppression lists; simply replaying all old broker messages after restoration could resend already completed external notifications.`,
      },
      {
        title: 'Defend recipients and measure the right boundary',
        body: `Authorize intent creation by tenant and category, and ensure a caller cannot target arbitrary users with another tenant's branding. Recipient lookup uses internal identifiers rather than trusting an unverified email address in every request. Apply recipient-level frequency caps, campaign limits, and abuse review for unusual sends. Escape template substitutions and constrain links so one product cannot turn the platform into a phishing relay. Credentials and device tokens remain encrypted and absent from routine logs.\n\nMeasure intent acceptance, planning delay, due-task age, provider submission latency, known rejection, unknown-outcome age, and preference-suppression counts. Provider acceptance is not user delivery; opens may be privacy-filtered and cannot reliably prove reading. Bounce and complaint metrics affect sender reputation and should trigger operational action. Trace IDs link product event, intent, task, attempt, and callback without storing message bodies in high-cardinality metric labels.`,
      },
      {
        title: 'Balance channel policy and storage costs',
        body: `The 1.4-channel multiplier is a hypothetical planning assumption, not a fixed property. Retries, digests, and campaigns change submission count independently from intent rate. Keep bulky rendered bodies in bounded object retention and smaller task state in the transactional store. Partition by tenant or recipient for planning locality, while queue routing by channel and priority isolates provider constraints. A single large tenant may require its own rate partition rather than monopolizing shared workers.\n\nA synchronous send API is simpler for tiny internal workloads but couples product latency to provider health and loses durable recovery unless the caller implements it. A generic broker-only pipeline lacks preference transactions and explainable status. This design earns its metadata store through auditability and suppression correctness. It does not guarantee inbox placement, device connectivity, or human attention. Those limits should appear in user-facing status and interview claims, not be obscured by a broad delivered label.`,
      },
    ],
    followUps: [
      { question: 'What should happen when a user unsubscribes while email is queued?', answer: 'Update the preference authority immediately and invalidate planning caches. Before submitting a revocable category, the worker rechecks current suppression and preference version, then marks the task suppressed if no longer permitted. A provider call already in flight cannot reliably be recalled, so the product documents that boundary. Avoid bulk workers caching preferences for an entire long campaign. Audit the preference version and decision time on each task to explain any message sent near the change.' },
      { question: 'How do you handle a provider timeout without sending twice?', answer: 'Persist the attempt identity before the call, use supported provider idempotency, and record unknown rather than failed when acceptance is uncertain. Query the provider by stable reference or reconcile callbacks before retrying. If no lookup or deduplication exists, choose an explicit tradeoff between possible duplicate and possible loss, based on category. Do not switch providers blindly. The platform can guarantee its local task record is unique while acknowledging that external delivery has weaker semantics.' },
      { question: 'How does a digest remain stable across retries?', answer: `At the digest deadline, atomically seal a bounded list of source intent IDs, template version, and rendered-data snapshot under one digest identity. New events go into the next digest rather than modifying the sealed one. Retries use the same body and submission key. Mark each included intent's digest association durably so a planner restart cannot include it twice. A corrected digest is a new linked message, not a different payload hidden behind the old provider idempotency key.` },
    ],
    lessonIds: ['queues', 'transactions', 'reliability', 'rate-limiting', 'observability', 'security'],
    sourceIds: ['outbox', 'rabbitmq-acks', 'stripe-idempotency', 'stripe-webhooks', 'sre-overload'],
  },
  {
    problemId: 'payment-ledger',
    summary: 'An immutable balanced journal distinguishes local accounting truth from pending processor workflows and reconciled settlement evidence.',
    assumptions: ['Hypothetical marketplace posts 1,500,000 journals per day with four entries per journal on average; peak posting rate is ten times average.', 'Posting p99 target is 400 ms regionally; a successful response means a balanced journal committed atomically.', 'Amounts use integer minor units and an explicit currency. External charges and payouts can be pending, failed, succeeded, or unknown until reconciled.'],
    diagram: `Client -> Command API -> ledger transaction
                            | accounts + journal + entries
                            | request record + outbox
                            v
                     processor worker -> external processor
                            ^                  |
                            |                  v
                    reconciliation <- verified event inbox
                            |
                      settlement evidence -> linked adjustment journal`,
    calculations: [
      { label: 'Average journal postings', factors: [1500000], divisor: 86400, result: 17.36, unit: 'journals/second', assumption: 'Daily average; entry count is a separate multiplier.' },
      { label: 'Peak entry insertion rate', factors: [1500000, 10, 4], divisor: 86400, result: 694.44, unit: 'entries/second', assumption: 'Tenfold peak and four entries per journal, excluding indexes and audit events.' },
      { label: 'Annual logical entry payload', factors: [1500000, 4, 180, 365], divisor: 1000000000, result: 394.2, unit: 'GB', assumption: '180 bytes per entry; excludes journal headers, balances, indexes, replicas, and retained provider payloads.' },
    ],
    sections: [
      {
        title: 'Define money invariants before choosing infrastructure',
        body: `A ledger records economic movements, not mutable payment-status rows masquerading as accounting. Each posted journal has entries whose signed amounts sum to zero within a currency and accounting scope. Use integer minor units with currency metadata; never binary floating point for money. Accounts have explicit purpose and normal-balance conventions. Customer available funds, reserved funds, processor clearing, fees, and settlement cash are separate accounts or subledgers so pending money is not accidentally spendable.\n\nA local transfer of 2,500 minor units can debit the source allocation and credit the destination allocation using a documented signed convention. The example is bookkeeping, not an assumption that all currencies have two decimal places. Cross-currency exchange requires balanced journals in each currency through clearing accounts plus an explicit rate and rounding policy. A zero sum across mixed currencies is meaningless. Posted entries are immutable; corrections use linked reversing or adjusting journals.`,
        code: `journal(id, tenant_id, command_key, currency, state, posted_at)
entries(journal_id, account_id, amount_minor, currency)
UNIQUE(tenant_id, command_key)

J82, currency=USD:
  buyer_available   -2500
  buyer_reserved    +2500
  sum                   0

POST /transfers
{"commandKey":"order82-reserve","from":"buyer_available",
 "to":"buyer_reserved","amountMinor":2500,"currency":"USD"}`,
      },
      {
        title: 'Post entries and protect balances atomically',
        body: `The command API authenticates the caller and authorizes both account scope and transfer type. A transaction obtains relevant account locks in stable order, checks currency and available-balance rules, creates the journal and all entries, updates any maintained balance projection, stores the idempotent response, and records an outbox intent. A database-controlled posting procedure or equivalent enforced write boundary validates the full balanced set before marking the journal posted. A row-level CHECK alone cannot establish a sum across arbitrary entries.\n\nRead balances from the same committed accounting boundary or a clearly labeled lagging projection. Two concurrent debits must not both read an old available balance and overspend. Locks, conditional updates, or serializable transactions with whole-command retries protect the invariant. Sequence gaps from rolled-back transactions are harmless; accounting identity and completeness come from committed journal records, not an assumption that IDs are gapless.`,
      },
      {
        title: 'Deduplicate commands without hiding parameter changes',
        body: `A command key is unique within tenant and operation scope, with a canonical request hash. If a client loses the response after commit, a retry returns the original journal and balance result. A changed amount under the same key is a conflict, not a new transfer. Request records and journals commit together; an expiring cache is insufficient for financial deduplication. The retention policy covers the full supported retry and audit horizon rather than copying a provider's shorter retention window.\n\nProcessor work starts from an outbox after local intent is durable. Use a stable provider operation key and store attempt references before making the call. A payment or payout API response may be ambiguous after a timeout. Mark the workflow unknown, keep appropriate funds reserved, and query or reconcile before deciding to retry. Kafka transactions or broker confirmations cannot make an arbitrary processor charge part of the ledger transaction.`,
      },
      {
        title: 'Reconcile external truth and settlement timing',
        body: `Verified processor callbacks enter a durable inbox with a unique provider event ID. Events may duplicate or arrive out of order, so workflow transitions use provider object identity, version or authoritative lookup, and valid state rules. A successful charge changes the local accounting state through a new balanced journal; it does not edit the original reservation entries. Settlement later moves amounts between processor clearing and cash accounts, with fees and discrepancies explicitly represented.\n\nReconciliation compares internal attempts and clearing balances against provider transactions and settlement reports. Match stable references, currency, amount, and expected timing; route unmatched or mismatched items to an exception queue. Never manufacture a balancing entry just to make a report look clean without documented economic explanation. Unknown outcomes have an age budget and escalation path. If a payout succeeded externally but local recording failed, reconciliation posts the missing linked journal idempotently rather than initiating another payout.`,
      },
      {
        title: 'Audit, recover, and restrict financial authority',
        body: `Only a narrow posting service can create committed entries. Account owners may read authorized balances and journals but cannot choose arbitrary clearing or revenue accounts. Administrative corrections require reason, actor, and approval policy; their journals link to the original. UUID account IDs do not authorize transfers. Keep provider credentials and sensitive payment details outside the ledger payload, using token references and redacted logs. Define retention and export controls with the business's regulatory needs rather than assuming a universal compliance rule.\n\nMonitor imbalance attempts, negative-available rejections, duplicate-command conflicts, posting latency, clearing-account age, unknown processor outcomes, and reconciliation exceptions. A synthetically balanced journal can still use the wrong accounts, so domain checks and finance review supplement arithmetic. Replication preserves availability but propagates bad writes. Independent backups, point-in-time recovery, and a controlled post-restore reconciliation process are essential. Recovery must not blindly replay external payout commands that may already have succeeded.`,
      },
      {
        title: 'Choose partitioning around atomic money movement',
        body: `The estimated entry rate is compatible with a carefully indexed transactional database; correctness and lock contention are more important than fashionable scale components. Partition by a scope that keeps common transfers and balancing entries together. Cross-shard transfers require an explicit pending workflow or a transactional mechanism with understood failure behavior. Do not split accounts arbitrarily and then claim local transactions preserve a global atomic transfer. Hot platform clearing accounts can be subdivided by settlement cohort while reconciliation aggregates them.\n\nA computed-on-read balance from immutable entries is easy to audit but expensive for long histories. A maintained balance projection gives fast authorization if updated in the posting transaction and periodically verified against journal sums. An asynchronous analytics warehouse is useful for reports, not for deciding whether funds are available now. This design is an accounting core, not a full card network or fraud engine. Chargebacks, exchange gains, taxes, and regulated custody add domain rules beyond simple balanced arithmetic.`,
      },
    ],
    followUps: [
      { question: 'Is a balanced journal sufficient to prevent double spending?', answer: 'No. A transfer can be perfectly balanced while debiting funds that are not available. Posting must also enforce account permissions, currency compatibility, and available-balance constraints within the same transaction. Lock relevant accounts or use an equivalent atomic conditional mechanism so concurrent debits cannot both rely on the same old balance. Maintain reserved and available accounts separately. Arithmetic balance proves conservation under the chosen convention, not that the economic action was authorized or valid.' },
      { question: 'What if the processor timed out after completing a payout?', answer: 'Persist unknown outcome with the original provider key and reference, retain the relevant pending accounting state, and reconcile or query the provider. Do not issue a new payout with a fresh key. A verified success later posts the appropriate settlement or clearing journal exactly once locally through a unique economic-event identity. If the provider offers no reliable lookup or deduplication, escalate under a controlled policy. The system must expose that uncertainty rather than promising exactly-once external money movement.' },
      { question: 'How do you correct an incorrectly posted fee?', answer: 'Create a linked reversing or adjusting journal with an explicit reason, actor, and approval evidence. Preserve the original entries so the audit trail explains both the mistake and correction. Validate that the adjustment balances within its currency and uses permitted accounts, then post it atomically. Reports can group the journal chain into net effect without erasing history. Reconciliation should also check whether the external fee was wrong or only its internal classification, because those require different economic actions.' },
    ],
    lessonIds: ['transactions', 'data-modeling', 'queues', 'reliability', 'security', 'observability'],
    sourceIds: ['pg-isolation', 'stripe-idempotency', 'stripe-webhooks', 'outbox', 'pg-recovery'],
  },
  {
    problemId: 'api-gateway',
    summary: 'A thin gateway enforces identity, budgets, and routing while leaving object authorization and business invariants with downstream services.',
    assumptions: ['Hypothetical workload: 12,000 requests per second average, 36,000 peak, and 25 KB average response payload.', 'Gateway processing adds a p99 budget of 20 ms excluding upstream service time; regional gateway availability target is 99.95%.', 'Most routes have a 500 ms end-to-end deadline; uploads use a separate streaming path with explicit limits.'],
    diagram: `Client -> regional load balancer -> gateway fleet
                                  | authenticate
                                  | admission + route + deadline
                                  v
                             service fleet
                                  |
                         domain authorization + DB
Config authority -> signed snapshots -> gateway fleet
Gateway telemetry -> bounded collector -> dashboards`,
    calculations: [
      { label: 'Peak response bandwidth', factors: [36000, 25, 1000, 8], divisor: 1000000000, result: 7.2, unit: 'Gbps', assumption: 'Decimal KB response payload only; excludes requests, TLS framing, and retries.' },
      { label: 'Peak in-flight requests', factors: [36000, 0.2], divisor: 1, result: 7200, unit: 'concurrent requests', assumption: 'Little-law estimate using a hypothetical 200 ms mean full service time, not p99 latency.' },
      { label: 'Planned gateway instance count', factors: [36000, 1.5], divisor: 3000, result: 18, unit: 'instances', assumption: 'Hypothetical tested 3,000 requests/second per instance with 50% capacity margin; not a vendor benchmark.' },
    ],
    sections: [
      {
        title: 'Keep the gateway contract narrow',
        body: `The gateway handles transport concerns shared across services: authentication, routing, admission, deadlines, and telemetry. It should not become the only place where business permissions live. A verified user may still lack access to a particular invoice or workspace, so the downstream service checks object-level authorization. Strip client-supplied identity headers and replace them with a trusted internal identity envelope over authenticated service-to-service transport. Otherwise a caller can impersonate another tenant by adding a header.\n\nRoutes are declared by method, path template, API version, destination service, request-size limit, timeout policy, and retry class. Avoid routing through arbitrary client-provided upstream URLs. Return consistent errors with a request identifier and safe detail, not internal addresses or stack traces. Health endpoints and streaming uploads have separate policies from ordinary JSON APIs. The design is an entry point, not a substitute for secure domain boundaries.`,
        code: `route:
  method: GET
  path: /v1/workspaces/:workspaceId/documents
  upstream: document-service
  deadline_ms: 500
  retry_class: read-only
  response_cache: private-disabled

Forwarded identity: tenant_id, subject_id, scopes, auth_time
Client headers with the same names are removed.`,
      },
      {
        title: 'Trace authentication through a bounded upstream call',
        body: `The load balancer selects a healthy gateway. The gateway validates token signature, issuer, audience, expiration, and supported key version, then resolves a route from its current configuration snapshot. It applies tenant and global admission budgets before allocating expensive upstream work. Accepted requests carry an end-to-end deadline and trace context. The gateway selects a healthy service instance, forwards the verified identity, and streams the response with bounded buffers.\n\nA token-verification cache can reduce repeated cryptographic work, but its lifetime cannot exceed token validity or the chosen revocation policy. Key rotation refreshes verification keys safely and rejects unknown issuers. The service still validates the trusted transport and requested resource scope. Response caching is opt-in and must honor authorization and HTTP cache semantics. A shared cache that ignores tenant identity can leak data even if authentication itself is correct.`,
      },
      {
        title: 'Use quotas and overload protection for different purposes',
        body: `A tenant token bucket enforces contractual request rate and burst allowance. A fleet-wide concurrency budget protects actual capacity when upstream latency increases. These are different mechanisms: a request-rate limit alone does not prevent thousands of long-lived requests accumulating. Distributed quota enforcement can use a central atomic counter or leased local budgets. Local budgets reduce dependency and latency but introduce bounded overshoot that must be quantified and acceptable.\n\nIf the quota store is unavailable, policy varies by route. Expensive paid writes may fail closed, while low-cost reads may use a conservative local allowance. Do not call this universally fail open or fail closed without context. Bulk tenants receive isolated budgets, and retries count against a separate bounded retry allowance. Prioritize essential control paths when load rises. Reject early with clear retry guidance rather than accepting work that will time out after exhausting resources.`,
      },
      {
        title: 'Retry only when semantics and deadlines allow it',
        body: `A failed network connection can leave an upstream write outcome unknown. The gateway must not automatically replay arbitrary POST requests. Read-only routes may retry a different instance within the remaining deadline; idempotent write routes require an application request key with downstream enforcement. Even a semantically idempotent request can be expensive, so cap attempts and add jitter where appropriate. The remaining deadline is propagated, not reset at every hop.\n\nA circuit breaker limits repeated calls to a failing dependency, but it needs careful probe and recovery behavior. Hedged reads can reduce tail latency at the cost of extra load; they belong only on safe routes with cancellation and a budget. A gateway timeout does not prove the service stopped working. Services check deadlines at safe points and return recorded operation status for ambiguous writes. Distinguish client cancellation from server failure in observability.`,
      },
      {
        title: 'Recover configuration and defend the edge',
        body: `Gateways use validated versioned configuration snapshots so a control-plane outage does not erase existing routes. A new snapshot passes schema checks, conflict checks, and canary rollout before fleet adoption. Rollback selects a prior version. Configuration freshness and security-key freshness have different tolerances: stale route data may be safe for a while, but expired trust material may require rejecting requests. Keep the data plane independent from synchronous configuration reads.\n\nSet header, body, connection, and idle-time limits; normalize routing consistently to avoid ambiguous path interpretation. Protect against slow clients and request amplification. Logs redact credentials, cookies, signed URLs, and private bodies. Metrics use route templates rather than raw paths or user IDs to bound cardinality. Observe gateway overhead, upstream latency, rejected admission, retry amplification, configuration version skew, and authentication failures. External probes verify the full request path rather than only process liveness.`,
      },
      {
        title: 'Scale the fleet without hiding downstream limits',
        body: `The instance estimate assumes measured per-instance capacity and includes explicit margin. Real sizing requires representative TLS, payload, streaming, and logging costs. Autoscaling on CPU alone may miss exhausted connections or slow-upstream concurrency. Use in-flight work, saturation, and admission signals, while keeping enough prewarmed capacity for bursts. Load balancers distribute connections as well as requests; long streams can create imbalance and require draining during deployment.\n\nA library-based approach shares gateway behavior inside each service and avoids a central hop, but policy drift and repeated implementations become harder to control. A full service mesh addresses internal transport yet does not remove public-edge admission and API-version responsibilities. Keep the gateway thin enough that one policy bug cannot corrupt every business operation. Multi-region ingress improves reachability, while write routing still follows each service's consistency and residency rules. The gateway cannot manufacture safe active-active writes for a single-region database.`,
      },
    ],
    followUps: [
      { question: 'Why must services repeat object authorization after gateway authentication?', answer: 'Authentication establishes who the caller is; object authorization establishes whether that identity may act on the requested resource. The gateway generally lacks current ownership, membership, and domain state. Services verify the trusted identity envelope and check resource scope on every relevant operation. An attacker knowing a UUID or changing a path parameter must not gain access. Gateway scopes are useful coarse admission signals, but they cannot replace transactionally relevant domain permission checks.' },
      { question: 'How do local rate-limit budgets stay bounded during a partition?', answer: 'The authority grants each gateway a finite allowance with an expiry and never allocates more than the chosen total budget plus documented overshoot. A disconnected gateway spends only its remaining allowance, then rejects or uses a separate conservative policy. Reissuing overlapping leases without accounting can double capacity. The tradeoff is less quota precision for better data-plane independence. Explain the maximum overshoot numerically from lease size and fleet count rather than claiming perfectly global limits from local counters.' },
      { question: 'Should the gateway retry a payment POST after a timeout?', answer: 'Only if the route contract requires a stable request key and the payment service actually enforces idempotency with a durable operation record. Otherwise the first attempt may already have succeeded. Prefer returning an operation identifier or exposing status lookup for ambiguous outcomes. Any allowed retry uses the same key and fits the original deadline. Gateway retries cannot make an external processor exactly once; the payment workflow still handles provider uncertainty and reconciliation.' },
    ],
    lessonIds: ['load-balancing', 'rate-limiting', 'api-design', 'reliability', 'observability', 'security'],
    sourceIds: ['http-semantics', 'http-cache', 'sre-overload', 'sre-monitoring', 'owasp-object-auth'],
  },
  {
    problemId: 'metrics-platform',
    summary: 'A tenant metrics service bounds label cardinality, persists accepted samples, and separates recent queries from durable rollup processing.',
    assumptions: ['Hypothetical workload: 2,000,000 active series sampled every 15 seconds; logical encoded sample cost averages 16 bytes before indexes.', 'Ingest acknowledgment p99 target is 200 ms; accepted samples should become queryable within ten seconds in normal operation.', 'Raw retention is 14 days and five-minute rollups remain for one year. Per-tenant series and query budgets are explicit.'],
    diagram: `Agents -> authenticated ingest -> admission -> partitioned durable log
                                                    |
                                             series shard writers
                                              /            \\
                                       recent segments    rollup workers
                                              |            |
                                              +-> object segment store
Dashboard -> query planner -> bounded shard queries -> merge
Independent probes -> platform health outside this pipeline`,
    calculations: [
      { label: 'Average sample ingestion', factors: [2000000], divisor: 15, result: 133333.33, unit: 'samples/second', assumption: 'All active series emit once per fifteen seconds; batch HTTP rate is much smaller.' },
      { label: 'Daily logical sample bytes', factors: [2000000, 86400, 16], divisor: 15000000000, result: 184.32, unit: 'GB/day', assumption: 'Sixteen logical bytes per sample; divisor includes interval and decimal GB conversion; labels and indexes excluded.' },
      { label: 'Fourteen-day hypothetical replicated samples', factors: [2000000, 86400, 16, 14, 3], divisor: 15000000000, result: 7741.44, unit: 'GB', assumption: 'Three full sample copies in the estimate; compression, indexes, labels, and compaction headroom excluded.' },
    ],
    sections: [
      {
        title: 'Make series identity and cost admission explicit',
        body: `A series is a metric name plus a canonical sorted label set within a tenant. Labels such as region and service are usually bounded; request IDs, user IDs, and raw URLs can create a new series for every event. The platform therefore authenticates ingestion and enforces active-series quotas before accepting unbounded cardinality. Store a dictionary mapping canonical identity to series ID, with collision-safe equality checks if hashes are used. Hash equality alone is not permission or identity proof.\n\nPOST /samples accepts compressed batches of series identities, timestamps, and values. Limit batch bytes, label count, label length, and timestamp skew. Define duplicate behavior: an identical series-timestamp-value is harmless, while conflicting values for the same timestamp follow a documented reject or precedence policy. Tenant IDs are server-derived. A client cannot submit another tenant's namespace by changing one label.`,
        code: `POST /v1/samples
{"series":{"name":"queue_age_seconds","labels":{"service":"export","region":"r1"}},
 "samples":[{"timestampMs":1791432000000,"value":2.4}]}

series(tenant_id, series_id, canonical_labels, last_seen_at)
sample key: (tenant_id, series_id, timestamp)
query: queue_age_seconds{service="export"} over last 1h, step 30s`,
      },
      {
        title: 'Trace accepted samples into queryable storage',
        body: `Ingest validates a batch, applies tenant budgets, and appends samples to a durable partitioned log keyed by series. A success response means log acceptance under the configured replication and acknowledgment policy. It does not mean the storage shard or dashboard already contains the sample. Return an explicit partial-rejection result when only some series are admitted; silently dropping data after success undermines the contract.\n\nShard writers consume ordered series partitions, deduplicate according to timestamp policy, and build time-bucketed immutable segments. They publish segment metadata only after bytes are durable. Recent queries merge a bounded in-memory or recent-segment view with persisted segments, using a watermark to avoid gaps and duplicates. Consumers checkpoint only after recoverable output state is committed. Replaying accepted samples after a crash must not double counts in downstream rollups, particularly when the sink is outside the broker.`,
      },
      {
        title: 'Choose late-data and rollup semantics carefully',
        body: `Agents have clock skew and can buffer during outages. Accept out-of-order samples within a bounded lateness window and isolate older backfill into a controlled path. A watermark declares which time buckets are sufficiently complete for normal rollup publication. Late samples inside the supported correction window produce a new rollup version; older samples are rejected or recorded in a separately documented archive. The dashboard should not imply that recent buckets are final when they can still change.\n\nRollups depend on metric type. Gauges may retain minimum, maximum, sum, and count for useful aggregates. Counters require reset-aware rate calculations, not blindly averaging cumulative values. Histogram buckets can be merged under compatible boundaries; averaging per-instance percentiles does not produce a valid global percentile. Store schema and aggregation version with each rollup. Raw retention deletion occurs only after required rollups and their metadata are verified, with safe overlap during correction.`,
      },
      {
        title: 'Contain query fanout and cardinality explosions',
        body: `A query planner estimates series count, time range, resolution, and shard fanout before execution. Bound each dimension and total work. A regular expression matching every label across a year can overwhelm storage even when ingestion is healthy. Use rollups for long-range dashboards, limit concurrent expensive queries per tenant, and cancel shard work when the deadline expires. Cache popular aggregate results using tenant and query identity; permissions must not be dropped from the key.\n\nWhen cardinality rises unexpectedly, reject new low-priority series or enforce configured policy rather than evicting arbitrary important data after acknowledgment. Expose rejection reasons to agents and operators. Control metrics receive reserved ingestion capacity so a customer flood does not hide platform overload. Label dictionaries and indexes may cost more than sample bytes, making the sixteen-byte estimate intentionally incomplete. Track active-series churn as well as the steady-state count.`,
      },
      {
        title: 'Recover the monitoring system without relying only on itself',
        body: `During a storage outage, the durable log absorbs a bounded backlog. Retention must exceed realistic recovery time; if consumer lag approaches that limit, the system needs admission changes and an incident response, not faith in an infinite queue. Replay budgets prevent recovery writes from starving recent queries. Immutable segments and versioned manifests support repair and rebuild, while independent backups protect metadata against destructive changes. Replication cannot undo a corrupted series dictionary copied everywhere.\n\nMonitor ingest rejection, accepted-to-queryable lag, oldest unprocessed offset age, segment publication failures, query scanned bytes, and rollup watermark lag. Use an independent health path and external probes so the metrics platform's failure remains visible. Tenant authorization applies to queries, label discovery, exports, and administrative resets. Avoid putting credentials or arbitrary private labels into logs. A dashboard timeout is different from a missing sample; alert explanations should preserve that distinction.`,
      },
      {
        title: 'Select storage and partition boundaries by measured needs',
        body: `Series-hash partitioning distributes writes and preserves series-local ordering, but high-cardinality tenants can still dominate total capacity. Combine it with tenant budgets and movable virtual partitions. Time-bucketed storage enables retention deletion and sequential scans; small segments reduce freshness delay while increasing object and metadata overhead. Compression efficiency depends on actual values and timestamps, so the capacity calculations are logical estimates, not promised compression ratios or vendor performance claims.\n\nA general relational database is easier for modest deployments and provides familiar transactions, but the sustained sample rate and long-range scans here justify specialized segment storage. A log-only design retains replay but lacks efficient label indexing and bounded dashboard queries. Exact billing events should not be inferred from lossy operational metrics. This platform prioritizes useful operational visibility with explicit late-data limits; regulated accounting, unrestricted ad hoc analytics, and global synchronous ingestion require different contracts and costs.`,
      },
    ],
    followUps: [
      { question: 'Why is cardinality more dangerous than sample rate alone?', answer: 'A stable series can append many compact samples to existing indexes, while every new label combination creates identity, dictionary, index, and memory overhead. A request-ID label may turn a modest traffic stream into millions of short-lived series. Enforce active-series and creation-rate budgets, inspect churn, and give callers clear rejection reasons. Capacity plans include label and index cost separately from sample bytes. Reducing scrape frequency does not fully solve an explosion in distinct identities.' },
      { question: 'Can you average each server’s p99 latency to get fleet p99?', answer: 'No. Percentiles are not additive summaries, and averaging them ignores each server’s sample distribution and traffic volume. Collect compatible histogram buckets or another documented mergeable distribution representation, aggregate counts, and compute the percentile from that merged representation. Accuracy depends on bucket or sketch design. Preserve aggregation schema versions during rollout so incompatible histograms are not silently mixed. The dashboard should explain approximation rather than presenting a numerically precise but invalid fleet percentile.' },
      { question: 'What if consumers fall behind longer than log retention?', answer: 'Accepted samples may become unrecoverable from that log, so retention is a bounded recovery budget, not unlimited durability. Alert well before the oldest unprocessed offset approaches expiry, reserve replay capacity, and adjust admission or retain affected partitions if supported. Segment backups help only for already persisted samples. Expose any confirmed loss and its time range. Test a prolonged writer outage against actual log settings; a short restart test does not validate the stated recovery envelope.' },
    ],
    lessonIds: ['stream-processing', 'event-streams', 'sharding', 'observability', 'rate-limiting', 'object-storage'],
    sourceIds: ['kafka-design', 's3', 'sre-monitoring', 'sre-overload', 'sre-slos'],
  },
  {
    problemId: 'search-service',
    summary: 'A workspace search index is a versioned projection whose candidates must pass current authorization before snippets are returned.',
    assumptions: ['Hypothetical workload: 8,000,000 documents averaging 6 KB of searchable text and 400,000 updates per day.', 'Search peak is 2,000 requests/second; p95 target is 250 ms for bounded queries returning at most 50 results.', 'Normal text freshness target is ten seconds. Permission revocation must not leak old snippets while the index catches up.'],
    diagram: `Document transaction -> authoritative DB + outbox
                                           |
                                    versioned indexer
                                           |
                               inverted-index shard replicas
                                           ^
User -> Search API -> query planner --------+
             |
             +-> current permission filter -> authorized snippet hydration
Rebuild coordinator -> snapshot + replay -> new index -> alias switch`,
    calculations: [
      { label: 'Logical searchable source text', factors: [8000000, 6, 1000], divisor: 1000000000, result: 48, unit: 'GB', assumption: 'Decimal KB source text; inverted postings, term dictionaries, stored fields, and replicas add bytes.' },
      { label: 'Average document update rate', factors: [400000], divisor: 86400, result: 4.63, unit: 'updates/second', assumption: 'Daily average excludes imports and index rebuild traffic.' },
      { label: 'Peak candidate IDs before permission filtering', factors: [2000, 200], divisor: 1, result: 400000, unit: 'candidate IDs/second', assumption: 'Hypothetical overfetch of 200 candidates per request; hydration and authorization are separate costs.' },
    ],
    sections: [
      {
        title: 'Define a derived search contract',
        body: `The authoritative document store owns content, versions, deletion, and permissions. The search engine owns a derived inverted index and relevance scoring. A document update can commit before it is searchable, so the API states its freshness target and does not pretend search is a transactional read of current text. A permission change is different: stale search metadata must not reveal a private title or snippet. Separate content freshness tolerance from access-control correctness.\n\nStore indexed documents with tenant_id, document_id, source_version, searchable fields, language, and deletion state. Use tokenization, normalization, and field weights suited to the product, with a versioned analyzer configuration. POST /search accepts bounded query text, allowed filters, sort mode, and a cursor. It does not accept an arbitrary backend query language with unrestricted resource access. Explain whether exact phrase, prefix, and typo matching are supported rather than claiming every retrieval feature at once.`,
        code: `POST /v1/search
{"query":"incident review","filters":{"workspace":"w8","type":"note"},
 "limit":30,"cursor":null}

indexed_document(tenant_id, document_id, source_version, analyzer_version, fields)
source_document(document_id, workspace_id, version, permission_epoch, state)
Result hydration verifies current membership before returning title or snippet.`,
      },
      {
        title: 'Walk through an update and a ranked read',
        body: `The document transaction writes the new source version and outbox record together. An indexer consumes the event, fetches or receives the corresponding content under a trusted service identity, and conditionally applies it only if its version is newer than the indexed version. Repeated events are harmless; delayed old events cannot overwrite new text. Deletion publishes a versioned tombstone and removes searchable fields. Acknowledgment or checkpoint follows recoverable index output, not merely parsing the event.\n\nA query planner chooses relevant tenant partitions, expands the query under configured limits, and gathers ranked candidates. Before returning anything sensitive, the API checks current document state and user access in a batched authority call. It hydrates authorized text for snippets or verifies that indexed snippets correspond to an allowed current version. Overfetch compensates for filtered candidates within a fixed work budget. If too many candidates are rejected, return a shorter page rather than leaking stale data or scanning without limit.`,
      },
      {
        title: 'Keep permissions and pagination safe under change',
        body: `Indexing access-control lists can improve candidate filtering, but their freshness is not enough to enforce immediate revocation. Use them as an optimization plus current authorization, or a permission epoch scheme with an authority that proves freshness. If the authority is unavailable, private results fail closed. Counts, facets, and suggestion APIs also need scrutiny: returning a private document's title as an autocomplete option is still a leak even if clicking it later fails.\n\nA cursor encodes query identity, sort boundary, and an index snapshot or generation, protected against client tampering. Offset pagination becomes slow and unstable on large result sets. Score ties require a stable document-ID tiebreaker. When the index generation changes, either keep the old search snapshot for a bounded interval or return a clear cursor-reset response. A cursor from another tenant or a different query must not be accepted as an arbitrary shard instruction.`,
      },
      {
        title: 'Rebuild and recover without an indexing gap',
        body: `Analyzer changes require a new index generation. Take a source snapshot at a known change-stream boundary, build the new index, and replay later changes until caught up. Preserve tombstones and source versions so deleted documents do not reappear when an older snapshot record races a newer event. Compare coverage, authorization-filter behavior, and representative ranking before atomically switching a logical alias. Keep the previous generation available for rollback under bounded retention.\n\nIf indexing stalls, ordinary searches may return older authorized content within policy, while the UI exposes freshness degradation. The current permission authority remains necessary. A corrupted index can be rebuilt from source and retained changes; the index is not the only copy. Back up source content and metadata independently. Replay throughput must be budgeted so rebuilding does not overwhelm the same document service used for live hydration. Consumer lag approaching log retention is a recovery deadline, not merely a dashboard curiosity.`,
      },
      {
        title: 'Control query cost and observe relevance separately',
        body: `Prefix expansion, fuzzy terms, wildcard filters, and broad phrases can create expensive work far beyond HTTP request count. Bound terms, expansion count, timeout, shards, and candidate volume. Apply tenant query budgets and cancellation, and isolate bulk exports from interactive search. Cache safe query plans and public results where useful, but private result caches include identity or validated permission scope and an explicit freshness policy. Negative and empty-result caches must not conceal newly indexed content too long.\n\nMeasure latency, scanned postings, shard fanout, index lag, authorization rejection ratio, empty results, and timeout rate. Relevance needs separate evaluation using original labeled queries and user feedback, not just low latency. Avoid logging raw sensitive query text by default. Test revoked membership, deleted documents, cross-tenant filters, and stale snippets. A fast engine can still be an unsafe search service if access checks happen only after content is sent to the client.`,
      },
      {
        title: 'Choose an index architecture proportionate to need',
        body: `A database full-text index is a credible simpler starting point when corpus size, language support, and ranking requirements fit. Appropriate multicolumn indexes also help metadata filters, though their column order and query patterns matter. A dedicated inverted-index service offers specialized posting compression, scoring, and distributed query features at the cost of a second consistency pipeline and operational burden. The 48 GB source estimate is not a prediction of final index size; measure term frequency, stored fields, and replica overhead.\n\nTenant-based routing improves locality and isolation but very large tenants may need multiple shards. Global top-k merging increases tail latency and requires bounded shard work. Vector retrieval or hybrid semantic search introduces embedding versions, model drift, and additional authorization paths, so it is not a free switch. This case intentionally supports keyword retrieval first. Cross-region indexes can tolerate text lag while current permission checks follow a stricter region and failure policy.`,
      },
    ],
    followUps: [
      { question: 'Why not trust access-control fields stored in the index?', answer: 'They can lag revocation or be overwritten by a reordered indexing event. They are useful for reducing candidates, but private titles, snippets, counts, and suggestions need current authorization or a proven current permission epoch. Batch checks keep cost bounded. If the authority is unavailable, do not send uncertain private content. The design permits bounded text staleness without permitting stale access rights, because those are distinct promises with very different consequences.' },
      { question: 'How do you rebuild without resurrecting deleted documents?', answer: 'Capture a source snapshot and change-stream boundary, retain deletion tombstones, and apply every record by source version. A newer deletion prevents an older snapshot document or delayed update from recreating searchable text. Replay through a measured high-water mark before alias switch, then keep live indexing on the new generation. Compare source and index counts plus targeted deleted-ID probes. Counts alone can match while individual deleted documents have been replaced by other missing ones.' },
      { question: 'What if permission filtering removes almost every candidate?', answer: `Overfetch in bounded batches and stop at a fixed scan or time budget. Return a shorter page with an appropriate cursor instead of an unbounded loop. Investigate whether stale ACL projections, poor tenant routing, or the user's very narrow permissions cause the rejection ratio. Improve candidate filtering without making it the sole authority. A page-size promise should be best effort after authorization, because guaranteeing fifty visible results can require arbitrarily expensive search in pathological cases.` },
    ],
    lessonIds: ['search-indexing', 'event-streams', 'migrations', 'security', 'sharding', 'observability'],
    sourceIds: ['pg-indexes', 'outbox', 'kafka-design', 'owasp-object-auth', 'sre-overload'],
  },
  {
    problemId: 'collaborative-editor',
    summary: 'A sequence-operation editor separates convergent text state from durable acceptance, ordered reconnect history, and revocable access.',
    assumptions: ['Hypothetical workload: 20,000 concurrent editors averaging two batched operations per second, with 180 bytes per persisted operation.', 'Connected remote edits target p95 visibility within 200 ms regionally; an acknowledged operation is durable.', 'Offline editing is supported for seven days. A document can have up to 100 simultaneous editors; presence is best effort.'],
    diagram: `Editor -> authenticated document session -> operation authority
   ^                                         |
   |                               durable op log + dedupe
   |                                         |
   +---- realtime broadcast <--------- commit outbox
   |
   +---- snapshot + cursor catch-up <- snapshot store
Compactor -> stable frontier -> versioned snapshot + retained ops
Presence -> separate expiring channel`,
    calculations: [
      { label: 'Average active operation rate', factors: [20000, 2], divisor: 1, result: 40000, unit: 'operations/second', assumption: 'Rate during stated concurrent activity, not a full-day average.' },
      { label: 'Logical operation bandwidth', factors: [20000, 2, 180], divisor: 1000000, result: 7.2, unit: 'MB/second', assumption: 'Decimal MB encoded payload; excludes broadcast fanout, indexes, and protocol framing.' },
      { label: 'Eight-hour logical daily operation log', factors: [20000, 2, 180, 8, 3600], divisor: 1000000000, result: 207.36, unit: 'GB/day', assumption: 'Hypothetical eight-hour equivalent activity period; no compression, replication, or snapshot bytes included.' },
    ],
    sections: [
      {
        title: 'Choose an operation model instead of last-writer-wins text',
        body: `Replacing the whole document on every save loses concurrent work. This design uses a sequence CRDT implementation with formally specified insertion, deletion, and merge rules, rather than inventing a few tie-breakers and assuming they converge. Insert operations identify an anchor and globally unique element IDs; deletes reference elements rather than mutable character offsets. Concurrent insert ordering follows the algorithm's deterministic rule, not wall-clock arrival time. The wire protocol includes actor, counter, dependencies, and document epoch.\n\nThe server validates operation shape, bounds, dependencies, and authorization. Convergence means replicas receiving the same valid operations eventually derive the same text; it does not by itself guarantee durable storage, permission enforcement, or intended human wording. A vetted algorithm and property-based tests are important because a superficially plausible merge rule can fail under reordered dependencies or compaction. Comments, formatting, and structured tables need their own operation semantics beyond plain text.`,
        code: `POST /documents/d8/operations
{"epoch":3,"actor":"device7","counter":88,
 "dependencies":{"device7":87,"device4":21},
 "kind":"insert","anchor":"device4:21","elements":[{"id":"device7:88:0","text":"A"}]}

operation identity: (document_id, epoch, actor, counter)
reconnect: GET /documents/d8/state?epoch=3&after=log_cursor_901`,
      },
      {
        title: 'Trace local optimism into durable remote visibility',
        body: `A client applies a local edit optimistically and persists its outgoing operation before showing it as saved. The server checks current membership, deduplicates the operation identity, and appends it durably with a server log cursor. Only then does it acknowledge and broadcast through the outbox. The client marks that outgoing operation committed and retains the cursor. A lost response leads to retry of the same operation, not generation of a new insertion with the same visible character.\n\nRemote clients apply committed operations according to the CRDT rules and request missing dependencies when necessary. The server cursor orders transport history and recovery; the CRDT element order determines text. These are different orders and need not match. On reconnect, fetch a snapshot at a defined cursor, then later operations, with overlap deduplication. Socket events are a low-latency path, not the durable authority. Typing and cursor presence use a separate expiring channel.`,
      },
      {
        title: 'Manage offline edits and access revocation',
        body: `Offline clients retain their last epoch, state, and unsent operations. On reconnect within the supported window, the server verifies that dependencies remain reconstructible and that the user still has edit permission. A user revoked while offline cannot simply upload operations under an old session token. Keep membership epochs or current permission checks at acceptance, and remove revoked realtime subscriptions. Already downloaded content remains outside the server's ability to retract.\n\nCompaction can invalidate old element anchors if it discards history too aggressively. Define a stable frontier based on supported clients and retention, preserving the tombstones or mappings needed by active replicas. Clients older than the frontier receive an epoch-reset response and a new snapshot. Their unsent edits are reconciled through an explicit recovery flow, possibly as a local draft or conflict document. Do not silently reinterpret old offsets against unrelated new text and call that convergence.`,
      },
      {
        title: 'Keep authority ownership and compaction recoverable',
        body: `A document authority serializes acceptance and validates dependencies, while the CRDT supports concurrent client intent. Failover uses a fenced ownership generation checked by log storage, so a paused old authority cannot keep acknowledging operations. A split authority that accepts independently without a defined durable merge and authorization policy can lose acknowledged work or admit revoked users. During a partition, this service may allow local unsaved editing while withholding durable-save acknowledgment until authority returns.\n\nSnapshots are derived from a committed operation prefix and include algorithm version, epoch, frontier, and checksum. Write immutable snapshot bytes before publishing their metadata pointer. Retain sufficient log overlap to verify and roll back a bad snapshot. Compaction is not backup: a faulty compactor can faithfully delete needed history from every replica. Independent backups and restore tests reconstruct both visible text and identity metadata. Recovery replays stable operations idempotently and checks state hashes across replicas.`,
      },
      {
        title: 'Bound hot-document fanout and observe convergence',
        body: `Forty thousand active operations per second can produce much larger broadcast traffic when documents have many editors. Batch adjacent local edits over a short latency budget and route each document to a bounded authority partition. Slow clients receive a resync instruction after buffer limits, not unlimited gateway memory. Per-document operation rate and size limits defend against accidental loops or malicious dependency graphs. Presence updates can be sampled or dropped without weakening text durability.\n\nObserve acceptance latency, acknowledgment-to-broadcast lag, dependency gaps, duplicate operations, client state-hash divergence, snapshot validation failures, and epoch-reset frequency. A low server error rate can coexist with corrupted text, so convergence tests and synthetic concurrent editing matter. Do not log document bodies or precise collaborator cursor positions unnecessarily. Authorization applies to snapshot downloads, operation history, comments, and exports as well as edit submission. Actor IDs are issued or bound to sessions so one client cannot forge another's counter stream.`,
      },
      {
        title: 'Compare central transformation and CRDT tradeoffs',
        body: `Operational transformation with a central revision stream is a credible alternative for mostly connected users, but transform functions and reconnect rebasing must be correct for every supported operation pair. A sequence CRDT eases some offline merge patterns while adding identifier, tombstone, and compaction costs. Neither label guarantees a usable editor. Product behavior for concurrent deletion and insertion needs examples and tests, including Unicode graphemes and undo that should not erase another user's later work.\n\nPartition by document to preserve local validation and fanout locality. A very large document remains a memory and hot-partition problem; sections or subdocuments may help but complicate cross-section edits and references. Multi-region local authorities require a designed replicated acceptance protocol and permission policy, not just eventual text merge. This case deliberately uses a regional durable authority and offline drafts. It omits rich spreadsheet formulas and arbitrary code execution, whose dependency and sandboxing requirements are distinct.`,
      },
    ],
    followUps: [
      { question: 'Does CRDT convergence mean the server can acknowledge before persistence?', answer: 'No. Convergence concerns the resulting state after valid operations are exchanged; it does not preserve an operation lost from volatile memory. Acknowledge saved status only after durable append under the selected storage policy. Broadcast follows that commit, and reconnect history is derived from the durable log. Local optimism can remain responsive during an outage, but the UI must distinguish unsaved local changes from acknowledged changes. This separation prevents a fast-looking editor from silently losing work on authority restart.' },
      { question: 'How do you compact without breaking an offline user’s anchors?', answer: 'Retain the identity metadata required by clients within the supported offline window, or preserve an algorithm-correct anchor mapping at a stable frontier. Do not discard tombstones based only on snapshot age. A client beyond the retained frontier receives a new epoch and an explicit draft-recovery flow for unsent edits. Validate compaction by replaying delayed operations against both uncompacted and compacted state. If they differ, the compaction protocol is incorrect even when the current snapshot text looks identical.' },
      { question: 'Can undo simply delete the last inserted range?', answer: 'Not safely under concurrent editing if that range is represented by shifting offsets or includes someone else’s later insertion. Undo should reference the originating operation or element identities and follow documented algorithm semantics. Deleting one actor’s elements preserves concurrent elements according to the merge model; undoing a deletion may need a new insertion rather than resurrecting old identity blindly. Test concurrent insert, delete, undo, and reconnect permutations. Human-friendly undo requires product rules beyond eventual replica equality.' },
    ],
    lessonIds: ['realtime', 'transactions', 'replication', 'reliability', 'security', 'tradeoffs'],
    sourceIds: ['jepsen', 'outbox', 'pg-isolation', 'owasp-object-auth', 's3'],
  },
  {
    problemId: 'location-matching',
    summary: 'A geospatial candidate cache proposes nearby technicians, while transactional assignment and fencing establish exclusive ownership.',
    assumptions: ['Hypothetical workload: 80,000 online technicians sending a location update every five seconds and 120 task requests per second at peak.', 'Location updates older than 20 seconds are not eligible for automatic matching; assignment p95 target is two seconds after admission.', 'Each technician has at most one active assignment. Initial offers expire after 15 seconds unless accepted under the current generation.'],
    diagram: `Technician -> location ingest -> latest-location store -> cell index
Task requester -> matching API -> nearby candidate query
                                      |
                                offer/assignment DB
                                      |
                                  outbox -> push offer
                                      ^
Technician accept -> conditional fenced transition
Expiry worker -> generation-checked release`,
    calculations: [
      { label: 'Active location ingestion', factors: [80000], divisor: 5, result: 16000, unit: 'updates/second', assumption: 'Rate while all stated technicians are online; not a full-day average.' },
      { label: 'Logical latest-location payload', factors: [80000, 120], divisor: 1000000, result: 9.6, unit: 'MB', assumption: '120 bytes per latest-location record; excludes cell index, history, replicas, and storage overhead.' },
      { label: 'Peak candidate evaluations', factors: [120, 60], divisor: 1, result: 7200, unit: 'candidates/second', assumption: 'Sixty evaluated candidates per task under a bounded search policy, excluding retries.' },
    ],
    sections: [
      {
        title: 'Separate proximity from exclusive assignment',
        body: `The nearby index is an approximate, rapidly changing candidate source. It cannot prove a technician is still available when an offer is made. Store authoritative technician availability and assignment state in a transactional database, while latest location and cell membership live in a serving cache or specialized spatial store. A task includes required skills, service area, priority, and requester identity. Matching considers those constraints before distance ranking, not just the nearest point on a map.\n\nPUT /technicians/me/location carries session identity, sequence, observation time, coordinates, and accuracy. POST /tasks creates a durable task with a request key. POST /offers/{id}/accept authorizes the technician and checks current offer generation. Precise location is sensitive: requesters may receive approximate arrival information rather than raw technician trajectories. Random task IDs do not grant visibility into someone's route, schedule, or address.`,
        code: `locations(technician_id, session_epoch, sequence, observed_at, received_at,
          latitude, longitude, accuracy_m)
assignments(task_id, technician_id, state, generation, offer_until)
UNIQUE(technician_id) WHERE state IN ('offered','accepted','working')
UNIQUE(task_id) WHERE state IN ('offered','accepted','working')

POST /offers/o19/accept
{"generation":7,"requestKey":"accept-device3-61"}`,
      },
      {
        title: 'Walk through location ingestion and nearby search',
        body: `Authenticate each update, validate plausible coordinates and bounded timestamp skew, and accept only a newer sequence within the current session epoch. Device wall time alone cannot safely order updates. Track server receipt time separately and reject automatic matching when freshness or accuracy is insufficient. Updating the latest point and derived cell index may not be atomic, so candidate retrieval rechecks the current point and deduplicates technicians appearing in both old and new cells.\n\nA matcher searches the request's spatial cell and neighboring cells, expanding within a bounded radius and candidate budget. Cell boundaries must not hide a closer technician just across the edge. It computes real distance and optionally estimated travel time for filtered candidates, using a documented fallback if route estimation fails. The resulting ranking is advisory. Before sending an offer, a transaction checks current availability and inserts exclusive task-and-technician ownership. A stale cache candidate simply loses that conditional race.`,
      },
      {
        title: 'Make offers, expiry, and acceptance race safely',
        body: `The ownership transaction records the offer, expiry, and generation, and writes an outbox event for notification. A unique active-assignment constraint or equivalent atomic availability transition prevents two matchers from assigning the same technician. Likewise, the task cannot acquire two active technicians accidentally. An acceptance checks technician identity, task state, offer ID, generation, and database-time expiry in one transaction. A browser or phone countdown cannot override the authoritative deadline.\n\nAn expiry worker releases only the generation it observed. If it pauses and a new offer is created, its stale release changes zero rows. Delayed push notifications can show old offers, so the accept endpoint remains authoritative. Retried acceptance uses a stable key and returns the existing result. Physical travel and human actions are not fenced by a database generation; the product must communicate cancellations clearly and manage a technician who acted on an obsolete notification.`,
      },
      {
        title: 'Recover from stale locations and disconnected workers',
        body: `When a technician disconnects, stop considering its location after the freshness window without immediately inventing a task cancellation. An accepted assignment has a separate liveness and support policy. If the client loses the acceptance response, it queries authoritative assignment status before accepting another offer or starting work. If the notification outbox stalls, offers may expire unseen; replay should not notify an already expired offer. Workers recheck current state before sending and label any remaining race honestly.\n\nA spatial-cache outage can use a bounded fallback over recent region-specific candidates or temporarily pause matching; scanning every technician for every request would overload the authority. Rebuild the index from current location records while accepting newer sequences. Persist only the location history needed for operational and legal purposes under explicit retention. Backups protect assignments and audit records, while a replicated live-location cache is not a historical recovery archive.`,
      },
      {
        title: 'Protect location and evaluate matching quality',
        body: `Technicians can update only their own active session's location, and requesters see only authorized task information. Internal dispatchers receive scoped access with audit trails. Rate-limit location ingestion and reject impossible bursts or grossly implausible movement, but avoid claiming that simple speed checks prove GPS authenticity. Accuracy, urban signal quality, and battery-saving modes affect real users. Abuse defenses need a review path so noisy devices do not unfairly lose work.\n\nMeasure update age, cell-index lag, candidate count, offer conflict rate, accept latency, expiry rate, travel-time prediction error, and completed-match quality. A low matching latency with repeated rejected offers is not success. Track fairness and utilization across service areas rather than optimizing only distance. Logs minimize precise coordinates and retain access evidence. Label-based metrics should use coarse regions, not unrestricted technician IDs. Synthetic tests cross cell boundaries and deliberately reorder updates to catch invisible candidate loss.`,
      },
      {
        title: 'Choose spatial and regional boundaries consciously',
        body: `A hierarchical cell index supports efficient nearby expansion and easy region partitioning. A database spatial index is a simpler option when update volume and query latency fit; its transactions can help but do not eliminate stale observations. Geohash-style prefixes require neighbor handling and careful distance filtering, since lexical closeness is not physical closeness. The tiny latest-record estimate hides high write churn, index maintenance, and optional history growth. Benchmark dense-city hotspots separately from uniform random locations.\n\nPartition assignment authority by service region while defining a border policy. A technician near two regions cannot be independently assigned by both; ownership needs one home authority or a coordinated transfer. During a partition, candidate maps may remain readable while assignment pauses to preserve exclusivity. More aggressive parallel offers can improve acceptance time but require a product rule for winner selection and cancellation. This case chooses one active offer per technician and task, trading some speed for clearer ownership and user expectations.`,
      },
    ],
    followUps: [
      { question: 'How can two matchers select the same nearest technician safely?', answer: 'Both may read that technician from the spatial cache, but only one succeeds at the authoritative atomic assignment transition. A unique active-assignment constraint or locked availability row arbitrates the race. The losing matcher tries another candidate within a bounded retry budget. Never reserve by setting an unguarded cache flag and assuming it is current everywhere. Selection is advisory; ownership is a separate transaction with durable task, technician, expiry, and generation evidence.' },
      { question: 'What if an old phone update arrives after a newer location?', answer: 'Compare server-bound session epoch and monotonically increasing device sequence, not only observation timestamp. Ignore an older sequence and reject updates from an expired session. Keep receipt time for freshness and sanity-check clock skew. The cell index may lag the latest record, so queries revalidate actual current coordinates and deduplicate old and new cell membership. This avoids moving a technician backward in time because packets were reordered, without pretending the remaining GPS observation is exact.' },
      { question: 'Does fencing prevent a technician from physically starting an obsolete task?', answer: 'It prevents stale software actions from changing protected authoritative state when that state checks generation. It cannot undo a human action based on an old notification or a disconnected phone. Show authoritative assignment status, require online confirmation at critical workflow steps where feasible, and communicate cancellation clearly. Support and compensation policies cover residual cases. Do not extend a database fencing guarantee into a promise of exactly-once physical service; the system and human workflow have different control boundaries.' },
    ],
    lessonIds: ['data-modeling', 'transactions', 'caching', 'realtime', 'security', 'sharding'],
    sourceIds: ['pg-isolation', 'pg-indexes', 'outbox', 'owasp-object-auth', 'sre-monitoring'],
  },
  {
    problemId: 'webhook-delivery',
    summary: 'A signed, durable outbound event workflow offers inspectable at-least-once attempts with destination isolation and controlled replay.',
    assumptions: ['Hypothetical workload: 3,000,000 events per day and 1.8 subscribed endpoints per event, with a 2 KB average payload.', 'Ninety-nine percent of first attempts should start within ten seconds for healthy admitted endpoints; each HTTP attempt has a five-second deadline.', 'Automatic retries last at most 24 hours. Endpoint acceptance is not proof of downstream business completion, and duplicates are possible.'],
    diagram: `Product transaction -> event + outbox -> subscription expander
                                                  |
                                            delivery state DB
                                                  |
                                        ready broker + retry timer
                                                  |
                                         isolated egress workers
                                                  |
                                             tenant endpoint
Operator -> authorized attempt history / linked replay`,
    calculations: [
      { label: 'Average first-attempt rate', factors: [3000000, 1.8], divisor: 86400, result: 62.5, unit: 'attempts/second', assumption: 'Daily average before retries and manual replays.' },
      { label: 'Daily logical first-attempt payload egress', factors: [3000000, 1.8, 2, 1000], divisor: 1000000000, result: 10.8, unit: 'GB/day', assumption: 'Decimal KB and GB; excludes HTTP/TLS overhead, responses, retries, and replication.' },
      { label: 'Concurrency if every average-rate attempt times out', factors: [62.5, 5], divisor: 1, result: 312.5, unit: 'concurrent attempts', assumption: 'Five-second timeout at average first-attempt rate, before peak and retry multipliers; operational limit is rounded upward.' },
    ],
    sections: [
      {
        title: 'Define stable events and endpoint contracts',
        body: `An event records a committed product fact with a stable event ID, type, schema version, occurrence time, tenant, and immutable payload bytes or payload reference. An endpoint subscription specifies selected types, URL, signing-secret version, and enabled state. A delivery is one event-to-endpoint relationship with a stable delivery ID; attempts are its individual network calls. Keeping these identities separate makes retry history explainable and lets receivers deduplicate the economic or business event.\n\nThe originating product writes its event and outbox intent in the same transaction as the state change. Expansion creates unique event-endpoint delivery rows, so duplicate outbox publication does not create duplicate relationships. POST /endpoints requires tenant authorization and verifies control under a documented challenge policy. GET /deliveries/{id} exposes attempt results without leaking signing secrets. A successful endpoint response means accepted at that endpoint, not that its own database or external callback completed.`,
        code: `events(event_id, tenant_id, type, schema_version, payload_ref)
deliveries(delivery_id, event_id, endpoint_id, state, next_attempt_at)
UNIQUE(event_id, endpoint_id)
attempts(delivery_id, attempt_no, started_at, outcome, http_status)

Headers:
X-Event-Id: evt82
X-Delivery-Id: del91
X-Signature-Version: v2
X-Signature: HMAC(secret, timestamp + "." + exact_body_bytes)`,
      },
      {
        title: 'Trace a delivery through signing and acknowledgment',
        body: `A worker claims a ready delivery with a bounded lease, reads the immutable payload, and records an attempt before making the network call. It signs the exact bytes with a timestamp and declared secret version, then sends under strict response-size and deadline limits. Receivers verify the signature over raw bytes, check timestamp tolerance, and durably record the event before returning success. Parsing and reserializing JSON before verification can change bytes and break signatures.\n\nOn a known successful HTTP response, the worker stores accepted status and then acknowledges the broker. On a transient failure, it stores the next retry time before acknowledgment. A crash after the endpoint accepted but before local completion produces a duplicate attempt after recovery. Stable event and delivery IDs allow receiver deduplication, but only the receiver can make its local business updates atomic with its deduplication record. The sender cannot promise exactly-once effects at an arbitrary endpoint.`,
      },
      {
        title: 'Specify retry, ordering, and replay behavior',
        body: `Retry timeouts, connection failures, rate-limit responses, and selected server errors with exponential backoff and jitter within a 24-hour age budget. Honor bounded retry guidance where supported, but do not let an endpoint defer work indefinitely or force synchronized retries. Permanent configuration failures pause the endpoint or fail deliveries with a clear reason. Unknown acceptance remains a possible duplicate, not proof of loss. Each endpoint has concurrency and retry budgets so a failing destination does not dominate workers.\n\nThis design does not guarantee global event order. If a product needs per-object order, partition and serialize that key or include object versions that receivers can reconcile. Retries can still arrive after newer events. Manual replay creates an audited replay request linked to the original event and delivery, with the same event identity and a distinct replay or attempt identity. Changing historical payload bytes under the old ID would make receiver deduplication and signature diagnosis inconsistent.`,
      },
      {
        title: 'Treat outbound URLs as an untrusted network boundary',
        body: `An authorized tenant can still submit a dangerous destination. Restrict schemes and ports, reject private, loopback, link-local, and prohibited address ranges, and enforce the policy at connection time through controlled egress. Registration-time DNS validation alone is insufficient because DNS can change. Disable redirects or revalidate every redirect target. Pin the validated connection target while preserving correct host verification, and apply network-level restrictions as defense in depth. An endpoint challenge does not prove a URL will remain safe forever.\n\nLimit response bytes, compression expansion, idle time, and total attempt duration. Workers have no access to internal control-plane credentials or metadata services. Store endpoint secrets encrypted and never print signed headers or full private payloads in ordinary logs. Secret rotation supports an overlap window and explicit version so receivers can accept old queued attempts safely. Endpoint URL changes create a new configuration version with a documented policy for queued deliveries.`,
      },
      {
        title: 'Recover stalled work and provide safe operations',
        body: `Outbox publication and broker confirmation may be ambiguous, so expansion and delivery claims are idempotent. A reaper finds expired claims and schedules a recoverable attempt, checking generation so a paused old worker cannot overwrite newer state. This protects local records but cannot fence a remote HTTP request already in flight. Inspection tools show response classification, timing, and redacted excerpts, with tenant authorization on every delivery and replay action.\n\nA dead-letter or terminal-failure state is useful only if operators can diagnose and replay under a budget. Separate replay traffic from live first attempts and require confirmation for large batches. Backups preserve events, endpoint configuration, and delivery history; after restoration, reconcile already accepted deliveries before mass replay where possible. Broker acceptance and consumer completion metrics remain distinct. Endpoint deletion disables new sends and invalidates queued work according to policy, while already transmitted payloads cannot be retrieved from the receiver.`,
      },
      {
        title: 'Scale by destination and measure useful reliability',
        body: `The average 62.5 attempts per second is small, but a five-second timeout already requires hundreds of concurrent connections. Peaks, retries, and slow endpoints multiply that demand. Partition queues or scheduling by endpoint hash, with fair tenant budgets and a maximum per-destination concurrency. Connection pooling improves efficiency but must respect DNS, egress validation, and endpoint version changes. Keep large immutable payloads out of repeated queue copies by using authorized internal references.\n\nObserve first-attempt age, retry age, endpoint acceptance rate, unknown outcomes, destination-specific saturation, and replay volume. Overall success can hide a permanently failing tenant, so expose endpoint health without unbounded endpoint labels in global metrics. Polling APIs are a credible alternative for clients unable to host public endpoints, trading latency for simpler network control. A managed delivery provider may reduce operations but still requires event identity, security, and receiver deduplication. This service guarantees durable intent and inspectable attempts, not recipient business completion.`,
      },
    ],
    followUps: [
      { question: 'What should the receiver do before returning HTTP 200?', answer: 'Verify signature and timestamp, then durably record the event or commit its local idempotent business transition before responding. Heavy asynchronous work can continue afterward from a receiver-owned queue. Returning success before any durable record risks losing the event if the receiver crashes. Repeated event IDs must not repeat the local effect, and parameter or schema inconsistencies should be diagnosed. The sender interprets success as endpoint acceptance only, not proof that every downstream task has finished.' },
      { question: 'How do you handle DNS rebinding for a registered endpoint?', answer: 'Validate destinations at connection time and enforce prohibited-address rules in a controlled egress path, not only during registration. Resolve and connect to an approved target under a coherent policy, verify TLS for the intended hostname, and block redirects or revalidate them. Network restrictions prevent access to internal and metadata ranges even if application validation misses a case. Recheck when configuration or DNS changes. Ownership verification and HTTPS do not make a tenant-provided URL intrinsically safe.' },
      { question: 'Why can a durable broker still produce duplicate webhook calls?', answer: 'A worker can send the request successfully and crash before persisting accepted status or acknowledging its broker delivery. Redelivery then repeats the call. Publisher confirmation proves broker acceptance, while consumer acknowledgment records handling of a particular delivery; neither atomically includes the remote endpoint. Stable event IDs, receiver deduplication, and local attempt history manage this boundary. Leases and fencing protect sender state but cannot revoke an HTTP request already in flight at an external system.' },
    ],
    lessonIds: ['queues', 'api-design', 'security', 'reliability', 'rate-limiting', 'observability'],
    sourceIds: ['outbox', 'rabbitmq-acks', 'stripe-webhooks', 'http-semantics', 'owasp-object-auth'],
  },
];
