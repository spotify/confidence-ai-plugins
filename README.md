# Confidence AI Plugin

Official Confidence plugin for AI clients. Access feature flags, experiments, and migration tools directly from your AI coding tool.

## Installation

### Claude Code

1. Add the Confidence marketplace:
    ```bash
    claude marketplace add spotify/confidence-ai-plugins
    ```

2. Install the plugin:
    ```bash
    claude plugin install confidence
    ```

3. Authenticate via OAuth:
    ```bash
    claude
    # Then use /mcp to connect to the Confidence MCP servers
    /mcp
    ```
    Follow the browser prompts to log in.

### Local Development

```bash
git clone https://github.com/spotify/confidence-ai-plugins.git
claude --plugin-dir ./confidence-ai-plugins
```

## Features

This plugin provides access to Confidence tools across these categories:

- **Feature flags** - Create, list, update, archive, and resolve feature flags
- **Migration** - Migrate feature flags from PostHog to Confidence

## Slash Commands

- `/confidence:migrate-posthog` - Migrate feature flags from PostHog to Confidence SDK

## Example Usage

```
> List my feature flags
> Create a flag called new-checkout with a boolean schema
> /migrate-posthog plan flag
> /migrate-posthog plan code
```

## MCP Servers

| Server | Endpoint | Description |
|--------|----------|-------------|
| `confidence-flags` | `https://mcp.confidence.spotify.com/mcp/flags` | Feature flag management |
| `confidence-docs` | `https://mcp.confidence.spotify.com/mcp/docs` | Confidence documentation |

## Documentation

- [Confidence documentation](https://confidence.spotify.com/docs)
- [OpenFeature SDK integration](https://confidence.spotify.com/docs/sdks)
