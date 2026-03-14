# Quick Start Guide

## Prerequisites

| Tool       | Version | Install (macOS)            |
| ---------- | ------- | -------------------------- |
| Python     | 3.11.x  | `brew install python@3.11` |
| uv         | latest  | `brew install uv`          |
| Node.js    | 18+     | `brew install node`        |
| Docker     | 20.10+  | Docker Desktop (optional)  |

## First-Time Setup

### 1. Navigate to the App directory

```bash
cd App
```

### 2. Create and configure environment variables

```bash
cp .env.example .env
```

Edit `App/.env` and fill in your API keys:

```env
LLM_SERVICE_API_KEY=your-llm-api-key
LLM_SERVICE_ENDPOINT=https://api.cerebras.ai/v1
LLM_SERVICE_PLANNING_MODEL_NAME=openai/gpt-oss-120b
LLM_SERVICE_GENERAL_MODEL_NAME=openai/gpt-oss-120b
LLM_SERVICE_IMAGE_MODEL_NAME=openai/gpt-oss-120b

SPOONACULAR_API_KEY=your-spoonacular-key

INVENTORY_MANAGER_DB_NAME=inventory.db
FLIPP_POSTAL_CODE=K1A 0A6
FLIPP_LOCALE=en-us

SOLACE_DEV_MODE=true
```

See `docs/llm-setup.md` for free LLM API options.

### 3. Install Python dependencies

```bash
uv sync
```

### 4. Install web frontend dependencies

```bash
cd web
npm install
cd ..
```

Create `web/.env` if it doesn't exist:

```bash
cp web/.env.example web/.env
```

### 5. Build the frontend (production)

```bash
cd web
npm run build
cd ..
```

## Running the App

### Step 1: Start Solace Agent Mesh server

```bash
# From App/ directory
uv run sam run configs/
```

This starts the in-memory broker, all agents, and the WebUI gateway.


### Step 2: Start the Inventory REST API (separate terminal)

```bash
# From App/ directory
./.venv/bin/python -m uvicorn src.inventory_api.app:app \
  --host 0.0.0.0 --port 8001 --reload
```

- API: http://localhost:8001
- Docs: http://localhost:8001/docs

### Step 3: Start the User Interface terminal

```bash
cd App/web
npm run dev
```

Dev server runs on http://localhost:5173 with hot reload.

## Verify

1. Open http://localhost:8000 in your browser
2. You should see the chat interface
3. Send a test message like "Hello" to verify the agents respond

## Ports

| Service            | Port |
| ------------------ | ---- |
| WebUI Gateway      | 8000 |
| Inventory REST API | 8001 |
| Vite dev server    | 5173 |

## Troubleshooting

| Issue                      | Fix                                                 |
| -------------------------- | --------------------------------------------------- |
| `uv: command not found`    | `brew install uv`                                   |
| Wrong Python version       | `brew install python@3.11`                           |
| Port 8000 in use           | `lsof -ti:8000 \| xargs kill -9`                    |
| LLM calls failing          | Check `LLM_SERVICE_API_KEY` in `.env`               |
| Database errors            | SQLite auto-creates on first use, no manual setup   |
| Broker errors              | Ensure `SOLACE_DEV_MODE=true` is set in `.env`      |
