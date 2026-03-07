# Inventory Web Interface (SAM Gateway)

This project now includes a React-based inventory web client:

- `web/` (Vite + React app source)

It uses this flow:

`Web UI -> SAM HTTP SSE Gateway -> InventoryManager agent -> inventory SQLite DB`

## Prerequisites

1. Start SAM from `App/`:

```bash
uv run sam run configs/
```

2. Confirm gateway is up:

- `http://localhost:8000/health`

## Use the Web Interface

From `App/web`:

```bash
npm install
npm run dev
```

Then open:

- `http://localhost:5173`
- (compat URL) `http://localhost:5173/inventory-gateway-ui.html`

For production preview:

```bash
cd App/web
npm run build
npm run preview
```

Then open:

- `http://localhost:4173`
- (compat URL) `http://localhost:4173/inventory-gateway-ui.html`

> If you enable gateway auth, serve this UI from the same origin as the gateway
> or add an authenticated backend proxy.

## Gateway/API Contract Used

The page calls:

1. `POST /api/v1/message:stream`
- JSON-RPC payload with:
  - `method: "message/stream"`
  - `params.message.metadata.agent_name` (`InventoryManager` or `OrchestratorAgent`)
  - `params.message.contextId` for session continuity

2. `GET /api/v1/sse/subscribe/{taskId}`
- Listens to:
  - `status_update`
  - `artifact_update`
  - `final_response`

## Recommended Agent Selection

- Use `InventoryManager` for direct inventory operations.
- Use `OrchestratorAgent` if you want orchestration/delegation behavior.

## Inventory Routing Enablement

Inventory agent config now supports orchestration/discovery:

- `configs/agents/inventory-manager.yaml`
  - `agent_discovery.enabled: true`
  - `inter_agent_communication.allow_list: ["OrchestratorAgent"]`
