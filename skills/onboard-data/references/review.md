# Domain review and finite approval

## Navigation at 300 tables

Use a domain index with discovered, reviewed, pending, excluded, approved and
failed counts, plus coverage/permission gaps. Offer schema/name/domain/type/state
filters and next/previous page. Default review pages to 20 tables; use smaller
pages for long definitions. Fetch backend pages using only actual supported bounds
and continuation. If a filter is unavailable server-side, filter only already
retrieved bounded metadata and label the limited coverage; do not fabricate args.

A domain is a grouping, not a consent boundary. Display the exact members of a
review/approval batch. At 300 tables, a full review can use fifteen 20-table pages;
there is no “approve all 300” shortcut. Max 20 tables per confirmation, always an
explicit fixed snapshot. A domain-wide or filter-wide request first resolves to
a finite displayed batch, never future matches. Persist position/coverage through
the supported progress interface; a new table is unreviewed even in an approved
domain. Navigation and goal-based ordering must not hide exceptions.

Keep held items visible in the domain index and a separate exceptions list,
including pending mappings, unsupported types, access failures, exclusions,
unreviewed items and validation issues. A large page is not permission to omit
warnings. Never hide an unresolved mapping inside an otherwise approved domain.

## Table review card

For every proposed import show:

- Stable fully qualified warehouse table identity and source schema evidence.
- Proposed **type** (fact/dimension/context), **domain** and rationale/uncertainty.
- **Full SQL** to be registered, not an ellipsis or just a confidence score.
  Explain source tables, grain, filters/time coverage and proposed transformations.
  Do not execute arbitrary SQL locally; use verified MCP read-only SQL checks.
- **Mappings:** exact source fields/expressions to existing supported entity,
  timestamp, measures/dimensions or other required resource targets. Identify
  unresolved/ambiguous targets, key uniqueness/grain issues and dependencies.
- **Description**, editable as resource metadata; no new column annotations.
- **Warnings:** business meaning, aggregation restrictions, sensitive-data concerns,
  validation limitations, join assumptions and other exceptions. Separate blockers
  from acknowledgeable limitations using the documented contract, not convenience.
- **Questions:** separate blocking clarification/mapping questions from optional
  context questions. No business goal or first analytical question is mandatory.
- Current decision, proposal revision and operation/readiness state if already run.

If a required recommendation field is unavailable, say so; do not present a guessed
complete definition as a backend recommendation. Schema-grounded suggestions must
be labelled suggestions with provenance/uncertainty and still pass every gate.

## Edits and mappings

Allow edits to type, domain, SQL, mappings, description and warnings; allow exclude
or leave pending. Explain unsupported edits rather than inventing writable API
fields. Review required registration fields only, not a new annotation system.

Persist a new revision for every definition change and invalidate affected
approval. Recheck SQL/schema/dependencies with actual read-only capabilities.
User edits cannot suppress policy restrictions or bypass validation. Resolve
mappings by showing verified existing target candidates and the exact selected
mapping; do not invent entity IDs, create target resources implicitly, or silently
choose the most likely match. A missing target is an explicit dependency gap.

`resolve <run-id> <table-id>` returns the affected definition to pending review, shows the
mapping diff and full resulting definition, then asks for fresh finite approval.
Other approved or successful tables do not need replay. A nonblocking optional
question may remain open without preventing an otherwise fully approved import;
an unresolved required mapping may not.

## Approval protocol

1. Construct a revision-bound manifest of at most 20 eligible table identities.
   Include account/warehouse, intended resource identity, type/domain, full reviewed
   definition/revision, operation, required dependencies, warnings/acknowledgements
   and validation evidence. Review full SQL before asking for confirmation.
2. Show separate held/excluded/access-failed/not-reviewed counts and identities
   relevant to the selection. Do not silently drop requested members: explain why
   a subset is ineligible and ask approval for the exact eligible subset.
3. Ask explicitly: “Approve creation of these N definitions in [scope], at the
   displayed revisions, acknowledging [named limitations]? This does not approve
   the held items or any later pages.” For retry or replacement name that operation
   instead. Accept an unambiguous affirmative response to this exact manifest,
   not general praise, navigation or approval before the manifest was shown.
4. Persist confirmation, exact membership/revisions and warning acknowledgements
   durably before writes. Cancel/invalidate if the definition, scope, dependencies
   or source schema changes. Previously approved metadata cannot authorize a new
   definition. Do not silently reprepare SQL after consent.
5. Dispatch only confirmed members with satisfied preconditions. Approval does not
   resolve pending mappings, authorize new entity resources, imply context support,
   or authorize delete/replacement of an existing resource.

“Approve everything except problems,” “use your judgment,” a domain wildcard or
“keep approving future pages” is not a finite approval. Enumerate the current
eligible set and all known exceptions, then request confirmation. If the set is
larger than 20, split it into individually reviewed and confirmed batches. Stop
between batches; no automatic consent for the next batch.
