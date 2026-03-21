# SSE Data Structures

Reference for the Server-Sent Events (SSE) data flowing between the SAM gateway and the web UI.

## Connection Flow

```
POST /api/v1/message:stream   →  returns { result: { id: taskId } }
GET  /api/v1/sse/subscribe/{taskId}  →  EventSource stream
```

The EventSource receives four named event types: `status_update`, `artifact_update`, `final_response`, `error`.

## Event: `status_update`

Sent repeatedly while the task is in progress. Each event's `data` field is JSON-RPC:

```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "result": {
    "kind": "status-update",
    "taskId": "task-xyz",
    "contextId": "session-id",
    "final": false,
    "status": {
      "state": "working",
      "message": {
        "role": "agent",
        "parts": [ ... ],
        "metadata": {
          "agent_name": "ShopperAgent"
        }
      }
    }
  }
}
```

### `result.status.state` values

| State       | Meaning                              |
|-------------|--------------------------------------|
| `working`   | Task still in progress               |
| `completed` | Task finished successfully           |

### `result.final`

- `false` — more events will follow
- `true`  — this is the last `status_update` for this task

### Message Parts (`result.status.message.parts`)

Each part has a `kind` field:

#### Text Parts
```json
{ "kind": "text", "text": "Here are the search results..." }
```
Streaming text content. Arrives incrementally across multiple `status_update` events during `state: "working"`. Each event appends new text — the full response is the concatenation of all text parts.

#### Data Parts (Signals)
```json
{ "kind": "data", "data": { "type": "<signal_type>", ... } }
```

Signal types:

| `data.type`                  | Purpose                                   | Key Fields                                         |
|------------------------------|-------------------------------------------|----------------------------------------------------|
| `agent_progress_update`      | Status text ("Searching...", "Processing") | `status_text`                                      |
| `tool_invocation_start`      | A tool is being called                    | `tool_name`, `function_call_id`, `tool_args`       |
| `tool_result`                | Tool call completed                       | `function_call_id`, `tool_name`, `result_data`     |
| `artifact_creation_progress` | Artifact being created/streamed           | `filename`, `status`, `bytes_transferred`, `artifact_chunk` |
| `artifact_saved`             | Artifact persisted                        | `filename`, `version`                              |
| `deep_research_progress`     | Multi-step research progress              | `status_text`, `progress_percentage`               |
| `llm_invocation`             | LLM model was called                     | `usage.model`                                      |
| `authentication_required`    | OAuth needed                              | `auth_uri`, `target_agent`                         |
| `rag_info_update`            | RAG search results with sources           | `title`, `query`, `sources[]`                      |

#### File Parts
```json
{ "kind": "file", "file": { "name": "image.png", "mime_type": "image/png", "uri": "artifact://..." } }
```

## Event: `artifact_update`

Sent when an artifact is created or modified.

```json
{
  "result": {
    "artifact": { "name": "report.md", "id": "...", "filename": "report.md" },
    "lastChunk": true
  }
}
```

## Event: `final_response`

The complete final response after all `status_update` events. Same JSON-RPC structure as `status_update` but represents the full, assembled response. The promise from `gateway.send()` resolves with this.

## Event: `error`

Server-side error. Gateway closes the stream after this.

## Text Extraction

`gateway.js` uses `extractDisplayText(payload)` to recursively collect all text parts from any depth of the payload, deduplicating and joining with `\n\n`.

## Streaming Text Accumulation

The `onStatus(text, payload)` callback receives:
- `text` — extracted display text from this single event
- `payload` — the full parsed JSON-RPC payload

During `state: "working"`, text content arrives incrementally. The UI should accumulate (replace, not append) the text as each event contains the full text up to that point from `extractDisplayText`. The final content matches the `final_response` event.

## Execution Timeline

The timeline tracker (`executionTimeline.js`) processes the data-part signals from `status_update` events to build a step-by-step progress view:
- Agent handoffs (from `metadata.agent_name` changes)
- Tool invocations and results (from `tool_invocation_start` / `tool_result` signals)
- Progress updates (from `agent_progress_update` signals)
- Artifact creation (from `artifact_creation_progress` / `artifact_saved` signals)

The timeline only tracks structured signals — raw agent text content is NOT shown as timeline steps.
