# Session ID & Context Persistence in SAM

## The Core Idea

SAM uses a **distributed session architecture**. There are two separate storage layers that are coordinated by a single shared session ID:

```
Browser (React app)
   |
   |  session ID: "web-session-a1b2c3d4..."
   v
WebUI Gateway (Python/FastAPI, port 8000)       <-- stores chat history for the UI
   |
   |  same session ID forwarded in every message
   v
Agent (e.g. Recipe Research Agent)               <-- stores its own conversation context
```

## Step-by-Step Flow

1. **Session ID is created once** -- `useGatewaySession.js` checks localStorage for an existing session ID. If none exists, `makeSessionId()` generates one like `web-session-3f7a2b1e-...` and saves it to localStorage.

2. **It's attached to every message** -- When `useAssistantChat` calls `client.send(prompt, agentName)`, the `GatewayClient` (`gateway.js`) includes the session ID as `contextId` in the request body. Every single message carries this same ID.

3. **The WebUI Gateway stores UI-side history** -- The gateway (backed by `webui-gateway.db`) stores the chat bubbles, timestamps, and task metadata keyed by that session ID. This is what lets you see your conversation history when you reload the page.

4. **Each Agent stores its own context** -- The agent receives the session ID and uses it to look up its own conversation memory in its own database. This is the LLM conversation history -- the agent knows what you said before, what it replied, what tools it called, etc.

## What Gets Persisted Where

| What's persisted                     | Where                                  | Keyed by   |
| ------------------------------------ | -------------------------------------- | ---------- |
| Chat bubbles shown in UI             | WebUI Gateway DB (`webui-gateway.db`)  | Session ID |
| Agent conversation memory            | Agent's own DB (`agent-session.db`)    | Session ID |
| Agent internal state / tool results  | Agent's own DB                         | Session ID |

- **Same session ID = same conversation.** If the browser sends the same session ID across page reloads, both the gateway and the agent retrieve the existing conversation and continue where you left off.
- **New session ID = fresh conversation.** The agent has no prior context -- it treats you as a brand new user.

## Key Files in This Codebase

| File | Role |
| ---- | ---- |
| `web/src/lib/session.js` | Generates a unique ID like `web-session-<uuid>` |
| `web/src/hooks/useGatewaySession.js` | On mount, loads session ID from localStorage (or creates one), sets it on the `GatewayClient`, and persists it back. This is why conversations survive page refreshes. |
| `web/src/api/gateway.js` | The `send()` method includes the session ID as `contextId` in every request to the gateway |

Each page has its **own session key** (e.g. `recipe_gateway_session_id`, `inventory_gateway_session_id`), so the Chef Agent and Pantry Agent maintain separate conversation histories.

## Session Storage Configuration (Backend)

### Both Layers Persistent (Recommended)

```yaml
# WebUI Gateway
session_service:
  type: "sql"
  database_url: "sqlite:///webui-gateway.db"

# Agent
session_service:
  type: "sql"
  database_url: "${AGENT_DATABASE_URL, sqlite:///agent-session.db}"
  default_behavior: "PERSISTENT"
```

### Agent-Only Persistent (Headless / API-only)

```yaml
# WebUI Gateway -- no database
session_service:
  type: "memory"

# Agent
session_service:
  type: "sql"
  database_url: "${AGENT_DATABASE_URL}"
  default_behavior: "PERSISTENT"
```

## Configurations to Avoid

| Config | Problem |
| ------ | ------- |
| Gateway persistent + Agent memory-only | UI shows old messages but the agent has amnesia. User sends a follow-up and the agent has no idea what they're talking about. |
| Gateway memory-only + Agent persistent | Agent remembers everything but the UI loses chat bubbles on refresh. The agent context is intact but invisible to the user. |

Both layers need persistence for a coherent experience. The default config uses SQLite (`sql` type) for both.

## Session State API (for Custom Gateways / Tools)

Agents and gateways can read/write arbitrary key-value state scoped to a session:

```python
# Store session-level state (expires after 24 hours)
self.context.set_session_state(session_id, "user_preferences", preferences)

# Retrieve session-level state
preferences = self.context.get_session_state(session_id, "user_preferences")

# Task-level state (short-lived, scoped to a single request)
self.context.set_task_state(task_id, "status_message_id", message_id)
retrieved = self.context.get_task_state(task_id, "status_message_id")
```
