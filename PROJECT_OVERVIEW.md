# Smart Appetite Manager - Project Overview

**Award:** Solace Agent Mesh Prize Winner at uOttaHack 8

An AI-powered food inventory and appetite management system that processes grocery receipts, tracks fridge inventory, suggests recipes based on what you have, and finds the best local grocery deals — all coordinated through a multi-agent architecture.

## The Problem

Managing food inventory is a complex coordination problem involving asynchronous events: receipts arrive, inventory changes, items expire, and meals get planned. Traditional approaches treat these as isolated data silos, leading to food waste and inefficient shopping.

## How It Works

The system uses a **three-phase workflow** powered by specialized AI agents communicating via events:

1. **Inventory Ingestion** — Users provide grocery lists or receipts. The Inventory Agent parses items, updates a SQLite database, and triggers an inventory update event.

2. **Recipe Intelligence** — The Chef Agent reacts to inventory changes, generates recipe suggestions ranked by ingredient availability, and pauses for user selection before identifying missing ingredients.

3. **Frugal Fulfillment** — The Shopper Agent searches real-time flyers from Ottawa grocers (Metro, Loblaws, Walmart, etc.) and verifies store locations via Google Maps to find the best deals on missing ingredients.

## Architecture

```
React UI (localhost:8000)
    |
    | POST /api/v1/message:stream (JSON-RPC)
    v
SAM HTTP SSE Gateway (FastAPI)
    |
    v
Orchestrator Agent (routes tasks)
    |
    +---> Inventory Manager Agent ---> SQLite DB
    |
    +---> Recipe Lookup Agent -------> Spoonacular API
    |
    +---> Shopper Agent -------------> SerpAPI (Google Shopping / Maps)
    |
    v
SSE /api/v1/sse/subscribe/{taskId}
    |
    v
React UI (real-time streaming updates)
```

**Framework:** Solace Agent Mesh (SAM) — agents communicate via an event broker rather than direct coupling, enabling decoupled, scalable coordination.

## Agents

| Agent | Role | Key Tools |
|-------|------|-----------|
| **Orchestrator** | Routes user requests to the right agent(s), coordinates multi-agent workflows | Agent discovery, task delegation |
| **Inventory Manager** | CRUD operations on kitchen inventory (SQLite) | `list_inventory_items`, `insert_inventory_items`, `increase/decrease_inventory_stock` |
| **Recipe Lookup** | Finds recipes matching available ingredients via Spoonacular | `get_top_3_meals`, `get_meal_details`, `search_meals` |
| **Shopper (Grocery Scout)** | Finds best grocery deals in Ottawa via flyer search | `check_local_flyers`, `find_best_deals_batch`, `find_nearest_store_address` |

A **Receipt Parser** tool (`receipt_tools.py`) also exists for extracting items from OCR-scanned receipt text.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Solace Agent Mesh (SAM) 1.13.3 |
| Backend | Python 3.11, uv package manager |
| Frontend | React 18, Vite |
| Database | SQLite (default), PostgreSQL (optional) |
| LLM | Cerebras / OpenAI-compatible endpoints |
| APIs | Spoonacular (recipes), SerpAPI (shopping/maps) |
| Monitoring | Sentry |
| Deployment | Docker, Railway |

## Project Structure

```
Smart-Appetite-Manager/
├── README.md
└── App/
    ├── configs/
    │   ├── shared_config.yaml          # Shared YAML anchors (LLM, broker)
    │   ├── orchestrator.yaml           # Orchestrator agent config
    │   ├── webui.yaml                  # HTTP SSE Gateway
    │   └── agents/
    │       ├── inventory-manager.yaml  # Inventory agent
    │       ├── recipe_lookup.yaml      # Recipe agent
    │       └── shopper.yaml            # Shopper agent
    ├── src/
    │   ├── rate_limit_init.py          # LLM rate limiting
    │   ├── inventory_agent/
    │   │   └── inventory_manager_tools.py  # SQLite CRUD
    │   ├── recipe_agent/
    │   │   └── mealdb_tools.py         # Spoonacular integration
    │   ├── receipt_agent/
    │   │   └── receipt_tools.py        # OCR receipt parsing
    │   └── shopper_agent/
    │       └── grocery_tools.py        # SerpAPI deal finder
    ├── web/
    │   └── src/
    │       ├── App.jsx                 # React inventory UI
    │       ├── main.jsx
    │       └── styles.css
    ├── docs/                           # Setup & deployment guides
    ├── .env.example                    # Environment variable template
    ├── Dockerfile
    └── pyproject.toml
```

## Database Schema

```sql
CREATE TABLE inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    quantity_unit TEXT,       -- e.g., "kg", "L", "unit"
    unit TEXT,               -- e.g., "pack", "bottle", "dozen"
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Auto-created on first tool call — no manual setup required.

## Quick Start

```bash
cd App
cp .env.example .env
# Edit .env with your API keys (LLM, Spoonacular, SerpAPI)
uv sync
uv run sam run configs/
# Open http://localhost:8000
```

## Key Design Decisions

- **Event-driven over sequential** — Agents communicate via events, not direct calls, enabling independent scaling and loose coupling.
- **Human-in-the-loop** — The system pauses for user confirmation (e.g., recipe selection) before proceeding, acting as a copilot rather than autonomous.
- **Location grounding** — Store addresses are verified against Google Maps to prevent non-local results (Ottawa area).
- **Rate limiting** — Thread-safe rate limiting across agents prevents API throttling during multi-agent workflows.
- **Auto-deduplication** — Inventory insertions check for existing items by (name, unit) to prevent duplicates.

## Team

- Tung Tran 
- Vu Nguyen
- Quynh Vo
- BaoVoHoang Vo

## Future Plans

- Native camera input for receipt scanning
- Nutrition and expiration tracking agents
- Barcode scanning support
- Expanded meal planning and health insights
- City-wide grocery mesh (beyond Ottawa)
