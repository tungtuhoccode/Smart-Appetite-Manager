# Smart-Appetite-Manager

Smart Appetite Manager is an AI-powered app designed to eliminate food waste by transforming passive kitchen inventory into active data. Instead of a static "to-do" list, it uses an SAM to check inventory, coordinate between specialized AI agents to suggest recipes, and optimize grocery for best prices shopping in real-time.

<img width="1884" height="892" alt="SAM Architecture" src="https://github.com/user-attachments/assets/f1ebaf3a-84c0-4b5a-9a70-1dc2151eb545" />

# Smart Appetite Manager Setup Instructions

Use the `App/` folder as the project root (not repository root).

## CLI Install + Run (Recommended)

```bash
cd App

# 1) Create env file
cp .env.example .env
```

Edit `App/.env` and set at least:

```env
LLM_SERVICE_API_KEY=...
LLM_SERVICE_ENDPOINT=https://api.cerebras.ai/v1
LLM_SERVICE_PLANNING_MODEL_NAME=openai/gpt-oss-120b
LLM_SERVICE_GENERAL_MODEL_NAME=openai/gpt-oss-120b
SOLACE_DEV_MODE=true
```

For this fork, also add:

```env
SPOONACULAR_API_KEY=...        # used by recipe tools (App/src/recipe_agent/mealdb_tools.py:17)
SERPAPI_KEY=...                # used by shopper agent (App/configs/agents/shopper.yaml:70)
INVENTORY_MANAGER_DB_NAME=inventory.db   # used by inventory agent (App/configs/agents/inventory-manager.yaml:52)
```

Inventory DB bootstrap (automatic):
No manual SQL step is required. The inventory tool now runs schema bootstrap
on every call and creates/updates the `inventory` table if needed.

Install dependencies and run:

```bash
uv sync
uv run sam run configs/
```

Open: `http://localhost:8000`

Inventory web interface (custom page with REST read + SAM write):

- Open `App/web/inventory-gateway-ui.html`
- Full guide: `App/docs/inventory-web-interface.md`
- Start inventory API first:

```bash
cd App
./.venv/bin/python -m uvicorn src.inventory_api.app:app --host 0.0.0.0 --port 8001 --reload
```

If `uv` is missing on macOS:

```bash
brew install uv
```

## Docker (Recommended for full stack)

The repo ships a `docker-compose.yml` that starts all four services together:

| Service | Port | Description |
|---------|------|-------------|
| `sam-app` | 8000 | Solace Agent Mesh (AI orchestration) |
| `inventory-api` | 8001 | Inventory REST API |
| `ocr-service` | 8002 | Barcode / OCR service |
| `web` | 5173 | React frontend |

**Prerequisites:** Docker Desktop (includes Compose v2).

```bash
# 1. Copy and fill in env vars (repo root)
cp App/.env.example App/.env
# edit App/.env — set LLM keys, SPOONACULAR_API_KEY, SERPAPI_KEY
# INVENTORY_MANAGER_DB_NAME is set automatically to /app/data/inventory.db

# 2. Build and start
docker compose up --build -d

# 3. Open the app
open http://localhost:5173
```

The inventory database is stored in a named Docker volume (`inventory_data`) mounted at
`/app/data` inside the containers. It persists across restarts and is created automatically
on first run — no manual SQL step required.

Logs / stop:

```bash
docker compose logs -f          # stream all services
docker compose logs inventory-api   # single service
docker compose down             # stop and remove containers (volume kept)
docker compose down -v          # stop and remove containers + volume (wipes DB)
```
