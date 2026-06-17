# Confidence AI Plugin

Official Confidence plugin for AI coding tools. Access feature flags, experiments, and migration tools directly from Claude Code, Cursor, Codex, and Gemini CLI.

## Installation

### Claude Code

```bash
claude plugin install confidence
```

### Cursor

#### From the Marketplace

1. Open **Cursor Settings** > **Plugins**
2. Search for **Confidence**
3. Click **Install**

#### Manual setup

Add the MCP servers to `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` globally):

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

## Features

This plugin provides access to Confidence tools across these categories:

- **Feature flags** — Create, list, update, archive, resolve, and target feature flags
- **Documentation** — Search Confidence docs and SDK integration guides
- **Migration** — Migrate feature flags from PostHog, Eppo, Statsig, or Optimizely to Confidence

## Slash Commands

- `/confidence:migrate-posthog` — Migrate feature flags from PostHog to Confidence SDK
- `/confidence:migrate-eppo` — Migrate feature flags from Eppo to Confidence SDK
- `/confidence:migrate-statsig` — Migrate feature flags from Statsig to Confidence SDK
- `/confidence:migrate-optimizely` — Migrate feature flags from Optimizely Feature Experimentation to Confidence SDK

## Example Usage

```
> List my feature flags
> Create a flag called new-checkout with a boolean schema
> /confidence:migrate-posthog plan flag
> /confidence:migrate-posthog plan code
> /confidence:migrate-eppo plan flag
> /confidence:migrate-eppo plan code
> /confidence:migrate-statsig plan flag
> /confidence:migrate-statsig plan code
> /confidence:migrate-optimizely plan flags
> /confidence:migrate-optimizely plan code
```

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

- [Confidence documentation](https://confidence.spotify.com/docs)
- [OpenFeature SDK integration](https://confidence.spotify.com/docs/sdks)
