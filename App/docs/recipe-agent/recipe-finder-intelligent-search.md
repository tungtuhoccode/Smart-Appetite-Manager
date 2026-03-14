# Recipe Finder: Intelligent Inventory-Aware Search

Last updated: 2026-03-14

## Problem Statement

Currently, `RecipeInventorySearch` calls `get_ingredient_names()` which returns a flat CSV of ALL product names (e.g., `"chicken breast,rice,tomato,onion,garlic,soy sauce,flour,sugar,milk,..."`). This entire string goes directly to Spoonacular's `includeIngredients` parameter with no filtering or prioritization.

### Issues with the Current Approach

| Issue | Impact |
|-------|--------|
| **No prioritization** | All 30-50 inventory items sent equally. Spoonacular works best with 3-8 focused ingredients. |
| **No quantity awareness** | Items with 5kg stock treated same as 0.1kg. High-stock items should be prioritized. |
| **No ingredient categorization** | Can't build balanced "protein + veg + staple" searches. May send 10 vegetables and no protein. |
| **No freshness/expiry awareness** | Chicken added 5 days ago should be used urgently; canned beans added 5 days ago are fine. No shelf-life intelligence. |
| **No intent understanding** | When user says "something quick with the chicken," system doesn't prioritize chicken over other items. |
| **API quota waste** | Unfocused searches with too many ingredients produce poor results and waste API points. |

### Current Flow

```
User: "What can I cook?"
    ↓
RecipeAssistant (router) → classifies intent → delegates to RecipeInventorySearch
    ↓
RecipeInventorySearch calls get_ingredient_names()
    → Returns: "chicken breast,rice,tomato,onion,garlic,soy sauce,flour,sugar,milk,butter,eggs,pasta,..."
    ↓
Passes ENTIRE CSV to complex_search(ingredients="chicken breast,rice,tomato,onion,garlic,soy sauce,flour,sugar,milk,butter,eggs,pasta,...")
    ↓
Spoonacular receives 30+ ingredients → unfocused results
```

## Solution: Hybrid Pre-Processing Layer

A two-part approach:
- **New Python tool** handles deterministic work: query inventory with quantities, categorize ingredients, sort by priority
- **Enhanced LLM instructions** handle non-deterministic work: understand user intent, select which ingredients best match the request, decide API strategy

### Why Hybrid?

| Approach | Pros | Cons |
|----------|------|------|
| **Pure LLM** (just rewrite instructions) | No code changes | `get_ingredient_names` returns no quantities or categories — LLM can't prioritize what it can't see |
| **Pure Python tool** (deterministic selection) | Fast, predictable | Can't understand natural language intent ("something with chicken") |
| **Hybrid** (tool + LLM) | Tool provides structured data, LLM reasons about intent | Slightly more complex, but minimal code |

### Improved Flow

```
User: "Something quick with the chicken"
    ↓
RecipeAssistant → delegates to RecipeInventorySearch with hint: "user mentioned chicken"
    ↓
RecipeInventorySearch calls get_inventory_for_recipes()
    → Returns categorized inventory with quantities + priority scores:
      {
        "use_first": [
          {"name": "chicken breast", "qty": "2.0 kg", "priority": 0.92, "reason": "Meat, 4 days old"},
          {"name": "spinach", "qty": "1.0 unit", "priority": 0.85, "reason": "Produce, 3 days old"}
        ],
        "by_category": {
          "Meat & Poultry": ["chicken breast (2.0 kg, ⚠️ use soon)", "ground beef (0.5 kg)"],
          "Produce": ["spinach (1.0 unit, ⚠️ use soon)", "tomato (3.0 unit)", "onion (5.0 unit)"],
          "Grains & Pasta": ["rice (5.0 kg)", "pasta (1.0 kg)"],
          ...
        }
      }
    ↓
LLM selects focused ingredients (Step 1.5):
    - User mentioned "chicken" → start with chicken breast (also flagged "use soon")
    - Add complementary items: spinach (use soon), onion, garlic, rice
    - Skip pantry staples (salt, oil, flour)
    - Selected: "chicken breast,spinach,onion,garlic,rice"
    ↓
complex_search(ingredients="chicken breast,spinach,onion,garlic,rice", maxReadyTime=30)
    → Focused results that also help use up perishable items
```

## Implementation Details

### 1. New Tool: `get_inventory_for_recipes()`

**Location:** `App/src/inventory_agent/inventory_manager_tools.py`

A new function alongside the existing `get_ingredient_names()`. It queries the same inventory table but returns richer, structured data.

#### Ingredient Category Map

```python
INGREDIENT_CATEGORIES = {
    "Meat & Poultry": ["chicken", "beef", "pork", "lamb", "turkey", "duck", "bacon", "sausage", "ham", "steak", "ground"],
    "Seafood": ["salmon", "shrimp", "tuna", "cod", "fish", "crab", "lobster", "prawn", "squid", "mussel"],
    "Dairy & Eggs": ["milk", "cheese", "butter", "cream", "yogurt", "egg", "sour cream", "whipping"],
    "Produce": ["tomato", "onion", "garlic", "pepper", "carrot", "potato", "lettuce", "spinach", "broccoli", "mushroom", "celery", "cucumber", "avocado", "corn", "bean", "pea", "zucchini", "eggplant", "cabbage", "kale"],
    "Fruits": ["apple", "banana", "lemon", "lime", "orange", "berry", "strawberry", "blueberry", "mango", "pineapple", "grape", "peach", "pear"],
    "Grains & Pasta": ["rice", "pasta", "noodle", "bread", "flour", "oat", "quinoa", "couscous", "tortilla", "wrap"],
    "Condiments & Sauces": ["soy sauce", "vinegar", "ketchup", "mustard", "mayo", "hot sauce", "worcestershire", "teriyaki", "salsa", "pesto"],
    "Oils & Fats": ["olive oil", "vegetable oil", "coconut oil", "sesame oil", "cooking spray"],
    "Herbs & Spices": ["salt", "pepper", "cumin", "paprika", "oregano", "basil", "thyme", "rosemary", "cinnamon", "ginger", "turmeric", "chili", "parsley", "cilantro", "dill", "bay leaf", "nutmeg"],
    "Canned & Preserved": ["canned", "tomato paste", "tomato sauce", "coconut milk", "broth", "stock"],
    "Baking": ["sugar", "baking soda", "baking powder", "vanilla", "cocoa", "chocolate", "honey", "maple syrup", "yeast"],
}
```

Categorization uses simple keyword matching — each inventory item's `product_name` is checked against keywords in each category. Items that don't match any category go under "Other".

#### Estimated Shelf Life by Category

Since the inventory has no expiration date field, we estimate freshness using the `updated_at` timestamp combined with category-aware shelf life estimates:

```python
# Estimated shelf life in days per food category
CATEGORY_SHELF_LIFE_DAYS = {
    "Meat & Poultry":       3,    # Raw meat — very perishable
    "Seafood":              2,    # Raw fish — most perishable
    "Dairy & Eggs":         7,    # Milk, cheese, eggs
    "Produce":              5,    # Fresh vegetables
    "Fruits":               5,    # Fresh fruits
    "Grains & Pasta":       180,  # Dry goods — very long shelf life
    "Condiments & Sauces":  90,   # Bottled sauces
    "Oils & Fats":          180,  # Cooking oils
    "Herbs & Spices":       365,  # Dried spices
    "Canned & Preserved":   365,  # Canned goods
    "Baking":               180,  # Sugar, flour, etc.
    "Other":                14,   # Unknown — assume moderate perishability
}
```

#### Priority Score Calculation

Each inventory item gets a **priority score** (0.0 to 1.0) that combines three factors:

```
priority = (perishability_weight × 0.50) + (quantity_weight × 0.30) + (age_weight × 0.20)
```

| Factor | Weight | How It Works |
|--------|--------|-------------|
| **Perishability** | 50% | Based on category shelf life. Meat (3 days) scores much higher than canned goods (365 days). Formula: `1.0 - min(shelf_life_days / 365, 1.0)` |
| **Quantity** | 30% | Higher quantity = higher priority (should use up stock). Normalized: `min(quantity / 10.0, 1.0)` |
| **Age** | 20% | How far through its estimated shelf life the item is. Formula: `min(days_since_update / shelf_life_days, 1.0)`. An item at 80% of its shelf life scores 0.8. |

**Examples:**

| Item | Category | Shelf Life | Days Old | Quantity | Priority | Reason |
|------|----------|-----------|----------|----------|----------|--------|
| Chicken breast | Meat & Poultry | 3 days | 2 days | 2.0 kg | **0.92** | Very perishable + 67% through shelf life |
| Spinach | Produce | 5 days | 3 days | 1.0 unit | **0.85** | Perishable + 60% through shelf life |
| Ground beef | Meat & Poultry | 3 days | 1 day | 0.5 kg | **0.76** | Very perishable but fresher |
| Tomato | Produce | 5 days | 1 day | 3.0 unit | **0.62** | Perishable but fresh, decent quantity |
| Rice | Grains & Pasta | 180 days | 10 days | 5.0 kg | **0.16** | Shelf stable, no urgency |
| Canned beans | Canned | 365 days | 30 days | 2.0 unit | **0.08** | Very shelf stable, low urgency |

Items with priority > 0.7 are flagged as **"use soon"** in the response.

#### Function Signature

```python
@logged_tool("inventory.get_inventory_for_recipes")
async def get_inventory_for_recipes(
    limit: int = 40,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return inventory items with quantities, grouped by food category, for intelligent recipe search."""
```

#### Response Format

```json
{
  "status": "success",
  "total_count": 25,
  "use_first": [
    {
      "product_name": "chicken breast",
      "quantity": 2.0,
      "quantity_unit": "kg",
      "category": "Meat & Poultry",
      "priority": 0.92,
      "days_old": 2,
      "shelf_life_days": 3,
      "reason": "Meat & Poultry — 2 of 3 days shelf life used"
    },
    {
      "product_name": "spinach",
      "quantity": 1.0,
      "quantity_unit": "unit",
      "category": "Produce",
      "priority": 0.85,
      "days_old": 3,
      "shelf_life_days": 5,
      "reason": "Produce — 3 of 5 days shelf life used"
    }
  ],
  "items": [
    {"product_name": "chicken breast", "quantity": 2.0, "quantity_unit": "kg", "category": "Meat & Poultry", "priority": 0.92, "days_old": 2},
    {"product_name": "spinach", "quantity": 1.0, "quantity_unit": "unit", "category": "Produce", "priority": 0.85, "days_old": 3},
    {"product_name": "tomato", "quantity": 3.0, "quantity_unit": "unit", "category": "Produce", "priority": 0.62, "days_old": 1},
    {"product_name": "rice", "quantity": 5.0, "quantity_unit": "kg", "category": "Grains & Pasta", "priority": 0.16, "days_old": 10},
    {"product_name": "soy sauce", "quantity": 1.0, "quantity_unit": "L", "category": "Condiments & Sauces", "priority": 0.05, "days_old": 30}
  ],
  "by_category": {
    "Meat & Poultry": ["chicken breast (2.0 kg, ⚠️ use soon)", "ground beef (0.5 kg)"],
    "Produce": ["spinach (1.0 unit, ⚠️ use soon)", "tomato (3.0 unit)", "onion (5.0 unit)", "garlic (4.0 unit)"],
    "Grains & Pasta": ["rice (5.0 kg)", "pasta (1.0 kg)"],
    "Condiments & Sauces": ["soy sauce (1.0 L)"],
    "Dairy & Eggs": ["eggs (12.0 unit)", "butter (0.5 kg)"],
    "Other": ["tofu (2.0 unit)"]
  },
  "ingredient_names_csv": "chicken breast,spinach,tomato,onion,garlic,rice,pasta,soy sauce,eggs,butter,tofu"
}
```

**Key response fields:**

| Field | Purpose |
|-------|---------|
| `use_first` | Items with priority > 0.7, sorted by priority descending. These are perishable items the LLM should prioritize in search. |
| `items` | All inventory items sorted by priority descending, with category, priority score, and days_old. |
| `by_category` | Human-readable grouping. Items flagged "⚠️ use soon" when priority > 0.7. |
| `ingredient_names_csv` | Backward-compatible flat CSV (sorted by priority, not alphabetically). |

#### Key Logic

1. Query: `SELECT product_name, quantity, quantity_unit, updated_at FROM inventory WHERE quantity > 0 ORDER BY product_name LIMIT ?`
2. For each item:
   a. Match `product_name` against `INGREDIENT_CATEGORIES` keywords → assign category
   b. Look up `CATEGORY_SHELF_LIFE_DAYS` for the assigned category
   c. Compute `days_old` from `updated_at` timestamp
   d. Compute priority score: `perishability(0.5) + quantity(0.3) + age(0.2)`
3. Sort all items by priority descending (most urgent first)
4. Build `use_first` list: items with priority > 0.7
5. Build `by_category` dict with human-readable strings, flagging "⚠️ use soon" for high-priority items
6. Build `ingredient_names_csv` sorted by priority (most urgent first)
7. No LLM calls, no API calls — just a SQLite query + Python computation (near-zero cost)

### 2. Updated Agent Instructions

**Location:** `App/configs/agents/recipe_inventory_search.yaml`

#### New Step 1.5: Ingredient Selection

Added between existing Step 1 (Get Inventory) and Step 2 (Search Recipes):

```yaml
STEP 1 — GET INVENTORY:
- If the message contains an Inventory JSON payload, extract ingredient names from it.
- Otherwise, call `get_inventory_for_recipes` to fetch the categorized pantry list with quantities.

STEP 1.5 — SELECT INGREDIENTS FOR SEARCH:
Based on the inventory and the user's request, select 5-10 KEY ingredients for the API call.
Sending too many ingredients reduces search quality.

Selection strategy:
a) START with items from `use_first` — these are perishable items that should be used soon.
   They are the highest priority for recipe search.
b) If the user MENTIONS specific ingredients (e.g., "something with chicken"),
   ensure those ingredients are included even if they aren't in `use_first`.
c) Fill remaining slots with a balanced set from `by_category`:
   - 1-2 proteins (from Meat & Poultry / Seafood)
   - 2-3 vegetables/produce
   - 1 grain/pasta/staple
   - Skip pantry staples (salt, pepper, oil, flour, sugar) — Spoonacular ignores these anyway
d) Prefer items with HIGHER priority scores (combining perishability + quantity + age).
e) Aim for 5-10 ingredients total for optimal API results.
f) When user specifies a diet (e.g., vegetarian), exclude non-matching categories
   (e.g., skip Meat & Poultry for vegetarian).

STEP 2 — SEARCH RECIPES:
(unchanged — use complex_search with filters or get_top_3_meals without)
```

### 3. Tool Registration

**Location:** `App/configs/agents/recipe_inventory_search.yaml`

Add alongside existing `get_ingredient_names` tool:

```yaml
tools:
  # Rich inventory tool (preferred for recipe search)
  - tool_type: python
    component_base_path: "src"
    component_module: "inventory_agent.inventory_manager_tools"
    function_name: "get_inventory_for_recipes"
    tool_config:
      db_path: ${INVENTORY_MANAGER_DB_NAME}

  # Keep get_ingredient_names as fallback
  - tool_type: python
    component_base_path: "src"
    component_module: "inventory_agent.inventory_manager_tools"
    function_name: "get_ingredient_names"
    tool_config:
      db_path: ${INVENTORY_MANAGER_DB_NAME}

  # ... existing recipe tools unchanged
```

### 4. RecipeAssistant Delegation Enhancement (Minor)

**Location:** `App/configs/agents/recipe_assistant.yaml`

In STEP 3 delegation section, add to the delegation message format:

```yaml
- Any specific ingredients the user mentioned in their request (e.g., "chicken", "pasta")
```

This ensures `RecipeInventorySearch` receives the user's ingredient hints for the selection step.

## Files Modified

| File | Change | Lines |
|------|--------|-------|
| `App/src/inventory_agent/inventory_manager_tools.py` | Add `INGREDIENT_CATEGORIES` dict + `get_inventory_for_recipes()` function | ~70 new lines |
| `App/configs/agents/recipe_inventory_search.yaml` | Add tool entry + update instruction with Step 1.5 | ~20 lines changed |
| `App/configs/agents/recipe_assistant.yaml` | Add ingredient hints to delegation message | ~3 lines changed |

## What Does NOT Change

- **`mealdb_tools.py`** — Spoonacular API tools remain identical (they already accept focused ingredient strings)
- **`_compute_scores()`** — Scoring logic stays the same
- **`recipe_general_search.yaml`** — General search unaffected
- **Database schema** — No new columns; categorization is done in Python at query time
- **`get_ingredient_names()`** — Kept intact for backward compatibility

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Empty inventory | `get_inventory_for_recipes` returns `total_count: 0`. LLM tells user to add items. |
| Large inventory (50+ items) | `limit` parameter caps the response. Categories ensure balanced cross-section. |
| Uncategorized items | Items that don't match any keyword go under "Other". Still available for selection. |
| User mentions ingredient NOT in inventory | LLM sees the full list and can inform user: "I don't see X in your pantry." |
| Dietary filter + inventory conflict | LLM skips incompatible categories (e.g., skip Meat for vegetarian). |

## Verification Plan

1. **Tool unit test**: Populate test DB with 20+ items across categories → verify categorization, quantity sorting, CSV output
2. **Integration tests** (start SAM, add items to inventory):
   - `"What can I cook?"` → should see focused 5-10 ingredient selection, not all items
   - `"Something with chicken"` → chicken prioritized in search
   - `"Quick vegetarian meal"` → `complex_search` with `diet=vegetarian`, only non-meat items selected
   - `"Use up the rice"` → rice prioritized, complementary items added
3. **Result quality comparison**: Same inventory, compare recipe relevance between old (flat CSV) and new (focused selection) approaches

## Spoonacular API Considerations

### Why 5-10 Ingredients is the Sweet Spot (Not a Hard Limit)

The 5-10 range is a **recommendation for optimal result quality**, not a technical API limit. Here's why:

**How Spoonacular handles `includeIngredients`:**
- `complexSearch` treats `includeIngredients` as "find recipes that use as many of these as possible"
- With 3-8 ingredients: Spoonacular finds recipes that meaningfully use your proteins, vegetables, and starches
- With 15-20 ingredients: Results start matching on trivial overlaps (salt, oil, water) and the meaningful ingredients get diluted
- With 30+ ingredients: Most recipes "match" because they share common pantry items, so the ranking becomes meaningless

**`findByIngredients` with `ranking=1` (maximize used):**
- With focused lists: Finds recipes that use your chicken + broccoli + rice together
- With large lists: Finds recipes that happen to use 8 of your 30 items, but they might be 8 random condiments rather than a coherent meal

**The real constraint is result quality, not API limits:**
- Spoonacular itself accepts any number of ingredients
- But the more you send, the less meaningful the "used vs missed" ingredient counts become
- Our scoring model (`_compute_scores`) uses `usedIngredientCount / total` for pantry coverage — this breaks down when total ingredients is very high

**Practical guidance for the LLM:**
- 5-8 ingredients: Optimal for most searches
- Up to 12-15: Acceptable when user has specific items they want to use
- 20+: Avoid — split into multiple targeted searches instead

- API quota: `complexSearch` with `fillIngredients=true` costs 1 + 0.01/result + 0.025/result. Fewer, better searches save quota.

### Optimal Search Strategy by Scenario

| User Request | API Strategy | Ingredients Sent |
|-------------|-------------|-----------------|
| "What can I cook?" (no filters) | `get_top_3_meals` → `get_meal_details_bulk` | 5-8 balanced selection |
| "Vegetarian Italian under 30min" | `complex_search` with diet/cuisine/time | 5-8 non-meat items |
| "Something with chicken" | `complex_search` with query hint | chicken + 4-6 complementary |
| "Use up the rice and beans" | `complex_search` or `get_top_3_meals` | rice, beans + 3-5 complementary |
