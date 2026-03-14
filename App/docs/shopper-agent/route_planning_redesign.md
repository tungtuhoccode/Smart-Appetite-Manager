# Shopper Agent Route Planning Redesign

## Context
The current shopper agent finds deals via Flipp flyers and optimizes routes across stores. However, it has key limitations:
- Items not found in flyers are simply listed as "not found" with no guidance
- Route planning only considers stores with active deals, ignoring that some stores (Walmart, No Frills) are inherently cheap for everyday items
- The system treats each store location independently rather than recognizing deals are per-chain (a Walmart flyer deal applies to ALL nearby Walmarts)
- No max store visit limit -- users don't want to visit 4+ stores even for deals

**Goal**: Redesign the route planner so it (1) uses Flipp for deals, (2) uses LLM reasoning to assign non-deal items to budget-friendly stores, (3) combines everything into a single optimized route with a user-configurable max store limit, and (4) treats deals as chain-wide.

## Key Design Principles
1. **Deals are per-chain** -- "Walmart has chicken on sale" means ANY Walmart nearby has it
2. **Route = choosing chains, then picking nearest locations** -- decide to visit "Walmart + Loblaws", then find the closest Walmart and closest Loblaws
3. **Max store visits** -- user-configurable (default 2-3), hard cap to prevent impractical routes
4. **Budget store fallback via LLM** -- for items not on sale, the LLM reasons about which stores in the route (or which additional budget store) would be cheapest
5. **Favor stores already in the route** -- if Walmart already has a deal on chicken, prefer buying non-deal items there too rather than adding another stop

---

## Architecture: Two-Phase (Tool + LLM Reasoning)

The tool does algorithmic scoring and returns structured data. The LLM then reasons about non-deal item assignments using its knowledge of Canadian grocery chains. This keeps the tool fast/deterministic while leveraging LLM intelligence for the subjective "which store is cheapest for everyday items" question.

```
User: "Plan a trip for eggs, milk, bread, chicken, rice - max 2 stores"
  -> LLM extracts items + max_stops=2
  -> plan_optimal_route(items=[...], max_stops=2)
      Step 1: Flipp search -> classify deal vs no-deal items
      Step 2: Normalize chain names (Walmart Supercentre -> Walmart)
      Step 3: Generate chain combos (1-chain, 2-chain, capped at max_stops)
      Step 4: Score combos (price + convenience + coverage + distance + budget_affinity)
      Step 5: Geocode top chains via Overpass (batch, faster than Nominatim)
      Step 6: Return top routes + items_without_deals list
  -> LLM receives structured output
  -> LLM Phase 2: reasons about where to buy non-deal items
      "Walmart has eggs on sale AND is a budget chain -> buy milk, bread, rice there too"
  -> Presents unified route to user
```

---

## Design Observations from Scenarios

See [ROUTE_PLANNING_SCENARIOS.md](./ROUTE_PLANNING_SCENARIOS.md) for the full 20 scenarios.

### Key Patterns:
1. **1-2 stops is almost always optimal for real users** -- 3+ stops only make sense for very large lists with significant savings
2. **Budget stores that also have deals are the sweet spot** -- Walmart/No Frills with a flyer deal should be heavily favored
3. **The decision is really: "is the deal savings worth an extra stop?"** -- this is the core trade-off
4. **Chain-level thinking simplifies the problem** -- don't think about "Walmart at 123 Main St", think about "the Walmart chain has X deals, and the nearest one is Y km away"
5. **Non-deal items dominate large shopping lists** -- for 15 items with 3 on sale, the 12 regular items matter more for store choice

---

## Implementation Plan

### Step 1: `grocery_tools.py` -- Add chain normalization + price_val

**File**: `App/src/shopper_agent/grocery_tools.py`

**Changes:**
1. Add `CHAIN_ALIASES` dict and `normalize_chain_name()` function:
   ```python
   CHAIN_ALIASES = {
       "walmart supercentre": "Walmart", "walmart supercenter": "Walmart",
       "walmart": "Walmart", "no frills": "No Frills", "nofrills": "No Frills",
       "food basics": "Food Basics", "freshco": "FreshCo", "metro": "Metro",
       "loblaws": "Loblaws", "sobeys": "Sobeys", "giant tiger": "Giant Tiger",
       "real canadian superstore": "Real Canadian Superstore",
       "farm boy": "Farm Boy", "t&t supermarket": "T&T Supermarket",
   }

   def normalize_chain_name(merchant_name: str) -> str:
       return CHAIN_ALIASES.get(merchant_name.lower().strip(), merchant_name.strip())
   ```

2. Add `price_val` field to `_parse_flipp_items()` output so route optimizer doesn't re-parse price strings:
   ```python
   deals.append({
       ...,
       "price_val": float(price) if price is not None else 0.0,
   })
   ```

3. Apply chain normalization in `_parse_flipp_items()` to the `store` field.

**Reuses**: existing `find_nearby_stores()` -- already does batch Overpass geocoding. Route optimizer will import this instead of using Nominatim.

---

### Step 2: `route_optimizer.py` -- Algorithm Redesign (Core Change)

**File**: `App/src/shopper_agent/route_optimizer.py`

**A. New `max_stops` parameter:**
```python
async def plan_optimal_route(
    items: List[str],
    max_stops: int = 3,  # NEW -- user-configurable
    weight_price: float = 0.30,
    weight_convenience: float = 0.25,
    weight_coverage: float = 0.20,
    weight_distance: float = 0.15,
    weight_budget_affinity: float = 0.10,  # NEW
    ...
)
```

**B. Chain normalization in `_build_store_item_matrix()`:**
- Import `normalize_chain_name` from `grocery_tools`
- Apply to all store names before building matrix -> merges "Walmart Supercentre" with "Walmart"

**C. Enforce `max_stops` in `_generate_candidate_routes()`:**
```python
def _generate_candidate_routes(matrix, all_chains, all_items, max_stops=3):
    candidates = []
    for k in range(1, min(max_stops, len(all_chains)) + 1):
        for combo in combinations(all_chains, k):
            route = _evaluate_combo(list(combo))
            if route["coverage"] > 0:
                candidates.append(route)
    # Greedy set-cover, capped at max_stops
    ...
```

**D. Add `budget_affinity` scoring factor:**
```python
BUDGET_CHAINS = {"Walmart", "No Frills", "Food Basics", "FreshCo", "Giant Tiger",
                 "Real Canadian Superstore"}

def _budget_affinity_score(chains: List[str]) -> float:
    if not chains: return 0.0
    return sum(1 for c in chains if c in BUDGET_CHAINS) / len(chains)
```

Add to `_score_routes()` alongside existing factors.

**E. Switch geocoding from Nominatim to Overpass:**
- Import `find_nearby_stores` from `grocery_tools`
- Replace the per-store `_geocode_store()` loop (with 1.1s sleep) with a single batch `find_nearby_stores()` call
- Pick nearest location per chain to user's center coordinates
- This is faster (1 API call vs N calls with rate limiting)

**F. Restructured output:**
```python
return {
    "status": "success",
    "items_searched": items,
    "items_with_deals": [...],
    "items_without_deals": items_not_found,  # renamed, explicit for LLM
    "max_stops_used": max_stops,
    "total_chains_found": len(all_chains),
    "routes_evaluated": len(candidates),
    "weights_used": weights,
    "top_routes": [
        {
            "rank": 1,
            "chains": ["Walmart", "Loblaws"],  # renamed from "stores"
            "chain_count": 2,
            "deal_items_covered": [...],
            "missing_items": [...],
            "total_cost": 48.99,
            "coverage": "80%",
            "route_distance_km": 12.5,
            "weighted_score": 0.82,
            "factor_scores": {
                "price": 0.85, "convenience": 0.9,
                "coverage": 0.8, "distance": 0.75,
                "budget_affinity": 1.0  # NEW
            },
            "chain_breakdown": [
                {
                    "chain": "Walmart",
                    "deal_items": [{"name": "eggs", "price": "$3.49", "sale_story": "..."}],
                    "nearest_location": {"lat": 45.42, "lng": -75.69, "address": "..."},
                    "subtotal": 3.49
                }
            ]
        }
    ],
    "shopper_map_data": {...}
}
```

---

### Step 3: `route_planner.yaml` -- LLM Instructions for Non-Deal Item Reasoning

**File**: `App/configs/agents/route_planner.yaml`

**Key instruction changes:**

1. **Max stops extraction** -- LLM parses "max 2 stores", "only 1 stop", etc. Default = 3.

2. **Non-deal item reasoning block** (the critical new section):
   ```
   ## Non-Deal Item Reasoning (CRITICAL)
   The tool returns `items_without_deals` -- items with no flyer deals.
   For these, YOU reason about where to buy them:

   Budget chains (cheapest everyday): Walmart, No Frills, Food Basics, FreshCo, Giant Tiger
   Mid-range: Metro, Sobeys, Loblaws, Farm Boy

   Rules:
   - If a budget chain is ALREADY in the route -> assign non-deal items there (no extra stop)
   - If NO budget chain in route + only 1-2 non-deal items -> buy at whatever store is in route
   - If NO budget chain in route + 3+ non-deal items -> suggest adding a budget store
   - ALWAYS explain your reasoning
   ```

3. **Core trade-off instruction**:
   ```
   When reviewing routes, think: "Is the deal savings worth an extra stop?"
   - $2 savings is NOT worth a 15-minute detour
   - $15 savings probably IS worth it
   - 1-2 stops is almost always optimal
   ```

4. **New response format** distinguishing deal items vs non-deal items per stop:
   ```
   **Stop 1: Walmart** (123 Main St)
   - Deal items: | Item | Sale Price | Sale Info |
   - Non-deal items: | Item | Why Here |
                      | Rice | Budget chain, already visiting |
   ```

---

### Step 4: Frontend Updates

**A. `RouteScoreCard.jsx`** (`App/web/src/components/shopping/RouteScoreCard.jsx`)
- Add `budget_affinity` to factor score bars (label: "Budget", amber color)
- Support both `stores`/`chains` and `store_breakdown`/`chain_breakdown` field names
- Distinguish deal items (sale badge) vs non-deal items ("Regular price" indicator) in breakdown

**B. `useShoppingChat.js`** (`App/web/src/hooks/useShoppingChat.js`)
- Extract max_stops from user prompt using regex: `/\b(?:max|only|at most)\s*(\d+)\s*(?:stores?|stops?)\b/i`
- Pass max_stops hint in auto-follow-up route prompt

**C. `ShoppingPage.jsx`** (`App/web/src/pages/ShoppingPage.jsx`)
- Update "items not found" warning to say "assigned to stores at regular prices"
- Support new field names (`total_chains_found`, `items_without_deals`)

**D. `parseResponse.js`** (`App/web/src/lib/parseResponse.js`)
- No structural changes needed -- it already extracts `route_plan_data` JSON blocks generically

---

### Step 5: `shopper.yaml` -- Minor Tweak

**File**: `App/configs/agents/shopper.yaml`
- Add note in instructions: "The Route Planner will follow up with an optimized route. Your job is to find and present deals clearly."
- Apply `normalize_chain_name` in `find_deals_with_map` output for consistent chain names

---

## Implementation Order

1. `grocery_tools.py` -- chain normalization + price_val (low risk, foundation)
2. `route_optimizer.py` -- algorithm rewrite (highest risk, core logic)
3. `route_planner.yaml` -- LLM instructions (test with real prompts)
4. Frontend files -- RouteScoreCard, useShoppingChat, ShoppingPage (can parallel with #3)
5. `shopper.yaml` -- minor instruction tweak (last)

---

## Verification

1. **Unit test the algorithm**: Call `plan_optimal_route` with mock Flipp data covering scenarios 1-5 (all deals, split deals, max_stops constraint, no deals, budget chain with deal)
2. **Test chain normalization**: Verify "Walmart Supercentre" and "Walmart" merge correctly
3. **Test max_stops**: Verify combos are capped -- with max_stops=2, no 3-chain routes appear
4. **Test budget_affinity scoring**: Routes with Walmart/No Frills should rank higher than equivalent routes with Loblaws/Sobeys
5. **End-to-end via UI**: Run `uv run sam run configs/` -> open shopping page -> ask "Plan a route for chicken, rice, milk, eggs, bread - max 2 stores" -> verify:
   - Route has at most 2 stops
   - Deal items show sale prices
   - Non-deal items are assigned to stores with LLM reasoning
   - Map shows correct store locations
   - RouteScoreCard shows budget_affinity bar
6. **Test scenario 4 (no deals)**: Ask for items unlikely to be on sale -> LLM should recommend a single budget store
