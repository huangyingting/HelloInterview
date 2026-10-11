# Original premium workflow design

These workflows are independent designs based on common interview-preparation
needs, not recovered implementations of locked Hello Interview features.
They use the existing local demo entitlement: no payment is required.

## Entry and access

Open **Premium Studio** in the sidebar, or activate a demo plan from **Plans**
and follow **Open Premium Studio**. The hub connects four complete workflows
and company-focused practice packs. Company suggestions are original study
curation, not insider reports or verified current company interview loops.

Free users can discover the tools but cannot create or mutate premium sessions.
Authorization is enforced by the API, not just hidden buttons. Saved completed
reports, quiz results, study schedules, and project snapshots remain available
after access ends; starting or editing premium work requires active access.
Account JSON export includes the new records.

## Adaptive mock interviews

Routes: `/premium/mock` and `/premium/mock/:id`.

1. Choose an original exercise, company context, level, and three or five turns.
2. Answer the initial prompt. Save a draft to pause, or submit to save and grade.
3. The interviewer selects a follow-up based on topic gaps across earlier
   answers, prioritizing focuses not yet asked. Staff/manager prompts request
   wider impact. Behavioral follow-ups cover context, responsibility, personal
   actions, results, and reflection.
4. Each response and its feedback become a permanent transcript turn. The
   final turn produces an aggregate report with strengths, improvement prompts,
   a learning-library link, and JSON export.

**Adaptation is local and heuristic.** Keyword coverage is not semantic
understanding or evidence of mastery. It is not the reference adaptive pipeline.
Feedback uses the labeled local rubric unless a provider is configured.
Configured grading sends the question, exercise, level, company context, prior
responses, and current response to that provider.

Draft saving precedes grading. Provider failures leave the draft intact.
Revision checks prevent a late response or another tab from overwriting newer
work. Access is checked again when asynchronous grading finishes. The archive
currently accepts up to 100 sessions per account.

Draft, reflection, and project editing fields are disabled during pending
saves or grading so a response cannot discard newly typed input in that screen.
Browser tests hold requests open to verify this behavior.

## Custom quiz sessions

Routes: `/quiz/custom` and `/quiz/custom/:id`.

Choose one or more original topics, a title, a question count (up to 20), and
either the whole selected pool or only missed questions. The server selects
distinct questions and stores their order. Requests exceeding the matching
pool are rejected rather than silently changing the requested length.

Checking or skipping commits one answer before returning its explanation.
Advancing moves the screen to the next question without changing the saved answer.
Reload resumes the next unanswered
question. Every question must be answered or explicitly skipped before the
server computes the score; the browser cannot supply a trusted score.
Misses enter the existing review deck, correct answers remove those questions,
and repeated finalization does not award duplicate recognition.

New sessions pin their question order, options, keys, explanations, and sources
in an immutable server snapshot; scoring and completed reports do not silently
switch to the current catalog. The browser receives only the next unanswered
prompt/options until it commits an answer. Completed sessions show
answers/explanations, appear in the quiz library, and can be exported with their
question snapshots even after access expires. Unversioned legacy reports are
labeled separately. The original question bank is still much smaller than the
reference catalog. The custom archive holds up to 100 sessions.

## Company-focused preparation plans

Routes: `/premium/plans` and `/premium/plans/:id`.

Choose a company, level, valid start date, two/four weeks, and three/five
sessions per week. The schedule combines original lessons, quizzes, practice,
mock interviews, and (at the five-session pace) written reflections.

Company curation orders the learning disciplines. Level influences exercise
difficulty. Missed quiz topics influence the next checks. Resources are spread
across the schedule rather than assigning the same lesson/quiz several times.
Dates are UTC calendar dates, including month/year boundaries.

Progress is derived from actual saved actions: read lessons, completed quizzes,
evaluated practice, and completed mocks matching the plan's company/level.
Only reflections use a directly saved written note. This avoids a second set
of detached completion checkboxes. Previously completed learning remains
recognized. Plans can be revisited/exported and the archive holds 20 plans.

## Snapshot-based project workbench

Routes: `/premium/projects` and `/premium/projects/:id`.

Choose one of the original coding acceptance tasks and use its starter file,
or import UTF-8 text source snapshots. Limits are 16 tracked files, 20,000 characters
per file, and 120,000 current-content characters per snapshot.

Relative paths are validated. Traversal, credential/generated paths, and
unsupported paths are rejected before browser reading and again by the server.
Invalid UTF-8 and binary NUL content are rejected rather than silently decoded.
This is **not a secret scanner**: sensitive information inside otherwise valid
files cannot be guaranteed absent. Do not import confidential code or secrets.

The initial contents are immutable baselines. Editing, adding, and deleting
files produces a diff against that baseline. Saving never replaces it with a
client-supplied baseline. Code whitespace and final newlines are preserved.
UTF-8 byte-order marks and ordinary LF/CRLF line endings are preserved. Patch
export supports additions, deletions, empty files, and missing final
newlines, and is checked by actually applying generated patches in tests.

The editor can run the selected JavaScript file's synchronous `solve(input)`
against the original task's example cases in the existing browser sandbox.
Other language files can be viewed/edited, but imports, dependency installation,
and backend execution are not supported. Example results are session-local;
verification notes are explicitly user-reported, not certified test execution.

Review requires a real file change, explanation, and verification notes. It
uses the local rubric or configured AI. Configured review sends the explanation,
verification notes, and diff, not a remote repository credential. Editing a
reviewed snapshot invalidates its previous feedback. Revision/access checks
also protect asynchronous reviews. Export the current snapshot or a patch to
continue in your own editor. The archive holds 20 workspaces.

**This is not a live BYOE/IDE bridge.** No repository is cloned, no terminal is
exposed, and no remote upload is performed.

## Validation

`npm run test:unit` covers adaptive focus selection, unique/bounded quiz sets,
canonical grading, every company/level/schedule combination, progress rules,
source paths, and actual Git patch application.

`npm run test:ai` uses a loopback provider fixture to verify mock/project grading,
stale-response protection, access ending during grading, and persistence of
all premium record types across an application-process restart. No real AI key
or external provider is used by these tests.

`npm test` exercises access gates, mock draft/branch/report/export, custom quiz
resume/scoring/review, plan progress/reflections, real file import and baseline
preservation, project execution/diff/review/invalidation, ownership, stale
revisions, and mobile layout alongside all existing free workflows.

Screenshots `31` through `40` in `docs/screenshots/` show the new workflows.
Live identity, payments, email delivery, production moderation, external IDE
connectivity, and proprietary content parity remain separate integration gaps.
