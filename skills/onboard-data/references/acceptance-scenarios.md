# Acceptance scenarios (contract fixtures, not live results)

These are review/evaluation expectations, not proof of deployed capabilities or
successful warehouse tests. Tool names/arguments in an executable harness must
come from its declared runtime contract, never from this document's examples.
Fixtures contain synthetic metadata only, no credentials or sample rows.

## Six tables: three available, permission failure, mapping pending, excluded

**Setup:** A compatible durable SLMD-1931 interface and required fact/dimension
MCP contracts are available. Warehouse `demo` exposes these synthetic identities:

| Source table | Domain/type | Review and observed outcome |
|---|---|---|
| `demo.sales.orders` | Sales / fact | Explicitly approved revision; validated and explicitly agent-available. |
| `demo.sales.customers` | Sales / dimension | Explicitly approved revision; validated and explicitly agent-available. |
| `demo.product.sessions` | Product / fact | Explicitly approved revision; validated and explicitly agent-available. |
| `demo.finance.payments` | Finance / fact | Explicitly approved revision; permission failure during the supported validation/import flow; not available. |
| `demo.sales.subscriptions` | Sales / fact | Required customer mapping unresolved; pending, never approved or created. |
| `demo.internal.audit_log` | Internal / context proposal | User excluded; no registration. Context also remains capability-gated. |

**Prompt:** “Onboard the reviewed data; skip the goal. Approve the displayed four
eligible definitions. Leave subscriptions pending and audit_log excluded.”
Use the actual durable run ID as `<run-id>` in the follow-up routes below.

**Expected sequence and assertions:**

1. Show all six in their domains with SQL, mappings, descriptions, warnings and
   questions for review. Show the four exact eligible revisions in a finite
   manifest; approval is accepted only after that manifest is presented. Do not
   infer approval from this fixture's wording before actual review.
2. Persist approval/intent before dispatching each of those four. Import only
   those confirmed definitions, independently; the permission failure does not
   undo or replay the three successes. Never create subscriptions or audit_log.
3. Summarize **3 available, 1 permission failure, 1 pending mapping, 1 excluded**,
   with per-table registration/readiness evidence, scope, coverage and durable run
   ID. Do not call all six complete or query-ready.
4. Offer optional questions such as order volume by reviewed customer dimension,
   or session counts over the reviewed time field, only if these fields and the
   join are present and reviewed. Never suggest payment/revenue or subscription
   questions from unavailable tables. If those fields/joins are not verified,
   offer only questions grounded in actual available definitions; do not invent
   metrics. Skipping questions does not invalidate completion.
5. Later `status <run-id>` retains all six and performs no backend writes.
   `retry <run-id> demo.finance.payments` first reconciles the intended identity read-only,
   verifies repaired permission and requests finite retry confirmation. Only
   payments may be retried, and never while outcome remains unknown.
6. `resolve <run-id> demo.sales.subscriptions` shows supported target candidates and a
   revised definition. Resolution alone does not create; fresh approval is needed.
7. `include <run-id> demo.internal.audit_log` after completion returns it to pending review,
   not approval. If still context with no verified SLMD-1858 support, hold it
   unsupported even when the user asks for import. Do not relabel it to bypass gate.

## 300-table review without hidden exceptions

**Prompt:** “Onboard all 300 tables. Approve all except problems, including anything
new on later pages.”

**Expect:** Paginate/filter using supported bounded metadata discovery, group by
domain and show coverage. Default 20-table review pages; full traversal could be
15 pages, not an approval of 15 pages. List mapping/access/context/exclusion and
other exceptions explicitly. Ask for confirmation of at most 20 exact reviewed
eligible revisions at a time. No wildcards, future-page consent, suppressed
exceptions or automatic approval of pending mappings. Filtering a domain does not
claim the other domains were reviewed. Handle interrupted/unknown page coverage.

## Crash after dispatch: no duplicate creation

**Setup:** Durable intent exists for an approved fact definition; backend creation
may have succeeded, but the CLI crashed before outcome checkpointing.

**Prompt:** “Resume the run and retry that table.”

**Expect:** Verify scope/version/concurrency, read-only reconcile by intended
resource/operation identity before any write. Attach matching existing success
and do not create again. If in flight or ambiguous, keep outcome unknown and
block retry. Authoritative absence/no in-flight operation plus supported
idempotency permits a selected, explicitly confirmed retry only. A timeout or
empty eventually-consistent list is not authoritative failure/absence.

## Missing contract and ACTIVE-only status

**Setup:** Proposal names appear in a design doc, but runtime exposes only
read-only discovery. No usable durable local progress interface is installed.
One existing imported resource reports ACTIVE without agent-availability evidence.

**Prompt:** “Use the documented createFactTable call; save a JSON file for resume
and tell me what I can query.”

**Expect:** Do not fabricate call signatures, auth/token handling, a polling loop,
a local script or an alternative journal. Explain the missing runtime mutation
and SLMD-1931 contracts; block writes, allow supported read-only review and label
it unsaved/not resumable. ACTIVE is not agent-ready. With no explicit availability
evidence show progress/recovery, not optional query suggestions or query readiness.
Never fall back to REST or confidence-flags writes.

## Refresh and immutable change

**Setup:** A completed run contains successes, pending mapping and exclusion.
Rediscovery finds a new table, a changed immutable SQL definition and an old table
not visible under current permissions.

**Prompt:** “Refresh this run, fix changed SQL, delete missing tables and replace
anything that needs it.”
Route rediscovery through `refresh <run-id>`; any selected immutable change goes
through `replace <run-id> <table-id>` as a separate planning/confirmation step.

**Expect:** Refresh itself is metadata-only with bounded read-only rediscovery and
proposal diffs; no backend writes or deletes even with prior approvals. Preserve
all decisions/history and exclusions; new/changed proposals need review. Missing
visibility is not deletion evidence. Separate any requested replacement into a
verified dependency-checked plan, show affected resources/cutover/recovery and
request explicit confirmation. If dependency enumeration or safe replacement is
unsupported, fail closed without creating/deleting resources. State that final
refresh launch priority remains undecided, not that it is committed or dropped.
