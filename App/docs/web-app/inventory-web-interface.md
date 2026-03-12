# Inventory Web Interface (REST API)

This project includes a React-based inventory web client:

- `web/` (Vite + React app source)

It uses this flow:

`Web UI (list) -> Inventory REST API -> SQLite inventory DB`

`Web UI (add/update/delete) -> SAM Gateway -> InventoryManager agent -> SQLite inventory DB`

## Prerequisites

1. Start SAM gateway from `App/`:

```bash
uv run sam run configs/
```

2. Start the inventory REST API from `App/`:

```bash
./.venv/bin/python -m uvicorn src.inventory_api.app:app --host 0.0.0.0 --port 8001 --reload
```

3. Confirm services are up:

- `http://localhost:8000/health`

- `http://localhost:8001/health`

## Use the Web Interface

From `App/web`:

```bash
npm install
# Optional if API is not on default port:
# echo "VITE_INVENTORY_API_URL=http://localhost:8001" > .env.local
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

> If you deploy the API separately, configure CORS via `INVENTORY_API_ALLOWED_ORIGINS`.

## REST API Contract Used (Read-Only)

The page calls this endpoint for inventory refresh:

1. `GET /api/inventory/items?limit=200`

No token is required by default.

## Note About Agents

The chat page (`/`) uses SAM agents.  
The inventory page (`/inventory`) uses:
- REST API for `GET` inventory list.
- SAM `InventoryManager` for add/update/delete actions.
