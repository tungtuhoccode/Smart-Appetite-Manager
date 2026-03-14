# General Recipe Search Scenarios: Discovery Use Cases

Last updated: 2026-03-14

20 scenarios for the `RecipeGeneralSearch` agent — covering recipe discovery without inventory dependency.
This agent handles: dish search, cuisine/diet filtering, random exploration, recipe details, ingredient substitutes, and unit conversions.

**Available tools:** `complex_search`, `get_top_3_meals`, `search_meals`, `get_meal_details`, `get_meal_details_bulk`, `get_random_meal`, `get_substitutes`, `convert_amounts`, `parse_ingredients`

---

## Tier 1: Simple Dish Search

### Scenario 1: Search by dish name

- **User says:** "How do I make spaghetti carbonara?"
- **No inventory involved.**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: user wants a specific dish — "spaghetti carbonara." No filters needed, just a direct query |
| 2 | **API** | Single call: `complex_search(query="spaghetti carbonara", number=5, addRecipeInformation=true)` |
| 3 | **LLM** | Returns top 5 results. Since user asked "how do I make," includes full instructions from the `complex_search` response (already includes recipe info) |

**Key test:** Direct dish name maps to `query` parameter. No unnecessary filters added.

---

### Scenario 2: Search by broad food category

- **User says:** "Show me some pasta recipes"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: broad category search — "pasta." No specific dish, diet, or cuisine |
| 2 | **API** | Single call: `complex_search(query="pasta", number=6)` |
| 3 | **LLM** | Returns top 5 with variety (different pasta types — penne, spaghetti, lasagna, etc.) |

**Key test:** Broad queries return diverse results, not 5 variations of the same dish.

---

### Scenario 3: Search by specific ingredient (no inventory)

- **User says:** "Recipes with sweet potato"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: ingredient-focused search, not inventory-based. User is exploring, not cooking from pantry |
| 2 | **API** | Single call: `complex_search(query="sweet potato", ingredients="sweet potato", number=6)` — uses both `query` and `ingredients` to maximize relevance |
| 3 | **LLM** | Returns top 5 recipes featuring sweet potato prominently |

**Key test:** Ingredient-based discovery (no inventory) routes here, not to RecipeInventorySearch.

---

### Scenario 4: Search by multiple ingredients (no inventory)

- **User says:** "What can I make with shrimp and avocado?"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: user provided specific ingredients to explore. Not referencing "my pantry" — this is general discovery |
| 2 | **API** | Single call: `get_top_3_meals(ingredients="shrimp,avocado", number=6)` |
| 3 | **API** | `get_meal_details_bulk(meal_ids="id1,id2,id3,id4,id5,id6")` to fetch full details in one call |
| 4 | **LLM** | Returns top 5 with full ingredients and instructions |

**Two API calls** — `get_top_3_meals` for search, then `get_meal_details_bulk` for details (since `get_top_3_meals` doesn't include instructions).

**Key test:** Multiple ingredients without inventory context uses `get_top_3_meals` → `get_meal_details_bulk` pipeline.

---

## Tier 2: Filtered Search (Diet, Cuisine, Time)

### Scenario 5: Diet filter only

- **User says:** "Vegetarian dinner ideas"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses: `diet=vegetarian`, `type=main course` (inferred from "dinner"). No cuisine or time constraint |
| 2 | **API** | Single call: `complex_search(query="dinner", diet="vegetarian", type="main course", number=6)` |
| 3 | **LLM** | Returns top 5 vegetarian main course recipes |

**Key test:** "Dinner" maps to meal type filter, not just a query keyword.

---

### Scenario 6: Cuisine filter only

- **User says:** "Thai food recipes"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses: `cuisine=thai`. No diet or time constraint |
| 2 | **API** | Single call: `complex_search(cuisine="thai", number=6)` |
| 3 | **LLM** | Returns top 5 Thai recipes with variety (curry, pad thai, soup, salad, stir-fry) |

**Key test:** Cuisine maps directly to Spoonacular's `cuisine` parameter.

---

### Scenario 7: Time constraint only

- **User says:** "Quick meals under 15 minutes"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses: `maxReadyTime=15`. No diet or cuisine. "meals" → `type=main course` |
| 2 | **API** | Single call: `complex_search(query="quick meal", maxReadyTime=15, type="main course", number=6)` |
| 3 | **LLM** | Returns top 5 fast recipes. Highlights prep time in each result |

**Key test:** Time constraint extracted from natural language and passed as API filter.

---

### Scenario 8: Combined filters

- **User says:** "Gluten-free Mexican appetizers"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses three constraints: `diet=gluten free`, `cuisine=mexican`, `type=appetizer` |
| 2 | **API** | Single call: `complex_search(cuisine="mexican", diet="gluten free", type="appetizer", number=6)` |
| 3 | **LLM** | Returns top 5 matching all three filters |

**Key test:** Three different filter types stack correctly in one API call.

---

### Scenario 9: Intolerance filter

- **User says:** "Desserts without nuts or dairy"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses: `type=dessert`, `intolerances=tree nut,peanut,dairy`. Maps "nuts" to both tree nut and peanut intolerances |
| 2 | **API** | Single call: `complex_search(query="dessert", type="dessert", intolerances="tree nut,peanut,dairy", number=6)` |
| 3 | **LLM** | Returns top 5 nut-free and dairy-free desserts |

**Key test:** "Without nuts" maps to multiple intolerance values (tree nut + peanut). Combined with dairy.

---

### Scenario 10: Nutritional constraints

- **User says:** "High protein low carb meals"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses nutritional intent: "high protein" → `minProtein=30`, "low carb" → `maxCarbs=20`. These are reasonable defaults the LLM chooses |
| 2 | **API** | Single call: `complex_search(query="high protein low carb", minProtein=30, maxCarbs=20, type="main course", number=6)` |
| 3 | **LLM** | Returns top 5. Highlights protein/carb content per serving for each recipe |

**Key test:** LLM translates qualitative nutritional language ("high," "low") into quantitative API parameters.

---

## Tier 3: Random & Exploratory

### Scenario 11: Random inspiration

- **User says:** "Surprise me"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: user wants random inspiration. No constraints at all |
| 2 | **API** | Single call: `get_random_meal()` |
| 3 | **LLM** | Returns 1 random recipe with full details, image, and instructions. Adds: "Want another one, or something more specific?" |

**Key test:** "Surprise me" routes directly to `get_random_meal`, not `complex_search`.

---

### Scenario 12: Random with a constraint

- **User says:** "Surprise me with something vegan"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses: random + `diet=vegan`. Can't use `get_random_meal` (no diet filter). Uses `complex_search` with random sort instead |
| 2 | **API** | Single call: `complex_search(diet="vegan", sort="random", number=3)` |
| 3 | **LLM** | Returns top result as the "surprise." Keeps 2 more as backup: "Here's your surprise! I also found 2 more if you want alternatives." |

**Key test:** Random + filter = `complex_search` with `sort=random`, not `get_random_meal`.

---

### Scenario 13: Meal type exploration

- **User says:** "Breakfast ideas"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses: `type=breakfast`. No other constraints |
| 2 | **API** | Single call: `complex_search(type="breakfast", number=6)` |
| 3 | **LLM** | Returns top 5 diverse breakfast recipes (eggs, pancakes, smoothie, oatmeal, toast) |

**Key test:** Meal type extracted and used as filter. Results show variety within the type.

---

## Tier 4: Recipe Details & Follow-up

### Scenario 14: User picks a recipe from results

- **User says:** "Show me the details for recipe #3" (or "Tell me more about the pasta one")
- **Context:** Previous response showed 5 recipes, #3 has ID 716429

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: user wants details for a specific recipe. Resolves "#3" to meal ID 716429 from conversation context |
| 2 | **API** | Single call: `get_meal_details(meal_id="716429")` |
| 3 | **LLM** | Returns full recipe: complete ingredient list with measurements, step-by-step instructions, prep/cook time, servings, dietary tags, source URL |

**Key test:** LLM resolves reference ("#3", "the pasta one") to a concrete meal ID from session context.

---

### Scenario 15: User asks for a recipe by name (not from results)

- **User says:** "How do I make beef Wellington?"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: specific dish request. User wants full recipe, not a list of options |
| 2 | **API** | **Call 1:** `complex_search(query="beef wellington", number=1)` — find the best match |
| 3 | **API** | **Call 2:** `get_meal_details(meal_id="<id from call 1>")` — get full instructions and analyzed steps |
| 4 | **LLM** | Returns the single recipe with complete instructions, ingredient list, and step-by-step breakdown |

**Two API calls** — search to find ID, then details for full instructions with analyzed steps.

**Key test:** "How do I make X" intent gets a single detailed recipe, not a list of 5 options.

---

### Scenario 16: User wants to compare options

- **User says:** "Show me 3 different ways to make chicken parmesan"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: user wants multiple VARIATIONS of the same dish, not just search results. Wants to compare approaches |
| 2 | **API** | **Call 1:** `complex_search(query="chicken parmesan", number=5)` — get a pool of options |
| 3 | **LLM** | Selects 3 that are genuinely different (e.g., classic fried, baked/healthier, air fryer). Skips near-duplicates |
| 4 | **API** | **Call 2:** `get_meal_details_bulk(meal_ids="id1,id2,id3")` — get full details for comparison |
| 5 | **LLM** | Presents 3 recipes side-by-side highlighting differences: "Classic (45 min, fried), Healthy Baked (30 min, oven), Air Fryer (25 min, crispy)" |

**Two API calls** — search for pool, then bulk details for the selected 3.

**Key test:** LLM filters for genuine variety, not 3 nearly identical recipes.

---

## Tier 5: Ingredient Intelligence

### Scenario 17: Ingredient substitute

- **User says:** "Can I swap butter for something dairy-free?"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: ingredient substitute request. Target ingredient: "butter." Additional context: "dairy-free" |
| 2 | **API** | Single call: `get_substitutes(ingredient_name="butter")` |
| 3 | **LLM** | Receives list of substitutes. Filters/highlights dairy-free options (coconut oil, margarine, vegetable oil). Deprioritizes dairy substitutes (ghee). Returns: "For dairy-free, you can replace 1 cup butter with: 7/8 cup coconut oil, 1 cup margarine, or 7/8 cup vegetable oil." |

**No `recipe_data` block needed** — this is a conversational response.

**Key test:** LLM applies the user's additional context ("dairy-free") to filter the substitute list.

---

### Scenario 18: Unit conversion

- **User says:** "How many grams is 2 cups of flour?"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: unit conversion. Ingredient: "flour", source: 2 cups, target: grams |
| 2 | **API** | Single call: `convert_amounts(ingredient_name="flour", source_amount=2, source_unit="cups", target_unit="grams")` |
| 3 | **LLM** | Returns: "2 cups of flour is approximately 250 grams." Uses the `answer` field from API response |

**No `recipe_data` block needed.**

**Key test:** Natural language unit conversion maps to correct API parameters.

---

### Scenario 19: Parse free-text ingredients

- **User says:** "I have 2 cups flour, 3 large eggs, 1 cup sugar, and a stick of butter. What can I make?"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses intent: user provided free-text ingredients AND wants recipes. Two-step: parse first, then search |
| 2 | **API** | **Call 1:** `parse_ingredients(ingredient_list="2 cups flour\n3 large eggs\n1 cup sugar\n1 stick butter", servings=1)` |
| 3 | **LLM** | Receives structured data: flour (250g), eggs (3), sugar (200g), butter (113g). Recognizes this is a baking set |
| 4 | **API** | **Call 2:** `complex_search(query="baking", ingredients="flour,eggs,sugar,butter", type="dessert", number=6)` |
| 5 | **LLM** | Returns top 5 baking recipes (cake, cookies, muffins, brownies, pancakes) |

**Two API calls** — parse for structure, then search with parsed ingredient names.

**Key test:** Free-text ingredient parsing feeds into recipe search. LLM infers category ("baking") from the parsed ingredients.

---

## Tier 6: Complex & Edge Cases

### Scenario 20: Zero results — broadening search

- **User says:** "Vegan keto Thai desserts under 10 minutes"

| Step | Layer | Action |
|------|-------|--------|
| 1 | **LLM** | Parses: `diet=vegan`, very low carb (keto), `cuisine=thai`, `type=dessert`, `maxReadyTime=10`. Recognizes this is extremely restrictive |
| 2 | **API** | **Call 1:** `complex_search(diet="vegan", cuisine="thai", type="dessert", maxReadyTime=10, maxCarbs=10, number=5)` |
| 3 | **LLM** | Gets 0 results. Begins broadening strategy |
| 4 | **LLM** | Drops the most restrictive filter first — removes `maxReadyTime`. Keeps diet + cuisine + type |
| 5 | **API** | **Call 2:** `complex_search(diet="vegan", cuisine="thai", type="dessert", maxCarbs=10, number=5)` |
| 6 | **LLM** | Still 0 results. Drops cuisine (broadest remaining filter) |
| 7 | **API** | **Call 3:** `complex_search(diet="vegan", type="dessert", maxCarbs=10, number=5)` |
| 8 | **LLM** | Gets 3 results. Returns them with transparency: "I couldn't find vegan keto Thai desserts under 10 minutes. I broadened the search to vegan low-carb desserts (any cuisine, any prep time). Here are 3 options:" |

**Up to 3 API calls** — progressive broadening. Each step drops the least important filter.

**Broadening order:** time → cuisine → diet → type (diet and type are dropped last since they're usually the core intent).

**Key test:** System doesn't just say "no results found." Progressively relaxes filters and tells the user what was relaxed.

---

## Summary: Tool Selection by Intent

### Which tool for which intent?

| User Intent | Primary Tool | Follow-up Tool | Example |
|------------|-------------|----------------|---------|
| Specific dish name | `complex_search(query=)` | — | "How to make pad thai" |
| Broad food category | `complex_search(query=)` | — | "Pasta recipes" |
| Ingredient-based (no inventory) | `get_top_3_meals(ingredients=)` | `get_meal_details_bulk` | "Recipes with shrimp" |
| Diet/cuisine/time filters | `complex_search(diet=, cuisine=, maxReadyTime=)` | — | "Vegetarian Italian under 30min" |
| Intolerance filter | `complex_search(intolerances=)` | — | "Desserts without nuts" |
| Nutritional constraints | `complex_search(minProtein=, maxCarbs=)` | — | "High protein low carb" |
| Random inspiration | `get_random_meal()` | — | "Surprise me" |
| Random + filter | `complex_search(sort="random")` | — | "Surprise me with vegan" |
| Meal type exploration | `complex_search(type=)` | — | "Breakfast ideas" |
| Recipe details (by ID) | `get_meal_details(meal_id=)` | — | "Show recipe #3" |
| Specific dish (full recipe) | `complex_search(query=, number=1)` | `get_meal_details` | "How do I make beef Wellington" |
| Compare variations | `complex_search(query=)` | `get_meal_details_bulk` | "3 ways to make chicken parm" |
| Ingredient substitute | `get_substitutes(ingredient_name=)` | — | "Can I swap butter?" |
| Unit conversion | `convert_amounts(...)` | — | "How many grams in 2 cups flour" |
| Free-text ingredients + search | `parse_ingredients(...)` | `complex_search` | "I have 2 cups flour, 3 eggs..." |
| Zero results | `complex_search` (retry with fewer filters) | — | "Vegan keto Thai desserts" |

### How many API calls per scenario?

| Calls | Scenarios | Pattern |
|-------|-----------|---------|
| 1 | S1, S2, S3, S5, S6, S7, S8, S9, S10, S11, S13, S14, S17, S18 | Simple search or single tool |
| 2 | S4, S15, S16, S19 | Search → details, or parse → search |
| 1-3 | S12, S20 | Random+filter, or progressive broadening |

---

## Scenario Coverage Matrix

| # | Intent Type | Filters | Tool Used | API Calls | Complexity |
|---|------------|---------|-----------|-----------|------------|
| 1 | Dish name | None | `complex_search` | 1 | Simple |
| 2 | Broad category | None | `complex_search` | 1 | Simple |
| 3 | Single ingredient | None | `complex_search` | 1 | Simple |
| 4 | Multiple ingredients | None | `get_top_3_meals` + `details_bulk` | 2 | Simple |
| 5 | Discovery | Diet | `complex_search` | 1 | Medium |
| 6 | Discovery | Cuisine | `complex_search` | 1 | Medium |
| 7 | Discovery | Time | `complex_search` | 1 | Medium |
| 8 | Discovery | Diet+Cuisine+Type | `complex_search` | 1 | Medium |
| 9 | Discovery | Intolerances | `complex_search` | 1 | Medium |
| 10 | Discovery | Nutritional | `complex_search` | 1 | Medium |
| 11 | Random | None | `get_random_meal` | 1 | Simple |
| 12 | Random | Diet | `complex_search(sort=random)` | 1 | Medium |
| 13 | Meal type | Type | `complex_search` | 1 | Simple |
| 14 | Details (from results) | None | `get_meal_details` | 1 | Simple |
| 15 | Details (by name) | None | `complex_search` + `get_meal_details` | 2 | Medium |
| 16 | Compare variations | None | `complex_search` + `details_bulk` | 2 | Medium |
| 17 | Substitute | None | `get_substitutes` | 1 | Simple |
| 18 | Unit conversion | None | `convert_amounts` | 1 | Simple |
| 19 | Parse + search | None | `parse_ingredients` + `complex_search` | 2 | Medium |
| 20 | Over-filtered | Many | `complex_search` (retry loop) | 1-3 | Complex |

## Key Differences from Inventory Search

| Aspect | General Search | Inventory Search |
|--------|---------------|-----------------|
| Inventory access | None | `get_inventory_for_recipes()` tool |
| Ingredient source | User provides, or none | Pantry database |
| Priority scoring | No freshness/urgency | Perishability + quantity + age |
| Ingredient selection | Pass through what user says | LLM selects 5-10 from 40+ |
| Typical API calls | 1 | 1-3 |
| Main complexity | Filter mapping, zero-result recovery | Ingredient prioritization, multi-search |
| `recipe_data` block | Required for recipe results | Required for recipe results |
| Conversational responses | Substitutes, conversions (no `recipe_data`) | Never (always returns recipes) |
