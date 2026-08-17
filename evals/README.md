# Skill Evals

Automated quality evaluation for the migration skills (`migrate-optimizely`,
`migrate-posthog`, `migrate-eppo`, `migrate-statsig`) and the onboarding
skills (`onboard-confidence`, `setup-warehouse`, `setup-warehouse-bigquery`).
Each single-turn eval sends a skill's full `SKILL.md` as the system prompt
plus one case message and scores the model's response; multi-turn evals run
scripted conversations against mocked tools. Results are logged to
Braintrust (project **Confidence ai plugins** on
`braintrust.spotifyinternal.com`).

## Run it with a Hendrix key (recommended)

Hendrix is Spotify's internal model gateway — no Anthropic credits needed.
You must be on the Spotify network (VPN) to reach it.

```bash
npm ci

export HENDRIX_API_KEY=<your-hendrix-key>
export BRAINTRUST_API_KEY=<braintrust-api-key>   # braintrust.spotifyinternal.com → Settings → API Keys

# All four skills, results uploaded to Braintrust
npm run eval:hendrix

# Local-only (no Braintrust upload) — for quick iteration
npm run eval:hendrix:local
```

The scripts point the Anthropic SDK at Hendrix via `ANTHROPIC_BASE_URL`
(`https://hendrix-genai.spotify.net/taskforce/glm-5-2`); override with
`HENDRIX_BASE_URL` if your team uses a different Hendrix route.

## Run it against the Anthropic API directly

```bash
export ANTHROPIC_API_KEY=<anthropic-api-key>     # needs credit balance
export BRAINTRUST_API_KEY=<braintrust-api-key>
export BRAINTRUST_API_URL=https://braintrust.spotifyinternal.com

npm run eval                 # all four skills
npm run eval:optimizely      # one skill
npm run eval:optimizely:local            # Optimizely single-turn, Hendrix, no upload
npm run eval:multi-turn:optimizely:local # Optimizely multi-turn, Hendrix, no upload
```

`EVAL_MODEL` overrides the model for both the task and the LLM judge
(default `claude-sonnet-4-6`).

## What gets scored

| Scorer | Type | What it checks |
|--------|------|----------------|
| ScopeClassification | deterministic | migrate / excluded / blocked / archived verdict matches the case's ground truth |
| FlagShape | deterministic | boolean vs struct verdict |
| PlanContent | deterministic | expected strings present, internal terms absent |
| NamingRules | deterministic | flag names are `[a-z0-9-]`, entity refs have no underscores |
| Tone | LLM judge | conversational prose is plain English (code identifiers like `eqRule` only inside code blocks) |
| Communication | LLM judge | no raw payloads / MCP tool names in prose |
| EducateFirst | LLM judge | explains the flag before acting on it |
| Visualization | LLM judge | step-tracker format (only on cases tagged `interactive`) |

The model is asked to end each response with explicit `Classification:` and
`Flag shape:` verdict lines (see `lib/classification-footer.ts`); the
deterministic scorers parse those. The footer defines only what the labels
mean — deciding which label applies must come from the skill's own
Migration Scope Policy, so the eval genuinely tests the skill.

## Test cases

One YAML per case under `cases/<skill>/`:

```yaml
name: na-promo-set-membership
tags: [migrate, set_membership, boolean]
input:
  user_message: |
    I want to migrate my <Platform> flags to Confidence. ...
  flag: { ...source-platform flag JSON... }
expected:
  scope: migrate            # migrate | excluded | blocked | archived
  flag_shape: boolean       # boolean | struct
  plan_includes: ["country", "US", "CA"]   # must appear in the response
  plan_excludes: ["eqRule", "mcp__confidence"]  # must NOT appear
```

To add a case, drop a YAML file in the skill's directory — the loader picks
it up automatically. Ground truth is hand-written; if the model disagrees
with a case, check whether the case (or the skill) is wrong before assuming
the model is.

Optimizely multi-turn cases (`cases/multi-turn/optimizely/`) cover flag
happy-path / consent / blocked / partial-rollout **and** Phase 0 access
(default `/migrate-optimizely` entry, `plan access` no-writes, `execute access`
consent gate, `adjust flags` no-create). Access scenarios set `prompt_files: [access.md]`
so the harness loads `skills/migrate-optimizely/access.md` with `SKILL.md`.

## Onboarding evals

The onboarding skill acts through Bash (bundled `auth.py`, curl to REST
endpoints), AskUserQuestion, and MCP tools — so its evals mock all three.

### Single-turn (`onboard-confidence.eval.ts`, cases in `cases/onboard/`)

Each case is one message (optionally with an `input.context` block holding a
prior-state summary or a raw API error) answered with no tools. A footer
(`lib/onboard-footer.ts`) forces a `Next step: <sub-command>.<step>` verdict
line. Case schema:

```yaml
name: error-under-review-fraud
tags: [error-interpretation]
input:
  context: |
    (Conversation so far: ... the API responded: {"code":9,"message":"...flagged as suspicious."})
  user_message: "So, is my account ready?"
expected:
  next_step_pattern: "^create-account"   # regex on the verdict line
  response_includes: ["confidence-support@spotify.com"]  # all must appear
  response_includes_any: ["flagged", "review"]           # at least one
  response_excludes: ["verify your email", "code 9"]     # none in prose
```

| Scorer | Type | What it checks |
|--------|------|----------------|
| NextStep | deterministic | verdict line matches `next_step_pattern` |
| ResponseContent | deterministic | includes / includes_any / excludes |
| NoInternalLeak | deterministic | no Auth0 client IDs, JWTs, `Bearer`, org IDs, curl, telemetry mention (binary: any leak = 0) |
| OnboardCommunication | LLM judge | plain-English status, no payloads/codes/internals |
| OnboardEducateFirst | LLM judge | concept explained before asking for input |
| OnboardStepTracker | LLM judge | step tracker present (cases tagged `interactive`) |

### Multi-turn (`multi-turn/onboard-confidence.eval.ts`, cases in `cases/multi-turn/onboard/`)

Scripted conversations against a mock harness (`multi-turn/onboard-tools.ts`):

- **Bash** is regex-routed to canned outputs (auth script → mock JWT,
  availability checks, account creation, telemetry endpoints, gcloud/bq).
  Scenarios override per-command with `bash_responses` (consumed in order —
  e.g. a 409 then a 200).
- **AskUserQuestion** answers come from `ask_answers` — each entry's `match`
  regex is tested against the question text, header, and option labels;
  unmatched questions fall back to the first option with a warning.
- **MCP tools** are mocked with in-memory state (clients, flags, warehouse);
  `tool_responses` overrides any tool's results in order (e.g. a failing
  `getIdentityInfo` before the user authenticates).
- `skill:` selects the SKILL.md to load (`onboard-confidence`,
  `setup-warehouse`, `setup-warehouse-bigquery`); `skills:` can list several
  to concatenate (dispatcher + hand-off target).

Telemetry is asserted, not skipped: happy-path scenarios check the telemetry
key is acquired and events are published, and that telemetry is never
mentioned in user-visible text. Scoring is `AssertionsPassed` (declarative
assertions, including the new `tool_call_arg_not_contains`) plus a
conversation-level `NoInternalLeak` LLM judge over all user-visible text.

```bash
npm run eval:onboard:local              # single-turn, Hendrix, no upload
npm run eval:multi-turn:onboard:local   # multi-turn, Hendrix, no upload
npm run eval:onboard                    # single-turn → Braintrust (onboard-single-turn-v1)
npm run eval:multi-turn:onboard         # multi-turn → Braintrust (onboard-multi-turn-v1)
```

## CI

PR runs are **disabled** (each full run costs real tokens). The workflow
(`.github/workflows/eval.yml`) runs on push to `main` (paths-filtered) and
via manual dispatch, using the `ANTHROPIC_API_KEY`/`HENDRIX_API_KEY` and
`BRAINTRUST_API_KEY` repo secrets. Note: GitHub-hosted runners cannot reach
Hendrix (internal-only), so CI needs a funded Anthropic key.

Quality gate: every scorer on every skill must be ≥ 90%.

## Cost

System prompts are cached (`cache_control: ephemeral`) — the SKILL.md is
identical across all cases of a skill, so cases after the first read it at
~0.1× input price. A full 4-skill run is roughly $3 on the Anthropic API
and free-to-you via Hendrix.
