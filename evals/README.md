# Skill Evals

Automated quality evaluation for the migration skills (`migrate-optimizely`,
`migrate-posthog`, `migrate-eppo`, `migrate-statsig`). Each eval sends a
skill's full `SKILL.md` as the system prompt plus a source-platform flag
definition, and scores the model's response on 8 dimensions. Results are
logged to Braintrust (project **Confidence ai plugins** on
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
