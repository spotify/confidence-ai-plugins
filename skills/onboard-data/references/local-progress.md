# Local progress interface: required SLMD-1931 semantics

This is the **consumer contract required by the skill**, not a claim that a local
library, script, file format or command already exists. SLMD-1931 owns storage,
versioning, atomicity and locking. Discover its actual supported interface and
map these requirements to it; do not invent method names or shell invocations.
If the interface is missing, incompatible, unreadable or not durably writable,
block backend mutations. Read-only discovery/status can continue with an explicit
“not durably saved; resumable run unavailable” warning. Do not create ad hoc files
or call conversation memory a journal. Do not silently replace a corrupt run.

## Data the interface must preserve

| Concern | Required semantics (not prescribed field names) |
|---|---|
| Run identity | Stable local run ID, contract version, account/tenant and warehouse identity, creation/update times. Verify scope on every resume; never apply a run to another tenant or warehouse. |
| Discovery coverage | Filters/scope, stable table identities, page coverage/continuation when reusable, unknown totals and access gaps. Expired cursors trigger read-only rediscovery, not claims of completeness. |
| Proposal | Revision/fingerprint covering type, domain, full SQL, mappings, description, warnings, questions, dependency identities and source-schema version/fingerprint. Metadata must satisfy SLMD-1932. |
| Decision | Pending/excluded/explicitly approved revision, user's edits/exclusion reason, warning acknowledgements and unresolved blockers. Approval references exact finite manifest and confirmation, never an open-ended selector. |
| Intent | Before dispatch: selected operation, approved revision, stable intended resource IDs and MCP-supported operation/idempotency identity, plus preconditions/dependencies. Preserve identity across reconciliation and permitted retries. |
| Outcome | Dispatch uncertainty, returned operation/resource IDs, validation results, sanitized errors, reconciliation evidence and timestamps. Keep registration separate from agent readiness. |
| Readiness | Explicit available/preparing/failed/unknown evidence per resource, with timestamp/provenance; ACTIVE alone is insufficient. |

No credentials, access/refresh tokens, sample rows, secret values or raw sensitive
request/response dumps. SQL and descriptions may themselves contain sensitive
literals; follow policy before persisting or sending to the model. If a required
artifact cannot be retained safely under that policy, block its import rather
than lose the exact approved definition. Do not invent a new telemetry sink.

## Interface operations the skill needs

These are semantic obligations, not exported function signatures:

1. Discover compatible contract/version and a local progress location; enumerate
   matching runs without exposing other scopes. Create/select/open a run explicitly.
2. Read a consistent snapshot; reject unknown incompatible versions. Prevent
   concurrent dispatch of the same intent through supported locking or equivalent
   atomic concurrency control. If exclusive execution cannot be established, stop
   writes, not just warn.
3. Durably checkpoint proposals, revisions, user decisions and bounded approval
   manifests. Checkpoint acknowledgement means persisted across CLI restart, not
   merely queued in memory.
4. Durably record an intent before **each** backend mutation. Record returned
   operation identity/outcome as soon as known. If recording fails, stop subsequent
   dispatches; reconcile the last intent before any further attempt.
5. Read pending intents after restart, reconcile them through read-only MCP reads,
   then checkpoint the evidence/result without resending the write. Keep matching
   successes and excluded/pending decisions; resume must not restart the batch.
6. Support decision revision/invalidation and a new review cycle after completion.
   “Complete” is a summary checkpoint, not deletion of failures or exclusions.

## Independent state axes

Use the interface's supported state vocabulary. The following labels describe
semantics only, not a new serialized enum:

- **Review:** unreviewed → pending → approved revision, or excluded. Edits create a
  new pending revision. Include changes excluded → pending, never → approved.
- **Operation:** no dispatch → durable intent → submitted/unknown → reconciled
  success or known failure. Unknown must not be rewritten as absent/failed on timeout.
- **Readiness:** unknown → preparing / available / failed according to backend
  evidence. Registration success does not advance this axis automatically.

A table can be approved and failed, or registered and not agent-ready. Summary
counts must explain overlapping axes rather than force a single misleading state.

## Reconciliation before replay

For every unfinished or outcome-unknown intent (including a crash after the
backend write but before the outcome checkpoint), use documented read-only lookup
by its stable identity and compare the actual resource to the approved definition:

- **Matching resource/operation found:** attach evidence, preserve success and
  continue status/readiness checks. Do not create again.
- **Authoritatively absent, no in-flight operation:** only then consider a
  user-selected retry, with verified idempotency and fresh finite confirmation.
  Eventual-consistency empty pages or ambiguous “not found” are not proof.
- **Conflicting resource, still in flight, insufficient scope or unknown:** hold
  the intent, explain the blocker, and do not mutate. Do not pick a new random ID
  to escape the conflict.

If the provider cannot supply durable identity, outcome reconciliation or safe
concurrency semantics, report the SLMD-1931 / MCP integration gap and block writes.
A user saying “resume” or “retry everything” does not waive these requirements.
