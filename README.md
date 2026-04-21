# Confidence AI Plugin

Official Confidence plugin for AI clients. Access feature flags, experiments, and migration tools directly from your AI coding tool.

## Installation

### Claude Code

1. Install the plugin:
    ```bash
    claude plugin install confidence
    ```

2. Authenticate via OAuth:
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
- **Experiments** - View A/B tests, rollouts, and statistical results
- **Migration** - Migrate feature flags from PostHog to Confidence

## Slash Commands

- `/confidence:migrate-posthog` - Migrate feature flags from PostHog to Confidence SDK

## Example Usage

```
> List my feature flags
> Create a flag called new-checkout with a boolean schema
> What are the results of the signup-flow experiment?
> /migrate-posthog plan flag
> /migrate-posthog plan code
```

## MCP Servers

| Server | Endpoint | Description |
|--------|----------|-------------|
| `confidence-flags` | `https://mcp.confidence.dev/mcp/flags` | Feature flag management |
| `confidence-docs` | `https://mcp.confidence.dev/mcp/docs` | Confidence documentation |

## Documentation

- [Confidence documentation](https://confidence.dev/docs)
- [OpenFeature SDK integration](https://confidence.dev/docs/sdks)
