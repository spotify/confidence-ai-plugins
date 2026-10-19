# Runtime capabilities and ownership

## Proposal is not deployment evidence

The SLMD-1625 onboarding flow and API/CLI integration proposal describe intended
behavior. The following are **proposed tool names, not proven shipped tools**:

| Proposal name | Intended role to verify at runtime |
|---|---|
| `getDataOnboardingStatus` | Scoped connection/onboarding progress; verify which readiness states it actually exposes. |
| `listWarehouseTables` | Read-only, bounded accessible-table discovery, with pagination/filter semantics. |
| `getWarehouseTableSchema` | Read-only schema metadata for a selected source table. |
| `prepareTableImport` | Recommendations: type, domain, SQL, mappings, description, warnings/questions; verify no registration or other backend mutation. |
| `createFactTable` | Register an approved fact definition; verify validation and duplicate prevention. |
| `createDimensionTable` | Register an approved dimension definition; verify validation and duplicate prevention. |
| `getTableImportStatus` | Per-operation registration/validation status; verify bounded composition and unknown-outcome recovery. |
| `listImportedTables` | Scoped reconciliation inventory; registration alone does not prove agent availability. |

Do not copy these names into fabricated calls. Inspect the connected
**confidence-data** tool inventory, descriptions and input/output schemas first.
Use only actual supported arguments, IDs, pagination and state values. Different
names can satisfy the roles if their semantics are verified. Missing roles must
be reported as missing, not emulated with REST, confidence-flags writes, shell SQL
or undocumented flags. Documentation lookup through confidence-docs is useful,
but it does not turn an absent tool into a callable one.

Before invoking a tool, establish whether it is metadata-only, validates SQL
without resource mutation, or registers/changes a resource. A reassuring name or
read-only tool hint alone is insufficient if the documented behavior conflicts.
If `prepareTableImport` cannot be verified as non-mutating, do not use it during
review or refresh. Mark recommendations blocked; do not implement its API sequence.

## Capability checks by action

| Action | Required evidence | If unavailable |
|---|---|---|
| Discovery | Authenticated account/warehouse scope; enforced read-only access; bounded pages and continuation/coverage semantics. | Explain missing contract; do not unbounded-scan or guess filters/cursors. |
| Review | Scoped schema and proposal fields; data-policy-compatible metadata; recommendation provenance/limitations. | Keep affected proposals incomplete; never invent schemas or mappings. |
| Create fact/dimension | Supported type, approved definition fields, read-only SQL checks, bounded validation, stable resource/operation identity, idempotency and read-only reconciliation. Durable journal also required. | Block writes for affected type/action. |
| Context import | SLMD-1858 ownership plus implemented context storage and read-only agent access, exposed through a verified registration/readiness contract. | Keep pending unsupported; a classification recommendation is not a capability gate. |
| Recovery | Read-only lookup by durable operation/intended resource identity; outcomes distinguish absent, matching, conflicting and unknown. | Block retry of uncertain writes. |
| Agent-ready summary | Explicit agent-availability signal for that resource/type; supported query scope and restrictions. | Label readiness unknown, even if ACTIVE/validated. |
| Replacement | Dependency enumeration and a supported safe replacement/cutover contract, including failure/recovery semantics. | Plan/report only; no delete-and-recreate. |
| Refresh | Verified metadata-only rediscovery/recommendation/diff paths. | Perform only supported read-only subset; block any ambiguous tool. |

Do not assume a bulk endpoint, context creation endpoint, dependency checker,
idempotency field or readiness endpoint exists. Verify the actual runtime contract
without inventing a tool name or request signature for these capabilities.

## Responsibility map

- **SLMD-1717 (this skill):** CLI review, finite consent, domain navigation,
  status/resume/retry/refresh orchestration and user-facing partial results.
- **SLMD-1921:** confidence-data MCP authentication/tokens, API wrappers,
  composition, validation polling and structured errors. MCP configuration is a
  separate integration concern; this skill assumes the parent configures
  `https://mcp.confidence.dev/mcp/data`.
- **SLMD-1931:** durable local decisions, intended IDs and reconciliation contract;
  no credentials or sample rows. The skill consumes it, not a duplicate engine.
- **SLMD-1938:** connection readiness/setup guidance; continue the same run after repair.
- **SLMD-1585 / SLMD-1933:** bounded read-only discovery / recommendations without creation.
- **SLMD-1858:** context ownership, storage and read-only agent access gate.
- **SLMD-1934 / SLMD-1935:** per-table registration/recovery / explicit agent availability.
- **SLMD-1937 / SLMD-1936:** completion and optional starting points / business warnings,
  aggregation restrictions and unreviewed-join safeguards.
- **SLMD-1932:** data policy across metadata, proposals, host/model inputs, logs and fixtures.
- **SLMD-1721:** onboarding milestones separate from first question and verified answer.
- **SLMD-1939 / SLMD-1940:** supported-combination end-to-end tests / accuracy evaluations.

This document specifies required integration semantics, not delivery claims or a
final launch-priority decision. The local design source is the SLMD-1625
`onboarding-flow.md` artifact; it is a planned flow, not an implementation audit.
