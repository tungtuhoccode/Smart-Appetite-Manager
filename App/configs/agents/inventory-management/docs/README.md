# Inventory Management — Agent Architecture

## Overview

The inventory management system uses a **sub-orchestrator pattern**: a dedicated orchestrator agent owns
the user conversation and delegates work to two silent backend agents. The main SAM OrchestratorAgent
routes all inventory-related requests here.

## Architecture

```
User
  |
  v
Main Orchestrator (OrchestratorAgent)
  |
  v
Inventory Orchestrator  <-- user-facing, owns the conversation
  |
  |--- delegates parsing to ---> Ingredient Parser  (silent, returns JSON)
  |
  |--- delegates DB ops to ----> Inventory DB        (silent, returns tool results)
```

## Agents

### 1. Inventory Orchestrator (`inventory-orchestrator.yaml`)

- **Agent name:** `InventoryOrchestrator`
- **Model:** `*parsing_model` (Claude 4.5 Sonnet via Bedrock — strong reasoning)
- **Role:** User-facing sub-orchestrator for all inventory tasks
- **Has tools:** No (instruction-only). Uses PeerAgentTool to call sub-agents.
- **Responsibilities:**
  - Receives all inventory requests from the main orchestrator
  - Decides whether to delegate to IngredientParser (bulk lists) or InventoryDB (CRUD)
  - Manages the confirmation flow with the user before any mutation
  - Handles error reporting — relays exact errors from sub-agents
  - For simple single-item requests, parses them inline (no need for IngredientParser)
- **Inter-agent communication:**
  - Accepts calls from: `OrchestratorAgent`
  - Calls: `IngredientParser`, `InventoryDB`

### 2. Ingredient Parser (`ingredient-parser.yaml`)

- **Agent name:** `IngredientParser`
- **Model:** `*parsing_model` (Claude 4.5 Sonnet via Bedrock — strong reasoning)
- **Role:** Silent backend parser that converts free-form text into structured JSON
- **Has tools:** No (instruction-only, pure LLM reasoning)
- **Responsibilities:**
  - Receives raw ingredient text (numbered lists, bulleted lists, receipt-style, etc.)
  - Parses each line into structured items: `{product_name, quantity, quantity_unit, unit}`
  - Normalizes units to canonical forms (see `inventory_schema.md`)
  - Returns ONLY a JSON array — no conversational text
  - Flags unparseable lines separately
- **Inter-agent communication:**
  - Accepts calls from: `InventoryOrchestrator`
  - Calls: nobody (pure parser)

### 3. Inventory DB (`inventory-db.yaml`)

- **Agent name:** `InventoryDB`
- **Model:** `*general_model` (Azure GPT-4o — fast, good enough for CRUD)
- **Role:** Silent backend database agent that executes CRUD operations
- **Has tools:**
  - `get_ingredient_names` — comma-separated ingredient names for recipe search
  - `list_inventory_items` — read all inventory rows
  - `insert_inventory_items` — insert items (auto-merges duplicates)
  - `increase_inventory_stock` — increase quantity for one item
  - `decrease_inventory_stock` — decrease quantity for one item
  - `delete_inventory_item` — permanently remove one item
  - Built-in groups: `artifact_management`, `data_analysis`
- **Responsibilities:**
  - Receives structured requests and executes the appropriate tool
  - Returns raw tool results — no formatting, no user-facing text
  - Does NOT ask for confirmation (orchestrator handles that)
- **Inter-agent communication:**
  - Accepts calls from: `InventoryOrchestrator`, `RecipeResearchAgent`
  - Calls: nobody (pure executor)

## Workflows

### A. Bulk Add (e.g., "add these 40 items to my inventory: ...")

```
1. User sends grocery list
2. Main Orchestrator -> InventoryOrchestrator (matches agent_card description)
3. InventoryOrchestrator detects bulk free-form list
4. InventoryOrchestrator -> IngredientParser: "parse this text"
5. IngredientParser returns structured JSON array
6. InventoryOrchestrator presents table to user:
   | # | Product Name | Qty | Unit | Packaging |
7. User confirms (or requests corrections -> re-present -> repeat)
8. InventoryOrchestrator -> InventoryDB: "insert these items: [...]"
9. InventoryDB calls insert_inventory_items, returns result
10. InventoryOrchestrator reports success/failure to user
```

### B. Single Item Add (e.g., "add 2 kg of chicken")

```
1. User sends simple request
2. Main Orchestrator -> InventoryOrchestrator
3. InventoryOrchestrator parses inline (simple enough, no IngredientParser needed)
4. Confirms with user
5. InventoryOrchestrator -> InventoryDB: "insert this item"
6. Reports result to user
```

### C. View Inventory

```
1. User asks "what's in my pantry?"
2. Main Orchestrator -> InventoryOrchestrator
3. InventoryOrchestrator -> InventoryDB: "list inventory"
4. InventoryDB returns rows
5. InventoryOrchestrator formats and presents to user
```

### D. Increase / Decrease Stock

```
1. User asks "I used 500g of chicken"
2. Main Orchestrator -> InventoryOrchestrator
3. InventoryOrchestrator confirms item and amount with user
4. InventoryOrchestrator -> InventoryDB: "decrease stock"
5. Reports result
```

### E. Delete Item

```
1. User asks "remove the expired milk"
2. Main Orchestrator -> InventoryOrchestrator
3. InventoryOrchestrator confirms deletion with user (permanent action)
4. InventoryOrchestrator -> InventoryDB: "delete item"
5. Reports result
```

### F. Recipe Agent Reads Inventory (cross-agent)

```
1. RecipeResearchAgent needs ingredient list for recipe search
2. RecipeResearchAgent -> InventoryDB (directly, via inter-agent communication)
3. InventoryDB calls get_ingredient_names, returns comma-separated list
4. RecipeResearchAgent uses ingredients for recipe lookup
```

## Configuration

### Models

| Agent                  | Model Anchor     | Default Model                       | Why                                      |
| ---------------------- | ---------------- | ----------------------------------- | ---------------------------------------- |
| InventoryOrchestrator  | `*parsing_model` | `openai/bedrock-claude-4-5-sonnet`  | Strong reasoning for routing & conversation |
| IngredientParser       | `*parsing_model` | `openai/bedrock-claude-4-5-sonnet`  | Strong reasoning for text parsing        |
| InventoryDB            | `*general_model` | `openai/azure-gpt-4o`              | Fast, sufficient for structured CRUD     |

To override the parsing model, set `LLM_SERVICE_PARSING_MODEL_NAME` in `.env`.

### Shared Config Anchor

Defined in `configs/shared_config.yaml`:

```yaml
parsing: &parsing_model
  model: ${LLM_SERVICE_PARSING_MODEL_NAME, openai/bedrock-claude-4-5-sonnet}
  api_base: ${LLM_SERVICE_ENDPOINT}
  api_key: ${LLM_SERVICE_API_KEY}
  temperature: 0.1
```

### Database

All three agents share the same SQLite database:
- Path: `${INVENTORY_MANAGER_DB_NAME}` (default: `inventory.db`)
- Session persistence: `${INVENTORY_MANAGER_DATABASE_URL}` (default: `sqlite:///inventory_manager.db`)

## Files

```
configs/agents/inventory-management/
  inventory-orchestrator.yaml   # User-facing sub-orchestrator
  ingredient-parser.yaml        # Silent text parser
  inventory-db.yaml             # Silent DB CRUD agent
  inventory_schema.md           # Shared schema: columns, units, parsing examples
  README.md                     # This file
```

Source code for DB tools: `src/inventory_agent/inventory_manager_tools.py`

## Design Decisions

1. **Sub-orchestrator pattern:** The main SAM orchestrator routes to InventoryOrchestrator,
   which then delegates to specialized agents. This keeps each agent's scope narrow and
   its instruction prompt focused.

2. **Silent sub-agents:** IngredientParser and InventoryDB never talk to the user.
   They process requests and return raw results. The orchestrator owns all user interaction,
   confirmation flows, and error handling.

3. **Parsing model choice:** IngredientParser and InventoryOrchestrator use a stronger
   reasoning model (Claude 4.5 Sonnet) because parsing messy ingredient text and routing
   decisions require more intelligence. InventoryDB uses the general model since it just
   maps structured requests to tool calls.

4. **Confirmation before mutation:** The orchestrator always confirms with the user before
   any insert, update, or delete. This prevents accidental data changes.

5. **RecipeResearchAgent direct access:** The recipe agent can call InventoryDB directly
   (bypassing the orchestrator) because it only needs read access (`get_ingredient_names`),
   not mutations that require user confirmation.
