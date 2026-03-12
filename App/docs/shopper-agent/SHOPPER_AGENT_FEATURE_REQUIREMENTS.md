# Feature Requirements: Shopper Agent — Interactive Store Map

## Overview

Enhance the existing Shopper Agent to show an interactive map of nearby grocery stores with the best deals for missing ingredients. The map must be visible both inside the Solace Agent Mesh chat and as a standalone page in the React frontend.

---

## Functional Requirements

### FR-1: Geo-Enriched Deal Data

The Shopper Agent backend must return latitude and longitude for every store it recommends. Since Flipp does not return coordinates, use the **OpenStreetMap Nominatim API** (free, no API key) to geocode store locations. A new `geocode_store` tool function queries Nominatim with the store name and the configured postal code area, returning lat/lng. Results are cached in-memory to avoid redundant lookups.

### FR-2: Structured Map Data Output

When the Shopper Agent finds deals for multiple ingredients, it must output a structured `shopper_map_data` JSON block in its response (same pattern as the existing `recipe_data` blocks). This block must contain:

- A list of unique store locations with: store name, lat/lng, items available at that store, best price per item, and whether it's the recommended one-stop shop
- A map center point (default to Ottawa: 45.4215, -75.6972)
- The recommended store name

### FR-3: Interactive Map in Chat

When the chat receives a response containing `shopper_map_data`, it must render an embedded interactive map showing:

- A marker for each store
- The recommended store visually distinguished (different color or icon)
- Clickable markers that show a popup with: store name, items available, prices, and a "Get Directions" link (opens Google Maps)
- Auto-zoom to fit all markers

### FR-4: Interactive Map in Frontend Web App

A new Shopping page in the React frontend (`App/web/`) that includes:

- A large interactive map showing store locations with deals
- Deal summary cards for each store
- A chat interface connected to the Shopper Agent so users can ask for deals directly
- The map updates as new results come in from the agent via SSE

### FR-5: Reusable Map Component

The map component must be reusable across both the chat view (smaller, embedded) and the standalone page (larger, full-width). It accepts store locations, map center, and recommended store as props.

---

## Non-Functional Requirements

### NFR-1: No API Key Required for Maps

Use Leaflet with OpenStreetMap tiles — free, open-source, no API key or billing setup needed.

### NFR-2: No API Key Required for Deal Search

Flipp's undocumented search API (`backflipp.wishabi.com/flipp/items/search`) requires no API key. It uses a postal code to return local flyer deals. This removes the previous SerpApi dependency and cost.

### NFR-3: Consistent Design

Map styling, popups, and cards must match the existing app design system (Tailwind CSS + shadcn/ui components).

### NFR-4: Follow Existing Patterns

- Parsing `shopper_map_data` blocks must follow the same approach as `extractRecipeData()` in `parseResponse.js`
- The new tool must be registered in `shopper.yaml` following the same structure as existing tools
- The new page must use the same routing and layout patterns as `InventoryPage` and `RecipeDiscoveryPage`

---

## Technical Context

### Existing Backend Files

- `App/src/shopper_agent/grocery_tools.py` — current tools: `check_local_flyers`, `find_best_deals_batch` (powered by Flipp API)
- `App/configs/agents/shopper.yaml` — agent config with instructions and tool registration

### Flipp API Details

The Flipp search endpoint returns flyer deals for a given postal code:

```
GET https://backflipp.wishabi.com/flipp/items/search?locale=en-us&postal_code={POSTAL_CODE}&q={QUERY}
```

Response `items` array contains objects with:
- `merchant_name` — store name (e.g., "Adonis", "Loblaws", "Food Basics")
- `name` — item description
- `current_price` — sale price (number)
- `original_price` — regular price if available (number or null)
- `post_price_text` — unit qualifier (e.g., "/lb", "/ea")
- `sale_story` — deal description (e.g., "33% SAVINGS", "SAVE UP TO 40%", "Rollback")
- `valid_from` / `valid_to` — deal validity dates (ISO 8601)
- `clean_image_url` — flyer item image
- `merchant_logo` — store logo URL
- `item_type` — "flyer" (weekly flyer deals) or "ecom" (online store listings)

### Geocoding with Nominatim

Since Flipp doesn't return store coordinates, use OpenStreetMap Nominatim to geocode:

```
GET https://nominatim.openstreetmap.org/search?q={store_name}+near+{postal_code}&format=json&limit=1
```

- Free, no API key required
- Rate limit: 1 request per second (use caching + small delay between requests)
- Must set a `User-Agent` header per Nominatim usage policy

### Existing Frontend Files

- `App/web/src/lib/parseResponse.js` — has `extractRecipeData()` which extracts JSON from fenced code blocks in agent responses
- `App/web/src/hooks/useAssistantChat.js` — processes agent responses and attaches extracted data to messages
- `App/web/src/components/assistant/AssistantPanel.jsx` — renders chat messages, recipe cards, and execution timelines
- `App/web/src/components/recipes/RecipeDetailsDialog.jsx` — shows missing ingredients (potential integration point)
- `App/web/src/api/gateway.js` — JSON-RPC client with SSE streaming
- `App/web/src/main.jsx` — app routes and entry point

### Key Dependencies

- **Current:** React 18, Vite, Tailwind 4.2, shadcn/ui, react-markdown, lucide-react
- **To add:** `react-leaflet`, `leaflet`

### Data Flow

```
User asks for deals → Orchestrator → Shopper Agent → Flipp API (deals by postal code)
→ Agent geocodes unique stores via Nominatim
→ Agent returns markdown tables + shopper_map_data JSON block
→ Frontend extracts shopper_map_data → Renders interactive map with markers
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FLIPP_POSTAL_CODE` | Postal/zip code for local flyer deals | `K1A 0A6` (Ottawa) |
| `FLIPP_LOCALE` | Locale for Flipp search | `en-us` |

---

## Acceptance Criteria

1. When I ask the Shopper Agent for deals on missing ingredients in the chat, I see an interactive map embedded below the deal tables showing store locations
2. Each store marker on the map is clickable and shows store name, available items, and a directions link
3. The recommended one-stop shop is visually highlighted on the map
4. The new Shopping page in the web app shows a full-size map alongside a chat interface for the Shopper Agent
5. The map works without any API keys — uses OpenStreetMap tiles
6. Deal search works without any API keys — uses Flipp's search endpoint
7. All new code follows existing project patterns and conventions
