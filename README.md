# Smart-Appetite-Manager

Smart Appetite Manager is an AI-powered app designed to eliminate food waste by transforming passive kitchen inventory into active data. Instead of a static "to-do" list, it uses an SAM to check inventory, coordinate between specialized AI agents to suggest recipes, and optimize grocery for best prices shopping in real-time.

### SAM Architecture
<img width="1048" height="669" alt="SAM Architecture" src="https://github.com/user-attachments/assets/8fe84e52-3cbd-4d33-9b16-361f47c6ba21" />

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

If `uv` is missing on macOS:

```bash
brew install uv
```

## Docker Alternative

```bash
cd App
cp .env.example .env
# edit .env as above
docker build -t sam-hackathon-quickstart .
docker run -d --rm -p 8000:8000 --env-file .env --name sam-app sam-hackathon-quickstart
```

Logs/stop:

```bash
docker logs -f sam-app
docker stop sam-app
```

Keep this in `App/.env`:

```env
INVENTORY_MANAGER_DB_NAME=inventory.db
```

With this setup, the DB file lives at `App/inventory.db` when running locally,
and the `inventory` table is created automatically if missing.
