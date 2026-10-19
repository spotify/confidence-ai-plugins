# Status, recovery and later changes

All follow-ups begin with runtime capability/scope checks and durable local
progress verification. Status reads may reconcile evidence into the existing
local journal, but must not initiate backend writes. If no journal is available,
show supported backend observations labelled as such; do not reconstruct lost
approval, exclusion or intent history from a resource inventory.

## Status and resume

Show run/account/warehouse, discovery coverage, each table's decision/revision,
registration and readiness evidence, and actionable open issues. Retain excluded,
pending and failed items after partial or full completion. Do not equate “run
summary shown” with “all tables imported.”

On resume, load the matching run and read-only reconcile each unfinished intent
before any potential replay. A matching existing resource is success, not a reason
to create another. An ACTIVE resource with no availability evidence remains
unknown/preparing. Do not redo completed work or reactivate consumed approvals.
For unsubmitted approved work, recheck revision/schema/capability/dependencies;
ask again if stale, changed or ambiguous. No automatic writes merely from invoking
`status` or loading a run.

## Targeted retry

1. Resolve the exact selected table identities. Show failure and blockers; keep
   successful tables untouched. A blanket request requires selecting and displaying
   a finite retry set, not replaying the run.
2. Read-only reconcile intended IDs/operations, including timeouts and interrupted
   checkpoints. A permission-denied response does not necessarily prove that an
   earlier operation never executed. Unknown or conflicting outcomes block retry.
3. Guide repair of the selected blocker (for example, request the required access
   through the established setup process). Do not widen permissions automatically.
   Verify repair with supported read-only checks before attempting registration.
4. If SQL, mappings, type, domain, description or warnings change, persist a new
   proposal revision and perform full affected-definition review/approval. A
   repaired external permission with unchanged definition still needs explicit
   confirmation of this finite retry operation.
5. Require durable pre-write intent, supported idempotency and authoritative
   absence/no in-flight operation, or a documented safe continuation of the same
   operation. Then dispatch only the selected confirmed subset through MCP.
   Do not add suffixes/random IDs to bypass conflict or unknown outcomes.

## Resolve and include after completion

- **Resolve:** inspect actual target candidates, persist the mapping choice as a
  new pending revision, revalidate and ask fresh approval. Never auto-register a
  newly resolvable mapping on a status call.
- **Include:** change only selected exclusions to pending, preserve decision
  history and show current schema/recommendations. Inclusion consent is not import
  consent. Re-review and approve the exact current definitions before creation.
- Keep unrelated pending/excluded items unchanged. These operations can reopen
  review after a completion summary without rerunning successes.

## Immutable definitions: replacement, not silent mutation

`replace <run-id> <table-id>` is available for a selected existing definition,
including after completion. The route requests planning, not immediate mutation.
Do not assume import SQL, mappings, type or other fields are mutable. Verify
supported update semantics. For an immutable change, prepare a **replacement
plan** rather than using create/delete as an improvised update:

1. Read the existing resource and enumerate dependencies using verified read-only
   capabilities: downstream metrics, joins/mappings, agent context and other
   consumers that the contract identifies. Show old and proposed definitions,
   resource identities and impact. If dependency coverage is incomplete, block
   execution rather than call the plan dependency-checked.
2. Verify a supported safe replacement/cutover workflow and its preconditions,
   validation, identity handling, availability/downtime risks and failure recovery.
   Do not fabricate a dependency checker or replacement endpoint. A creation tool
   plus a deletion tool does not establish a safe replacement contract.
3. Show the exact ordered plan: replacement definition and intended ID, validation,
   dependency migration/cutover where supported, treatment of the old resource,
   and recovery behavior. Keep the old resource unless its retirement is explicitly
   supported and included in the confirmed plan. No hidden cleanup or cascades.
4. Ask explicit confirmation of the dependency-checked plan and its affected
   resources/risks. Prior create approval, a generic edit request or an instruction
   to “just replace it” is not confirmation of an unseen plan. Persist plan and
   intent through the supported progress contract before each permitted mutation.
5. Execute only if the runtime supports the complete safe workflow and recovery.
   Otherwise report “replacement unsupported; no backend changes made,” retain the
   proposed change pending, and stop. Never fall back to REST, undocumented flags,
   delete/recreate or a second resource that leaves dependencies broken.

Even a supported mutable update requires a reviewed revision, explicit finite
consent and durable intent; it is never a side effect of refresh/status.

## Refresh: conservative read-only rediscovery and review

Refresh priority for final launch is **undecided**. This route specifies safe
behavior when offered; it is not a promise that every supporting tool is shipped.

- Re-discover accessible metadata with actual bounded read-only pagination and
  filters. Show new, changed, unchanged, inaccessible and missing-from-current-
  discovery tables, plus incomplete coverage and permission gaps.
- Preserve existing decisions/history, resource IDs, successful outcomes and
  exclusions. New tables start unreviewed; excluded tables remain excluded. A
  changed definition/schema stages a new pending proposal for review and marks
  old approval inapplicable to that new revision, without erasing prior consent.
- A missing table is not proof of deletion: access or scope may have changed.
  Do not delete/unregister resources or remove retained decisions.
- Generate new proposals only through verified non-mutating paths. Diff against
  the last reviewed revision, including SQL/mappings/warnings and dependencies.
  If safe recommendation refresh is unsupported, report that gap and show only
  the metadata diff.
- No create, update, replacement, permission change, validation-triggered resource
  mutation or backend delete occurs on `refresh <run-id>`, even if old approval exists.
  Store review progress only through SLMD-1931. Offer a separate review and explicit
  approval step for any future writes; immutable changes need the plan above.
