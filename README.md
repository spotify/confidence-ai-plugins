<p align="center">
  <img src="assets/logo.svg" alt="Confidence" width="120" />
</p>

<h1 align="center">Confidence AI Plugin</h1>

<p align="center">
  Official Confidence plugin for AI coding tools. Manage feature flags, experiments, onboarding, and migrations right from your agent.
</p>

<p align="center">
  <a href="https://confidence.spotify.com/docs/introduction"><img alt="Docs" src="https://img.shields.io/badge/docs-confidence.spotify.com-6E56CF"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="./CHANGELOG.md"><img alt="Version" src="https://img.shields.io/badge/version-0.6.0-informational"></a>
</p>

## ✨ Highlights

- **Manage feature flags without leaving your editor**: create, list, update, target, resolve, and archive flags from Claude Code, Cursor, Codex, or Gemini CLI
- **One-command migrations** from PostHog, Eppo, Statsig, or Optimizely (flags *and* SDK code; Optimizely also migrates **users, teams, roles, policies, and Flag clients**)
- **Guided onboarding**: spin up a Confidence account, invite teammates, create SDK clients, and connect a warehouse without reading a setup doc
- **Docs on tap**: search Confidence documentation and SDK integration guides inline while you code
- Works with every major AI coding assistant through the same MCP servers

## ℹ️ Overview

[Confidence](https://confidence.spotify.com) is Spotify's feature flagging and experimentation platform, built on the [OpenFeature](https://openfeature.dev) standard. This plugin exposes Confidence's flag management, documentation, and migration tooling as MCP servers and slash commands, so you can create a flag, plan a migration off another platform, or onboard a new workspace directly from your AI coding assistant's chat.

## ⬇️ Installation

### Claude Code

```bash
claude plugin install confidence
```

### Cursor

**From the Marketplace:** open **Cursor Settings** → **Plugins**, search for **Confidence**, and click **Install**.

**Manual setup**: add the MCP servers to `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "confidence-flags": {
      "url": "https://mcp.confidence.dev/mcp/flags"
    },
    "confidence-docs": {
      "url": "https://mcp.confidence.dev/mcp/docs"
    }
  }
}
```

### Codex

```bash
codex plugin marketplace add spotify/confidence-ai-plugins
codex
/plugins
# Select Confidence and install
```

### Gemini CLI

```bash
gemini extensions install https://github.com/spotify/confidence-ai-plugins
```

### Local Development

```bash
git clone https://github.com/spotify/confidence-ai-plugins.git
claude --plugin-dir ./confidence-ai-plugins
```

**Cursor:** **File → Open Folder** on this repository (the
`confidence-ai-plugins` directory itself — not `Desktop` or your home
folder). Skills load from `./skills/` via `.cursor-plugin/plugin.json`
and from `.cursor/skills/` (symlinks) for project-level discovery.
Commands load from `./commands/` (including
`/migrate-optimizely plan access`, `plan flags`, `execute code`, etc.)
and from `.cursor/commands/` (symlink to `../commands`). Dedicated
`/migrate-optimizely-*` menu shortcuts also exist in Cursor. A parent
folder as the workspace will not auto-load them.

### Skills only, any agent

The migration and onboarding **skills** can also be installed individually via the [skills CLI](https://github.com/vercel-labs/skills), which supports Claude Code, Cursor, Codex, Gemini CLI, and 70+ other agents:

```bash
npx skills add spotify/confidence-ai-plugins
```

This installs only the skill logic (auto-triggering guidance for migrations and onboarding). It does **not** configure the `confidence-flags`/`confidence-docs` MCP servers or the `/confidence:*` slash commands, even when targeting one of the four clients above. Since several skills call into those MCP servers to manage flags, use one of the full installs above for complete functionality; use this only if you want the skill guidance on an agent the full installs don't support.

## 🚀 Usage

Once installed, just ask your assistant:

```
> List my feature flags
> Create a flag called new-checkout with a boolean schema
> /confidence:onboard-confidence create-account
> /confidence:migrate-posthog plan flag
> /confidence:migrate-posthog plan code
> /confidence:migrate-eppo plan flag
> /confidence:migrate-eppo plan code
> /confidence:migrate-statsig plan flag
> /confidence:migrate-statsig plan code
> /confidence:migrate-optimizely plan access
> /confidence:migrate-optimizely adjust access
> /confidence:migrate-optimizely execute access
> /confidence:migrate-optimizely plan flags
> /confidence:migrate-optimizely adjust flags
> /confidence:migrate-optimizely execute flags
> /confidence:migrate-optimizely plan code
> /confidence:migrate-optimizely adjust code
> /confidence:migrate-optimizely execute code
> /confidence:analyze-project
```

## Features

This plugin provides access to Confidence tools across these categories:

- **Feature flags**: Create, list, update, archive, resolve, and target feature flags
- **Onboarding**: Create accounts, invite users, set up SDK clients, configure warehouses, and learn experimentation concepts
- **Documentation**: Search Confidence docs and SDK integration guides
- **Migration**: Migrate feature flags from PostHog, Eppo, Statsig, or Optimizely to Confidence. Optimizely Phase 0 also maps **access** (users, groups, roles, policies, Flag clients) — see [Optimizely access](#optimizely--confidence)
- **Project analysis**: Scan a project and propose meaningful feature flag opportunities tailored to the codebase

## Slash Commands

- `/confidence:onboard-confidence <create-account | invite-user | create-client | setup-wizard | setup-warehouse | learn | status>`: Create accounts, onboard users, set up SDK clients, configure warehouses, and learn experimentation concepts
- `/confidence:migrate-posthog <plan flag | plan code | execute <plan-file>>`: [Migrate feature flags from PostHog to Confidence](https://confidence.spotify.com/docs/migrations/migrate-from-posthog)
- `/confidence:migrate-eppo <plan flag | plan code | execute <plan-file>>`: [Migrate feature flags from Eppo to Confidence](https://confidence.spotify.com/docs/migrations/migrate-from-eppo)
- `/confidence:migrate-statsig <plan flag | plan code | execute <plan-file>>`: [Migrate feature flags from Statsig to Confidence](https://confidence.spotify.com/docs/migrations/migrate-from-statsig)
- `/confidence:migrate-optimizely <plan access | adjust access | execute access | plan flags | adjust flags | execute flags | plan code | adjust code | execute code | execute <plan-file>>`: [Migrate Optimizely Feature Experimentation to Confidence](https://confidence.spotify.com/docs/migrations/migrate-from-optimizely) — see [Optimizely access](#optimizely--confidence) (Flag clients are handled in `plan access` Step 4; Cursor also exposes dedicated `/` menu shortcuts)
- `/confidence:analyze-project [project-dir]`: Analyze a project and propose meaningful feature flag changes using Confidence

## Optimizely → Confidence

PostHog, Eppo, and Statsig migrate **flags** then **code**. Optimizely also
migrates **access** (Phase 0) before those. Agent contract:
[`skills/migrate-optimizely/SKILL.md`](./skills/migrate-optimizely/SKILL.md)
(including **Adjust Access / Flags / Code: Steps**) and IAM mapping in
[`skills/migrate-optimizely/access.md`](./skills/migrate-optimizely/access.md).

### Phase 0 — Access (users, groups, roles, policies, clients)

Writes a plan first. Nothing is invited or created in Confidence until
you tick consent and run execute.

| Command | What it does | Writes to Confidence? |
|---------|--------------|------------------------|
| `plan access` / `-plan-access` *(also bare `/migrate-optimizely`)* | Map Optimizely collaborators and teams to Confidence invites, groups, intended shares, and Flag-client **candidates** (Step 4). File: `.claude/plans/optimizely-access-migration-<date>.md`. When the plan is complete, the agent **must ask** what next (adjust / tick consent / execute / done) — there is no automatic path into adjust. If SDK keys arrive later, re-run `plan access` | No |
| `adjust access` / `-adjust-access` | Fine-edit that plan in chat: **users**, **groups**, **roles**, **policies**, **clients** (e.g. “skip all `@example.com`”, “Checkout should be Editor”). You do not have to hand-edit the markdown. Also offered from the plan-access exit ask | No |
| `execute access` / `-execute-access` | After you tick `[x] Invite` / `[x] Create`: create groups + Reader policies, send invites, create ticked Flag clients, then provision each person as they accept (group, policy, client, flag shares) | **Yes** (IAM) |

**What `adjust access` can change**

| Kind | Examples |
|------|----------|
| Users | Invite or skip (one email, a team, a domain, or all); move between groups; add an email you provide |
| Groups | Create or skip; rename; merge/split; change members |
| Roles | Viewer / Editor / Owner shares per group or user; override default mapping (e.g. Publisher → Viewer) |
| Policies | Group policy roles (default Reader); yes/no on tightening `default-policy` |
| Clients | Create or skip; names; split/merge; which groups see which clients |

**What it will not do:** invent people or Flag clients; flatten teams into per-user shares; map Project Owner to workspace Admin; put Flags Editor/Reader on a **workspace policy**; change `admin-policy` except to add known Administrators; invite or create resources during plan/adjust; delete a live group/user because a row is now Skip.

Silence is not consent. Tick every user and group (and listed Flag clients) before execute. Invites last 7 days. Flag clients need environment SDK keys — if the export has none, that step is skipped until keys exist.

### Phase 1 — Flags

Same plan → exit ask → optional adjust → execute pattern as access.
Running experiments and partial-% rollouts stay out by default (different bucketing).

| Command | What it does | Writes to Confidence? |
|---------|--------------|------------------------|
| `plan flags` / `-plan-flags` | Scan Optimizely flags and write `.claude/plans/optimizely-flag-migration-<date>.md`. Lists flags with **no Optimizely rules** as **auto everyone catch-all**. **Must** run a **Rules operator audit** and mark `exists` / `substring` / `regex` as **BLOCKED** (Confidence unsupported). When complete, the agent **must ask** what next (adjust / tick / execute / done) | No |
| `adjust flags` / `-adjust-flags` | Fine-edit that plan: **scope**, **Migrate/Skip ticks**, **client**, **bucketing**, **schema**, **rules**. Also offered from the plan-flags exit ask | No |
| `execute flags` / `-execute-flags` | **(1) create flag shells** → **(2) suggest rules import** → **(3) suggest resolve-verify ALL flags (segment match) — this validates Phase 1** → then `plan code`. Auto everyone catch-all if a flag still has zero enabled rules. Never call Phase 1 done after rules alone | **Yes** (flags) |

### Phase 2 — Code

| Command | What it does | Writes to Confidence / repo? |
|---------|--------------|------------------------------|
| `plan code` / `-plan-code` | Scan Optimizely SDK usage and write `.claude/plans/optimizely-code-migration-<date>.md`. When complete, the agent **must ask** what next (adjust / execute / done) | No |
| `adjust code` / `-adjust-code` | Fine-edit that plan: **style**, **resolve mode**, **transforms**, **files/flags**. Also offered from the plan-code exit ask | No |
| `execute code` / `-execute-code` | Transform code / open PRs from the plan (typically one PR per flag) | **Yes** (repo) |
## MCP Servers

| Server | Endpoint | Description |
|--------|----------|-------------|
| `confidence-flags` | `https://mcp.confidence.dev/mcp/flags` | Feature flag management |
| `confidence-docs` | `https://mcp.confidence.dev/mcp/docs` | Confidence documentation |

## Supported Clients

| Client | Config | Marketplace |
|--------|--------|-------------|
| Claude Code | `.claude-plugin/` | Official plugin |
| Cursor | `.cursor-plugin/` | Cursor Marketplace |
| Codex | `.codex-plugin/` | Via marketplace command |
| Gemini CLI | `gemini-extension.json` | Direct from repo |

## Documentation

- [Confidence documentation](https://confidence.spotify.com/docs/introduction)
- [Migration guides: migrate to Confidence from PostHog, Eppo, Statsig, or Optimizely](https://confidence.spotify.com/docs/migrations/overview)
- [OpenFeature SDK integration](https://confidence.spotify.com/docs/sdks)
- This repo — Optimizely migration: [SKILL.md](./skills/migrate-optimizely/SKILL.md) (Phase 0–2 plan / **adjust** / execute), [access.md](./skills/migrate-optimizely/access.md) (IAM mapping), [test fixtures](./skills/migrate-optimizely/test-fixtures/README.md)

## 💭 Community & Support

Found a bug or have a feature request? [Open an issue](https://github.com/spotify/confidence-ai-plugins/issues). Changes are tracked in the [changelog](./CHANGELOG.md).

## License

[Apache License 2.0](./LICENSE)
