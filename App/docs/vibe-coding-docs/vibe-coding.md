# AI-Assisted Development (Vibe Coding)

Use AI coding assistants to accelerate your SAM agent development. This repo includes pre-configured settings for popular AI tools.

For more context on vibe coding with SAM, see the [official SAM vibe coding guide](https://solacelabs.github.io/solace-agent-mesh/docs/documentation/vibe_coding).

## Supported Tools

| Tool                                                      | Status | Config Files                         | Notes                                                                                                             |
| --------------------------------------------------------- | ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [Google Antigravity](https://antigravity.google/)         | Ready  | `GEMINI.md`                          | No project-level MCP config—[configure globally](#google-antigravity) at `~/.config/antigravity/mcp.json`.        |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Ready  | `GEMINI.md`, `.gemini/settings.json` | Has [background process bugs][gh-13594] and [no async task support][gh-5941]. Run SAM CLI in a separate terminal. |
| [Claude Code](https://claude.ai/code)                     | Ready  | `CLAUDE.md`, `.mcp.json`             | —                                                                                                                 |

> **Using a different tool?** Other AI coding assistants (Cursor, Codex CLI, Windsurf, etc.) may work if they can read `AGENTS.md` for project context and support the [Context7 MCP server](#context7-integration) for SAM documentation. Check your tool's docs for configuration details. If you get stuck, reach out to hackathon sponsors from Solace.

[gh-13594]: https://github.com/google-gemini/gemini-cli/issues/13594
[gh-5941]: https://github.com/google-gemini/gemini-cli/issues/5941

## Free Gemini Access

Free ways to use Gemini-powered AI tools:

| Program                    | Link                                                      | Benefit                          |
| -------------------------- | --------------------------------------------------------- | -------------------------------- |
| Google AI Pro for Students | [gemini.google/students](https://gemini.google/students/) | 1 year free, higher rate limits  |
| Built-in free tier         | —                                                         | Rate-limited, no signup required |
| Google Antigravity         | [antigravity.google](https://antigravity.google/)         | Free Gemini Pro/Flash            |

## Quick Start

### Google Antigravity

1. Download from [antigravity.google/download](https://antigravity.google/download)
2. Open the project folder as a workspace
3. Configure Context7 MCP globally (one-time setup):
   - Click `...` in the Agent pane → MCP Servers → Manage MCP Servers → View raw config
   - Add Context7 to `~/.config/antigravity/mcp.json`:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

Antigravity automatically reads `GEMINI.md` for project context. MCP config is global (applies to all projects).

### Gemini CLI

```bash
# Install Gemini CLI (requires Node.js 20+)
npm install -g @google/gemini-cli

# Navigate to project and start
cd solace-agent-mesh-hackathon-quickstart
gemini
```

Gemini CLI automatically loads `GEMINI.md` for project context and `.gemini/settings.json` for Context7 MCP configuration.

### Claude Code

Install from [code.claude.com](https://code.claude.com/docs/en/setup#installation), then:

```bash
cd solace-agent-mesh-hackathon-quickstart
claude
```

Claude Code automatically loads `CLAUDE.md` for project context and `.mcp.json` for Context7 MCP configuration.

## Context7 Integration

This repo uses [Context7](https://context7.com) to provide AI assistants with up-to-date SAM documentation.

### How It Works

1. AI assistant calls Context7 MCP server
2. Context7 fetches latest SAM documentation
3. Documentation is injected into the AI's context
4. AI provides accurate, version-specific guidance

### Using Context7 Manually

If your AI tool doesn't auto-load the MCP config, reference SAM docs manually:

```
Use context7 to get documentation for solacelabs/solace-agent-mesh
```

### Rate Limits

Without an API key: 60 requests/hour (sufficient for hackathon use)

For higher limits, get a free API key at [context7.com/dashboard](https://context7.com/dashboard), set it in your shell environment, and reference it in your MCP config:

```bash
# Add to ~/.zshrc or ~/.bashrc
export CONTEXT7_API_KEY="your-api-key-here"
```

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {
        "CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"
      }
    }
  }
}
```

## Tips for Effective AI-Assisted Development

### 1. Ask for What You Want

Tell your AI assistant what kind of agent you need:

- "Create a joke-telling agent"
- "Build an agent with a custom Python tool that fetches weather data"
- "Make an agent that can search and summarize documents"

### 2. Use Context7 for SAM-Specific Questions

Ask about SAM features:

- "How do I add inter-agent communication?"
- "What built-in tools are available in SAM?"
- "How do I configure persistence for my agent?"

### 3. Iterate Quickly

With CLI deployment (`uv run sam run configs/`), there's no Docker rebuild step—just restart the process to pick up changes.

## Troubleshooting

### MCP Server Not Loading

**Google Antigravity:** Check `~/.config/antigravity/mcp.json` via UI (`...` → MCP Servers → Manage → View raw config) or:

```bash
cat ~/.config/antigravity/mcp.json
```

**Gemini CLI:** Check `.gemini/settings.json`:

```bash
cat .gemini/settings.json
```

**Claude Code:** Verify `.mcp.json` exists in project root:

```bash
cat .mcp.json
```

### Context7 Rate Limited

Get a free API key at [context7.com/dashboard](https://context7.com/dashboard).

### AI Doesn't Understand SAM

Explicitly reference Context7:

```
Use context7 to get SAM documentation for solacelabs/solace-agent-mesh, then help me with X
```

## Project Knowledge Files

This repo includes multiple AI instruction files for cross-tool compatibility:

| File        | Purpose                                         |
| ----------- | ----------------------------------------------- |
| `AGENTS.md` | Primary AI instructions (unified standard)      |
| `GEMINI.md` | Antigravity & Gemini CLI (symlink to AGENTS.md) |
| `CLAUDE.md` | Claude Code specific (symlink to AGENTS.md)     |

All files point to the same core instructions in `AGENTS.md`.

> **Windows:** Symlinks may not work. Copy `AGENTS.md` contents to the config file for your tool.
