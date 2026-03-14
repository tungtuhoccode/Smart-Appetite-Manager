# Recipe Search Scenarios: Inventory-Based Use Cases

Last updated: 2026-03-14

20 scenarios covering the full range of inventory-based recipe search, from simple to complex.
Each scenario details the step-by-step handling across layers: **Tool** (Python), **LLM** (agent reasoning), and **API** (Spoonacular calls).

---

## Tier 1: Basic (No Filters, No Intent Parsing)

### Scenario 1: Small inventory, no preferences

- **User says:** "What can I cook?"
- **Inventory:** 5 items (chicken, rice, onion, garlic, soy sauce)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 5 items with categories and priority scores |
| 2 | **LLM** | Sees only 5 items — no selection needed, all are usable. No filters detected in user message |
| 3 | **API** | Single call: `get_top_3_meals(ingredients="chicken,rice,onion,garlic,soy sauce")` |
| 4 | **Tool** | `_compute_scores()` ranks results by pantry coverage (45%), prep time (20%), etc. |
| 5 | **LLM** | Returns top 5 results sorted by score with `recipe_data` block |

**Key test:** System passes through small inventories without unnecessary filtering.

---

### Scenario 2: Medium inventory, no preferences

- **User says:** "Show me recipes"
- **Inventory:** 15 items across 4 categories (3 meats, 5 vegetables, 4 grains, 3 condiments)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 15 items grouped by category with priority scores. `use_first` may flag 2-3 perishable items |
| 2 | **LLM** | No user intent to parse. Selects balanced set: 1 protein + 3 vegetables + 1 grain = 5-7 items. Skips condiments (salt, soy sauce — Spoonacular ignores pantry staples). Prioritizes any `use_first` items |
| 3 | **API** | Single call: `get_top_3_meals(ingredients="chicken,broccoli,carrot,onion,rice", number=6)` |
| 4 | **Tool** | `_compute_scores()` ranks by pantry coverage + prep time |
| 5 | **LLM** | Returns top 5 sorted by score |

**Key test:** Ingredient selection kicks in — results are better than dumping all 15.

---

### Scenario 3: Large inventory, no preferences

- **User says:** "What should I make for dinner?"
- **Inventory:** 40+ items across all categories

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes(limit=40)` returns items with priorities. `use_first` flags 4-5 perishable items (chicken 2 days old, spinach 3 days old, etc.) |
| 2 | **LLM** | Starts with `use_first` items (chicken, spinach). Adds complementary items for balance: 1 more protein, 2 more vegetables, 1 grain. Total: 7-8 ingredients. Skips all pantry staples and shelf-stable items |
| 3 | **API** | Single call: `complex_search(ingredients="chicken,spinach,bell pepper,tomato,onion,rice,garlic", number=6)` with `addRecipeInformation=true` |
| 4 | **Tool** | `_compute_scores()` ranks results. Perishable items that appear in "used" get a natural boost via pantry_coverage |
| 5 | **LLM** | Returns top 5. Notes: "These recipes help use up your chicken and spinach, which should be used soon." |

**Key test:** System doesn't dump 40 ingredients. Priority scoring drives selection toward perishables.

---

### Scenario 4: Empty inventory

- **User says:** "What can I cook?"
- **Inventory:** 0 items (or all quantities = 0)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns `{"status": "success", "total_count": 0, "use_first": [], "items": []}` |
| 2 | **LLM** | Detects empty inventory. Does NOT call any API |
| 3 | **LLM** | Responds: "Your pantry is empty! Add some items to your inventory first, and I'll find recipes you can cook with them." |

**No API call.** No quota wasted.

**Key test:** Graceful handling — no API call, helpful message.

---

## Tier 2: User Mentions Specific Ingredients

### Scenario 5: Single ingredient hint

- **User says:** "Something with chicken"
- **Inventory:** 20 items including chicken breast (2kg)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 20 items categorized with priorities |
| 2 | **LLM** | Parses user intent: user wants "chicken." Finds "chicken breast" in inventory (confirmed available). Locks chicken as primary ingredient. Selects 4-5 complementary items from other categories: onion, garlic, rice, bell pepper. Skips unrelated items (chocolate, canned beans) |
| 3 | **API** | Single call: `complex_search(query="chicken", ingredients="chicken breast,onion,garlic,rice,bell pepper", number=6)` |
| 4 | **Tool** | `_compute_scores()` ranks results with chicken as a pantry ingredient |
| 5 | **LLM** | Returns top 5, all featuring chicken prominently |

**Key test:** User's mentioned ingredient is always included, even if its priority score isn't the highest.

---

### Scenario 6: Multiple ingredient hints

- **User says:** "I want to use the rice and beans"
- **Inventory:** 25 items including rice (5kg) and black beans (2 cans)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 25 items. Rice in "Grains & Pasta", beans in "Canned & Preserved" |
| 2 | **LLM** | Parses intent: user wants rice AND beans. Both confirmed in inventory. Locks both. Selects 4-5 complementary items: onion, tomato, garlic, bell pepper, cumin (if available). Aims for rice-and-bean type dishes |
| 3 | **API** | Single call: `complex_search(ingredients="rice,black beans,onion,tomato,garlic,bell pepper,cumin", number=6)` |
| 4 | **Tool** | `_compute_scores()` — recipes using both rice and beans score highest on pantry coverage |
| 5 | **LLM** | Returns top 5. Rice and beans appear in most/all results |

**Key test:** Both user-specified items are included. Complementary items are coherent (not random).

---

### Scenario 7: User mentions ingredient NOT in inventory

- **User says:** "Make something with salmon"
- **Inventory:** 20 items, no salmon. Has chicken breast and ground beef.

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 20 items. No salmon found |
| 2 | **LLM** | Parses intent: user wants salmon. Scans inventory items — no match for "salmon" in any category. Detects mismatch |
| 3 | **LLM** | Responds with two options: "I don't see salmon in your pantry. Would you like me to: **A)** Search for salmon recipes anyway? I can pair it with items you DO have (rice, lemon, garlic, asparagus). **B)** Search with a protein you have instead? You have chicken breast (2kg) and ground beef (0.5kg)." |

**Branch A — User says "yes, search for salmon anyway":**

| Step | Layer | Action |
|------|-------|--------|
| 4a | **LLM** | Selects salmon as primary (not in inventory). Picks complementary items FROM inventory: rice, lemon, garlic, asparagus, onion |
| 5a | **API** | Single call: `complex_search(query="salmon", ingredients="rice,lemon,garlic,asparagus,onion", number=6)` |
| 6a | **Tool** | `_compute_scores()` — salmon will appear in `missedIngredients`, pantry coverage will be lower but complementary items match |
| 7a | **LLM** | Returns top 5. Notes: "Salmon is not in your pantry — you'll need to buy it. But these recipes use your existing rice, lemon, and garlic." |

**Branch B — User says "use chicken instead":**

| Step | Layer | Action |
|------|-------|--------|
| 4b | **LLM** | Switches to chicken breast as primary. Selects complementary items from inventory |
| 5b | **API** | Single call: `complex_search(ingredients="chicken breast,rice,garlic,onion,bell pepper", number=6)` |
| 6b | **Tool** | `_compute_scores()` — higher pantry coverage since chicken is in inventory |
| 7b | **LLM** | Returns top 5 chicken recipes |

**Key test:** System doesn't silently ignore the mismatch. Offers clear fork in the road. Both branches produce focused results.

---

### Scenario 8: User mentions ingredient with partial name match

- **User says:** "Use the chicken"
- **Inventory:** Has "chicken breast" (2kg, 2 days old) and "chicken thighs" (1kg, 1 day old)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns both: chicken breast (priority 0.88) and chicken thighs (priority 0.72) |
| 2 | **LLM** | Parses intent: user said "chicken." Fuzzy matches against inventory — finds both "chicken breast" and "chicken thighs." Notes chicken breast has higher priority (older, more stock) |
| 3 | **LLM** | Creates **two separate ingredient sets** to get diverse results: Set A = chicken breast + complementary items. Set B = chicken thighs + complementary items |
| 4 | **API** | **Call 1:** `complex_search(ingredients="chicken breast,onion,garlic,rice,tomato,bell pepper", number=6)` |
| 5 | **API** | **Call 2:** `complex_search(ingredients="chicken thighs,potato,garlic,rosemary,lemon", number=6)` |
| 6 | **Tool** | `_compute_scores()` scores all 12 results from both calls against the full pantry |
| 7 | **LLM** | Merges both result sets. Deduplicates (same recipe may appear in both). Sorts by final_score. Returns top 5 across both chicken types. Notes which recipes use breast vs thighs |

**Two API calls → merged and re-ranked for best top 5.**

**Key test:** Partial matching finds both variants. Two searches give variety. Final ranking picks the best across both.

---

## Tier 3: Dietary & Cuisine Filters

### Scenario 9: Diet filter with compatible inventory

- **User says:** "Vegetarian recipes please"
- **Inventory:** 30 items including tofu, vegetables, rice, pasta, cheese, eggs, plus chicken and beef

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 30 items across all categories |
| 2 | **LLM** | Parses intent: `diet=vegetarian`. Filters out "Meat & Poultry" and "Seafood" categories from selection pool entirely. Remaining pool: tofu, 8 vegetables, rice, pasta, cheese, eggs. Selects 7-8 balanced items: tofu, broccoli, bell pepper, onion, garlic, pasta, cheese, eggs |
| 3 | **API** | Single call: `complex_search(ingredients="tofu,broccoli,bell pepper,onion,garlic,pasta,cheese", diet="vegetarian", number=6)` |
| 4 | **Tool** | `_compute_scores()` with `user_diet="vegetarian"` — preference_match_score rewards vegetarian-tagged recipes |
| 5 | **LLM** | Returns top 5 vegetarian recipes |

**Key test:** Meat items excluded from ingredient selection BEFORE API call, not just filtered in results.

---

### Scenario 10: Diet filter with mostly incompatible inventory

- **User says:** "Vegan meal"
- **Inventory:** 20 items, mostly meat and dairy. Only 4 vegan-compatible: rice, tomato, onion, olive oil

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 20 items |
| 2 | **LLM** | Parses intent: `diet=vegan`. Filters out Meat & Poultry, Seafood, Dairy & Eggs. Only 4 items remain: rice, tomato, onion, olive oil |
| 3 | **LLM** | Notes thin selection. Warns user: "Only 4 of your pantry items are vegan-compatible (rice, tomato, onion, olive oil). I'll search with these — recipes will likely need a few extra items from the store." |
| 4 | **API** | Single call: `complex_search(ingredients="rice,tomato,onion,olive oil", diet="vegan", number=6)` |
| 5 | **Tool** | `_compute_scores()` — lower pantry coverage expected, but preference_match_score high for vegan matches |
| 6 | **LLM** | Returns top 5. Each recipe shows missing ingredients clearly. Offers: "Want me to find deals on the missing ingredients?" |

**Key test:** System doesn't fail with thin compatible inventory. Warns user proactively before searching.

---

### Scenario 11: Cuisine preference

- **User says:** "Something Italian"
- **Inventory:** 25 items including pasta, tomato, garlic, basil, olive oil, chicken, cheese, plus unrelated items (soy sauce, rice, ginger)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 25 items categorized by food type |
| 2 | **LLM** | Parses intent: `cuisine=italian`. This is where the LLM adds real value — it understands cuisine-ingredient affinity. Prioritizes: pasta, tomato, garlic, basil, olive oil, chicken, cheese. Deprioritizes Asian ingredients (soy sauce, ginger, rice — less relevant to Italian). Selects 7 items |
| 3 | **API** | Single call: `complex_search(ingredients="pasta,tomato,garlic,basil,olive oil,chicken,cheese", cuisine="italian", number=6)` |
| 4 | **Tool** | `_compute_scores()` with `user_cuisine="italian"` — preference_match_score rewards Italian-tagged recipes |
| 5 | **LLM** | Returns top 5 Italian recipes |

**Key test:** LLM does cuisine-aware ingredient selection. No Python tool can map "Italian" to "prioritize pasta over rice" — this is pure LLM reasoning.

---

### Scenario 12: Combined diet + cuisine + time

- **User says:** "Quick vegetarian Asian under 20 minutes"
- **Inventory:** 30 items across all categories

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 30 items |
| 2 | **LLM** | Parses three constraints: `diet=vegetarian`, `cuisine=asian`, `maxReadyTime=20`. First filter: remove Meat & Poultry, Seafood (vegetarian). Then prioritize Asian-compatible items: tofu, soy sauce, rice, noodles, ginger, garlic, bok choy, sesame oil. Selects 7-8 items that satisfy both constraints |
| 3 | **API** | Single call: `complex_search(ingredients="tofu,soy sauce,rice,noodles,ginger,garlic,bok choy", diet="vegetarian", cuisine="asian", maxReadyTime=20, number=6)` |
| 4 | **Tool** | `_compute_scores()` with all three user preferences — recipes matching all three score highest |
| 5 | **LLM** | Returns top 5. All vegetarian, Asian-inspired, under 20 minutes |

**Key test:** Three filters stack correctly without conflicting. Ingredient selection respects ALL constraints simultaneously.

---

## Tier 4: Freshness & Priority-Driven

### Scenario 13: Perishable items need attention

- **User says:** "What can I cook?"
- **Inventory:** chicken breast (added 2 days ago), spinach (3 days ago), rice (2 weeks ago), canned tomatoes (1 month ago)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` computes priorities. Chicken breast: 0.92 (Meat, 2/3 days used). Spinach: 0.85 (Produce, 3/5 days used). Rice: 0.16 (Grains, 14/180 days). Canned tomatoes: 0.08 (Canned, 30/365 days). `use_first`: [chicken breast, spinach] |
| 2 | **LLM** | Sees `use_first` has chicken + spinach. Locks both as primary ingredients. Adds complementary items: garlic, onion, rice. Total: 5 items |
| 3 | **API** | Single call: `complex_search(ingredients="chicken breast,spinach,garlic,onion,rice", number=6)` |
| 4 | **Tool** | `_compute_scores()` — recipes using both chicken AND spinach get highest pantry coverage |
| 5 | **LLM** | Returns top 5. Notes: "These recipes prioritize your chicken breast and spinach, which should be used in the next 1-2 days." |

**Key test:** Priority scoring correctly surfaces perishable items. LLM communicates urgency to user.

---

### Scenario 14: Everything is fresh

- **User says:** "What should I make?"
- **Inventory:** 15 items all added today (just went grocery shopping)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` computes priorities. All items have 0 days old. Priority driven mainly by perishability weight (meat still scores higher than canned goods by nature). `use_first`: likely empty or just meats (inherently perishable) |
| 2 | **LLM** | No strong urgency signals. Falls back to balanced-category selection: 1 protein, 2-3 vegetables, 1 grain. Picks by quantity (higher stock first) |
| 3 | **API** | Single call: `get_top_3_meals(ingredients="chicken,broccoli,tomato,onion,rice", number=6)` |
| 4 | **Tool** | `_compute_scores()` — standard scoring, no urgency bonus |
| 5 | **LLM** | Returns top 5. No freshness warnings needed |

**Key test:** System works normally when nothing is urgent. Doesn't generate false urgency.

---

### Scenario 15: Items past estimated shelf life

- **User says:** "Suggest a meal"
- **Inventory:** ground beef (added 5 days ago, shelf life: 3 days), milk (10 days ago, shelf life: 7 days), rice (3 months ago, shelf life: 180 days)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` computes priorities. Ground beef: age/shelf = 5/3 = 167%. Milk: 10/7 = 143%. Both flagged with `past_shelf_life: true`. Rice: 90/180 = 50% (fine) |
| 2 | **LLM** | Sees `past_shelf_life` flags on ground beef and milk. Does NOT silently include them in search |
| 3 | **LLM** | Warns user first: "Your ground beef (added 5 days ago) and milk (added 10 days ago) may have expired based on typical shelf life. Please check them before cooking." |
| 4 | **LLM** | Excludes potentially expired items from search. Selects from remaining safe items: rice + other available items |
| 5 | **API** | Single call: `complex_search(ingredients="rice,...other safe items...", number=6)` |
| 6 | **LLM** | Returns top 5 with the expiry warning at the top of the response |

**Key test:** System warns about potentially expired items. Doesn't blindly suggest cooking with potentially bad food.

---

### Scenario 16: User explicitly says "use up old stuff"

- **User says:** "I need to use up what's about to expire"
- **Inventory:** 25 items with mixed ages

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns all items with priority scores. `use_first` has 5 items: chicken (0.92), spinach (0.85), ground beef (0.78), mushrooms (0.71), milk (0.75) |
| 2 | **LLM** | Parses intent: user EXPLICITLY wants to use old items. Overrides balanced-category selection. Groups `use_first` items by protein type to plan searches: Group A = chicken + spinach + mushrooms. Group B = ground beef + mushrooms. Skips milk (hard to build a main dish around, but notes it for user) |
| 3 | **API** | **Call 1:** `complex_search(ingredients="chicken,spinach,mushrooms,garlic,onion", number=6)` — chicken-focused |
| 4 | **API** | **Call 2:** `complex_search(ingredients="ground beef,mushrooms,onion,garlic,tomato", number=6)` — beef-focused |
| 5 | **Tool** | `_compute_scores()` on all 12 results. Recipes using MORE `use_first` items get a natural boost via pantry_coverage |
| 6 | **LLM** | Merges both sets. Deduplicates. Sorts by score. Returns top 5. Notes which perishable items each recipe helps use: "Recipe 1 uses your chicken AND spinach. Recipe 3 uses your ground beef AND mushrooms. You also have milk expiring soon — consider using it in a smoothie or sauce." |

**Two API calls** because `use_first` spans different protein groups — one search can't optimally cover both chicken and beef dishes.

**Key test:** User intent ("use old stuff") overrides balanced selection. Multiple searches cover different protein bases. Leftover perishables (milk) still get mentioned.

---

## Tier 5: Complex & Edge Cases

### Scenario 17: Inventory with duplicate/similar items

- **User says:** "What can I cook?"
- **Inventory:** "tomato" (3 units, Produce), "cherry tomato" (1 unit, Produce), "tomato paste" (2 cans, Canned), "tomato sauce" (1 can, Canned)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns all 4 as separate items. "tomato" and "cherry tomato" → Produce category. "tomato paste" and "tomato sauce" → Canned & Preserved category. Different categories, different priorities |
| 2 | **LLM** | Recognizes these are related but distinct. For search purposes, doesn't need all 4 — they're all tomato variants and would waste ingredient slots. Picks the most versatile: "tomato" (fresh, highest quantity). May add "tomato paste" if there's room (useful for saucy recipes). Sends at most 2 of the 4 |
| 3 | **LLM** | Fills remaining slots with non-tomato items for variety: protein, other vegetables, grains |
| 4 | **API** | Single call: `complex_search(ingredients="tomato,chicken,onion,garlic,pasta,tomato paste", number=6)` |
| 5 | **Tool** | `_compute_scores()` — standard scoring |
| 6 | **LLM** | Returns top 5. Doesn't waste ingredient slots on 4 tomato variants |

**Key test:** LLM deduplicates semantically similar items. Maximizes ingredient diversity in API call.

---

### Scenario 18: Very low quantities across the board

- **User says:** "Anything I can make?"
- **Inventory:** 10 items all with very low quantities (0.1 kg chicken, 0.2 kg rice, 1 egg, 0.05 L olive oil, etc.)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 10 items. All quantities are low, so quantity-based priority is low for everyone |
| 2 | **LLM** | Notes that all quantities are small. Selects all 10 items (inventory is small enough). Adjusts search to target small-portion recipes |
| 3 | **API** | Single call: `complex_search(ingredients="chicken,rice,egg,olive oil,...", maxServings=2, number=6)` — uses `maxServings` to find small-portion recipes |
| 4 | **Tool** | `_compute_scores()` — standard scoring |
| 5 | **LLM** | Returns top 5. Notes: "Your quantities are low — these recipes are for 1-2 servings. You may need to adjust portion sizes." |

**Key test:** System doesn't ignore low-quantity items. Adapts serving size expectations rather than saying "not enough ingredients."

---

### Scenario 19: User wants multiple recipes for meal prep

- **User says:** "Plan meals for the week using my inventory"
- **Inventory:** 30 items with good variety (2 proteins, 8 vegetables, 3 grains, assorted pantry)

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 30 items across categories |
| 2 | **LLM** | Parses intent: user wants MULTIPLE diverse meals, not just top 5 from one search. Plans 3 separate searches, each centered on a different protein/base to guarantee variety |
| 3 | **LLM** | Designs search plan: Search A = chicken + vegetables + rice. Search B = ground beef + vegetables + pasta. Search C = eggs/tofu + vegetables + bread (breakfast/light meals). Each uses different complementary items |
| 4 | **API** | **Call 1:** `complex_search(ingredients="chicken,broccoli,carrot,garlic,rice", number=5)` |
| 5 | **API** | **Call 2:** `complex_search(ingredients="ground beef,onion,tomato,bell pepper,pasta", number=5)` |
| 6 | **API** | **Call 3:** `complex_search(ingredients="egg,spinach,cheese,bread,tomato", number=5)` |
| 7 | **Tool** | `_compute_scores()` on all 15 results |
| 8 | **LLM** | Does NOT just pick top 5 across all results (would likely all be from one search). Instead picks top 2 from each search to ensure variety. Returns 5-6 recipes covering different proteins and meal types. Presents as a weekly plan: "Monday: Chicken stir-fry, Wednesday: Beef pasta, Friday: Spinach omelette..." |

**Three API calls** — each with a different ingredient focus to guarantee diverse meal types.

**Key test:** Multiple searches with rotated ingredients produce variety. Final selection ensures diversity, not just highest scores.

---

### Scenario 20: Natural language with implicit constraints

- **User says:** "Something healthy and light, I've been eating too much pasta lately"
- **Inventory:** 25 items including pasta, rice, quinoa, chicken, lots of vegetables

**Step-by-step handling:**

| Step | Layer | Action |
|------|-------|--------|
| 1 | **Tool** | `get_inventory_for_recipes()` returns 25 items |
| 2 | **LLM** | Parses implicit constraints from natural language: "healthy and light" → prioritize vegetables + lean protein, prefer low-calorie. "Too much pasta" → EXCLUDE pasta from ingredient selection, deprioritize heavy carbs |
| 3 | **LLM** | Ingredient selection: Picks chicken (lean protein), quinoa (healthy grain alternative to pasta), then loads up on vegetables: spinach, broccoli, bell pepper, tomato. Explicitly excludes pasta. Maps "healthy" to API nutritional filters |
| 4 | **API** | Single call: `complex_search(ingredients="chicken,quinoa,spinach,broccoli,bell pepper,tomato", excludeIngredients="pasta", maxCalories=500, minProtein=20, number=6)` |
| 5 | **Tool** | `_compute_scores()` — high-protein, low-calorie recipes rank well |
| 6 | **LLM** | Returns top 5. Notes: "I skipped pasta since you've had a lot of it lately. These recipes are light and high-protein, using your quinoa and vegetables instead." |

**Key test:** LLM translates nuanced casual language into concrete actions — excludes specific ingredients, adds nutritional filters, adjusts selection — all from one sentence.

---

## Summary: What Each Layer Handles

### Tool Layer (`get_inventory_for_recipes`)

| Responsibility | Details |
|---------------|---------|
| Query inventory | SQLite read: product_name, quantity, quantity_unit, updated_at |
| Categorize | Keyword matching → Meat, Produce, Dairy, Grains, etc. |
| Compute priority | `perishability(50%) + quantity(30%) + age(20%)` = 0.0–1.0 score |
| Flag urgency | `use_first` list (priority > 0.7), `past_shelf_life` warnings |
| Structure output | `by_category` grouping + `ingredient_names_csv` for backward compat |

### LLM Layer (RecipeInventorySearch agent)

| Responsibility | Details |
|---------------|---------|
| Parse user intent | Detect mentioned ingredients, diet, cuisine, time, implicit preferences |
| Fuzzy match | "chicken" → finds "chicken breast" and "chicken thighs" |
| Ingredient selection | Balanced categories, cuisine affinity, dietary filtering, urgency-first |
| Deduplicate | 4 tomato variants → pick 1-2 most versatile |
| Plan API calls | 1 call for simple, 2-3 for variety/partial matches/meal prep |
| Merge & re-rank | Combine multiple API results, deduplicate, sort by final_score |
| Communicate | Warnings (expired, low stock, thin diet match), explain choices |

### API Layer (Spoonacular)

| Responsibility | Details |
|---------------|---------|
| Recipe search | Receives focused 5-10 ingredients (not 40) |
| Apply filters | diet, cuisine, intolerances, maxReadyTime, nutritional bounds |
| Return details | Used/missed ingredients, instructions, nutrition, images |
| Score results | `_compute_scores()`: pantry_coverage(45%) + preference(25%) + prep_time(20%) + missing_penalty(10%) |

### Decision: How Many API Calls?

| Situation | Calls | Reason |
|-----------|-------|--------|
| Simple search, one protein focus | 1 | One focused search is sufficient |
| Partial name match, 2+ variants (S8) | 2 | Each variant needs its own complementary set |
| "Use up old stuff" with 2+ proteins (S16) | 2 | Can't optimally search chicken+beef together |
| Meal prep / weekly plan (S19) | 3 | Need variety across different bases |
| All other scenarios (S1-7, S9-15, S17-18, S20) | 1 | Single focused call with 5-10 ingredients |

---

## Scenario Coverage Matrix

| # | Inventory | User Intent | Filters | Freshness | API Calls | Complexity |
|---|-----------|------------|---------|-----------|-----------|------------|
| 1 | Small (5) | None | None | No | 1 | Simple |
| 2 | Medium (15) | None | None | No | 1 | Simple |
| 3 | Large (40+) | None | None | Yes | 1 | Simple |
| 4 | Empty (0) | None | None | No | 0 | Simple |
| 5 | Medium (20) | Single ingredient | None | No | 1 | Medium |
| 6 | Medium (25) | Multiple ingredients | None | No | 1 | Medium |
| 7 | Medium (20) | Missing ingredient | None | No | 1 (after user choice) | Medium |
| 8 | Medium (20) | Partial name match | None | No | 2 (one per variant) | Medium |
| 9 | Large (30) | None | Diet | No | 1 | Medium |
| 10 | Medium (20) | None | Diet (thin) | No | 1 | Medium |
| 11 | Medium (25) | None | Cuisine | No | 1 | Medium |
| 12 | Large (30) | None | Diet+Cuisine+Time | No | 1 | Complex |
| 13 | Mixed | None | None | Perishable | 1 | Complex |
| 14 | Medium (15) | None | None | All fresh | 1 | Medium |
| 15 | Mixed | None | None | Past shelf life | 1 | Complex |
| 16 | Medium (25) | "Use old stuff" | None | Explicit | 2 (per protein group) | Complex |
| 17 | Mixed | None | None | No | 1 | Complex |
| 18 | Small (10) | None | None | No | 1 | Medium |
| 19 | Large (30) | Meal prep | None | No | 3 (per base) | Very Complex |
| 20 | Medium (25) | Nuanced NL | Implicit | No | 1 | Very Complex |

## Implementation Priority

Based on these scenarios, the features to implement in order:

1. **Category-based ingredient grouping** (scenarios 1-4, 9-12) — most impactful, simplest change
2. **Priority scoring with shelf life** (scenarios 13-16) — the freshness/urgency layer
3. **User intent extraction for ingredient hints** (scenarios 5-8) — LLM instruction update
4. **Graceful edge cases** (scenarios 4, 7, 10, 15, 17-18) — error handling, warnings, deduplication
5. **Multi-search for variety** (scenarios 8, 16, 19) — multiple API calls with merged results
6. **Implicit constraint parsing** (scenario 20) — advanced NLP, mostly LLM-driven
