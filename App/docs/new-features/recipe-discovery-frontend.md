# Plan: Recipe Discovery Frontend Page

## Context

The RecipeResearchAgent backend was already implemented (previous plan). Now the user wants a **dedicated frontend page** for recipe discovery — a chat-based UI where users converse with the RecipeResearchAgent to find recipes from their inventory, pick one, see details, and optionally find deals on missing ingredients.

The existing app has two pages: Chat (`/`) and Inventory (`/inventory`). We'll add a third: **Recipe Discovery** (`/recipes`).

## Architecture

```
/recipes → RecipeDiscoveryPage
              └── Full-page chat interface
                    ↕ GatewayClient.send() → OrchestratorAgent → RecipeResearchAgent
```

Messages route through OrchestratorAgent (consistent with existing `agents.js` pattern for recipes), which delegates to RecipeResearchAgent. The chat uses the same `GatewayClient` SSE streaming as everywhere else.

## Implementation Steps

### Step 1: Add `RecipeResearchAgent` to agents.js constants

**File:** `App/web/src/api/agents.js`

Add to `AGENTS` object:
```javascript
RECIPE_RESEARCH: "RecipeResearchAgent",
```

No new API methods needed — the page uses free-form chat, sending prompts via `api.orchestrator.prompt()` or directly to `RecipeResearchAgent`.

### Step 2: Create RecipeDiscoveryPage component

**File (new):** `App/web/src/pages/RecipeDiscoveryPage.jsx`

A **full-page chat interface** (not a slide-out panel like AssistantPanel). Design:

- **Header area:** Title "Recipe Discovery" with a brief subtitle and a "Suggest from inventory" quick-action button
- **Messages area:** Scrollable chat with user/assistant bubbles (reuse the bubble styling from AssistantPanel)
- **Input area:** Textarea + Send button at the bottom (same Enter-to-send pattern)
- **Markdown rendering:** Assistant responses contain formatted recipe info — render with `whitespace-pre-wrap` (matching existing pattern)

**Key behavior:**
- Uses `useGateway()` hook to get client + API
- Maintains `messages[]` state locally (role + text)
- Sends messages via `client.send(text, "OrchestratorAgent")` — Orchestrator routes to RecipeResearchAgent
- On page load, shows a welcome message with suggested prompts (e.g., "What can I cook with my inventory?")
- Has a "New conversation" button that calls `client.resetSession()` and clears messages
- Speech recognition (mic button) using the same `useSpeechRecognition` pattern from AssistantPanel

**Layout:** Full-width centered card (max-w-3xl) with the chat filling available viewport height.

### Step 3: Add route in main.jsx

**File:** `App/web/src/main.jsx`

```jsx
import RecipeDiscoveryPage from "./pages/RecipeDiscoveryPage";
// ...
<Route path="/recipes" element={<RecipeDiscoveryPage />} />
```

### Step 4: Add nav link in Layout.jsx

**File:** `App/web/src/components/Layout.jsx`

Add a "Recipes" NavLink between "Chat" and "Inventory" (or after Inventory):
```jsx
<NavLink to="/recipes" ...>Recipes</NavLink>
```

## Files Summary

| File | Action | Change |
|------|--------|--------|
| `App/web/src/api/agents.js` | Modify | Add `RECIPE_RESEARCH` agent constant |
| `App/web/src/pages/RecipeDiscoveryPage.jsx` | **Create** | Full-page recipe chat interface |
| `App/web/src/main.jsx` | Modify | Add `/recipes` route |
| `App/web/src/components/Layout.jsx` | Modify | Add "Recipes" nav link |

## Key Reuse

- **`useGateway()` hook** from `App/web/src/api/hooks.js` — creates GatewayClient + AgentAPI
- **`useSpeechRecognition()`** — extract from AssistantPanel into the new page (copy the hook inline, same pattern)
- **Chat bubble styling** — same Tailwind classes as `AssistantPanel.jsx` (lines 138-158)
- **Textarea pattern** — same auto-resize + Enter-to-send from `AssistantPanel.jsx` (lines 194-218)
- **UI components** — `Button` from `@/components/ui/button`, `Card` from `@/components/ui/card`

## Verification

1. Start backend: `cd App && uv run sam run configs/`
2. Start frontend: `cd App/web && npm run dev`
3. Open http://localhost:5173/recipes
4. Verify nav shows "Recipes" tab and highlights correctly
5. Send "What can I cook with my inventory?" — should see multi-turn conversation flow
6. Test "New conversation" button clears chat and resets session
7. Verify other pages (Chat, Inventory) still work
