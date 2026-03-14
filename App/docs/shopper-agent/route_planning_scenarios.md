# Route Planning Scenarios

20 concrete scenarios for the redesigned route planner that combines flyer deals with budget store fallback and max store visit limits.

## Key Assumptions
- Deals are **per-chain** (a Walmart flyer deal applies to all nearby Walmarts)
- Route = choose chains, then find nearest location of each
- Budget chains in Canada: Walmart, No Frills, Food Basics, FreshCo, Giant Tiger, Real Canadian Superstore
- Mid-range chains: Metro, Sobeys, Loblaws, Farm Boy

---

## Scenario 1: All items found on sale at one store
**Shopping list**: chicken, rice, broccoli
**Flipp results**: All 3 items on sale at Walmart
**Expected**: Route = Walmart only (1 stop). No fallback needed.

## Scenario 2: All items found on sale, split across 2 stores
**Shopping list**: chicken, rice, broccoli
**Flipp results**: chicken at Loblaws ($4.88/lb), rice at Walmart ($2.99), broccoli at both
**Max stops**: 2
**Expected**: Compare (Loblaws + Walmart, 2 stops) vs (Walmart only if broccoli+rice deals there). If Walmart has decent deals on all 3, prefer 1 stop. If Loblaws chicken deal saves significantly, go 2 stops.

## Scenario 3: Deals at 3 stores but max stops = 2
**Shopping list**: chicken, rice, pasta, eggs
**Flipp results**: chicken at Loblaws, rice at Metro, pasta at FreshCo, no eggs deal
**Max stops**: 2
**Expected**: Pick best 2-store combination covering most deal items. Remaining items (eggs + uncovered deal items) bought at whichever of the 2 chosen stores is cheapest for regular-price items. Don't add a 3rd stop.

## Scenario 4: No deals found on any item
**Shopping list**: milk, eggs, bread
**Flipp results**: nothing
**Expected**: LLM recommends a single budget store (e.g. "No deals this week -- head to Walmart or No Frills for the best everyday prices"). Route = 1 budget store.

## Scenario 5: Mix of deal + no-deal items, deal store is also a budget chain
**Shopping list**: chicken, milk, eggs, bread
**Flipp results**: chicken on sale at Walmart ($5.99/lb)
**Expected**: Route = Walmart only (1 stop). Chicken at deal price, milk/eggs/bread at regular Walmart prices. LLM notes "Walmart is already a budget store, so pick up the rest here."

## Scenario 6: Mix of deal + no-deal items, deal store is expensive for regular items
**Shopping list**: chicken, milk, eggs, bread
**Flipp results**: chicken on sale at Loblaws ($4.88/lb)
**Max stops**: 2
**Expected**: Route = Loblaws (chicken deal) + No Frills or Walmart (milk, eggs, bread at cheap regular prices). LLM reasons that Loblaws regular prices are high, so adding a budget stop is worth it.

## Scenario 7: Same deal at multiple chains
**Shopping list**: chicken
**Flipp results**: chicken at Walmart ($5.99/lb), chicken at Loblaws ($4.88/lb), chicken at Metro ($5.49/lb)
**Expected**: Route = single closest store with the best deal (Loblaws). Since deals are chain-wide, pick the nearest Loblaws.

## Scenario 8: Large shopping list (10+ items), few on sale
**Shopping list**: chicken, rice, pasta, milk, eggs, bread, butter, onions, tomatoes, cheese
**Flipp results**: chicken at Loblaws, rice at Walmart, pasta at Metro
**Max stops**: 2
**Expected**: Choose 2 stores that cover the most deal items AND are good for non-deal items. E.g. Walmart (rice deal + budget prices for 7 other items) + Loblaws (chicken deal). Skip Metro pasta deal -- not worth a 3rd stop.

## Scenario 9: User explicitly says "max 1 store"
**Shopping list**: chicken, rice, broccoli
**Flipp results**: chicken at Loblaws (great deal), rice at Walmart (good deal)
**Max stops**: 1
**Expected**: Pick the ONE store with the best overall value (deals + regular prices for remaining items). Likely Walmart (1 deal + budget prices) or Loblaws (1 deal but higher regular prices). LLM reasons about which single store is best.

## Scenario 10: User says "I want the cheapest possible"
**Shopping list**: chicken, rice, milk
**Flipp results**: chicken at Loblaws ($4.88/lb), chicken at Walmart ($5.99/lb), rice at Metro ($2.49)
**Max stops**: 3 (default)
**Expected**: Even with max 3, LLM should weigh whether the savings from 3 stops justify the extra travel. Might still recommend 2 stops if the 3rd stop only saves $0.50.

## Scenario 11: Seasonal/specialty item not found anywhere
**Shopping list**: chicken, truffle oil, saffron
**Flipp results**: chicken at Walmart
**Expected**: Route = Walmart for chicken + note that truffle oil and saffron are specialty items unlikely to be found at regular grocery stores. LLM might suggest a specialty store but doesn't add it to the route.

## Scenario 12: All items at the same chain (chain-level dedup)
**Shopping list**: chicken, rice
**Flipp results**: chicken at "Walmart" flyer deal, rice at "Walmart" flyer deal
**Expected**: Route = nearest Walmart (1 stop). Both deals available at any Walmart location. Don't show 2 different Walmart locations.

## Scenario 13: Same item, huge price difference between chains
**Shopping list**: chicken
**Flipp results**: chicken at Loblaws ($4.88/lb), chicken at Food Basics ($6.99/lb)
**Expected**: Route = nearest Loblaws (best deal). Clearly recommend the cheaper option.

## Scenario 14: User has 2 items, deals at 2 different stores, max stops = 1
**Shopping list**: chicken, rice
**Flipp results**: chicken at Loblaws ($4.88/lb), rice at Metro ($2.49)
**Max stops**: 1
**Expected**: Pick the store where buying BOTH (one at deal, one at regular) is cheapest overall. LLM reasons: "Loblaws chicken deal saves $5 but rice is $4.99 regular. Metro rice deal saves $1.50 but chicken is $8.99 regular. Loblaws is the better single stop."

## Scenario 15: Budget store has no deals but covers all items cheaply
**Shopping list**: milk, eggs, bread, butter
**Flipp results**: milk at Loblaws ($3.99, save $1), butter at Metro ($4.49, save $0.50)
**Max stops**: 2
**Expected**: LLM should evaluate: is it worth 2 stops for $1.50 total savings on milk+butter, when No Frills/Walmart has all 4 items at decent regular prices in 1 stop? Might recommend 1 stop at a budget store.

## Scenario 16: Deal store is far away, budget store is very close
**Shopping list**: chicken, rice, milk
**Flipp results**: chicken at Loblaws ($4.88/lb, saves $4)
**Context**: Nearest Loblaws is 15km away, nearest Walmart is 2km away
**Max stops**: 2
**Expected**: Route optimizer should weigh distance. If gas/time cost of driving to Loblaws exceeds the $4 savings, prefer the nearby Walmart (even without a chicken deal).

## Scenario 17: Multiple deals at one store vs single better deal at another
**Shopping list**: chicken, rice, pasta, eggs
**Flipp results**: chicken+rice+pasta all on sale at FreshCo (moderate deals), chicken only at Loblaws (much better chicken deal)
**Max stops**: 2
**Expected**: FreshCo alone (3 deals, 1 stop for eggs too since it's a budget chain) vs FreshCo + Loblaws (better chicken deal but 2 stops). LLM weighs the savings difference.

## Scenario 18: User shopping for a specific recipe
**Shopping list**: salmon, asparagus, lemon, olive oil, garlic
**Flipp results**: salmon at Loblaws ($9.99/lb), asparagus at Metro ($2.99)
**Max stops**: 2
**Expected**: Loblaws (salmon deal) + budget store for remaining 3 items. Or if Loblaws has reasonable prices on asparagus/lemon/olive oil/garlic, just go to Loblaws (1 stop).

## Scenario 19: Extremely long list with many items not on sale
**Shopping list**: 15 items, only 3 have flyer deals
**Max stops**: 2
**Expected**: The 12 non-deal items dominate. Route should heavily favor budget stores. If one of the 3 deal stores IS a budget store (e.g. Walmart), go there for everything. Otherwise, 1 budget store + 1 deal store if the deal savings justify the extra stop.

## Scenario 20: User in area with limited store options
**Shopping list**: chicken, rice, milk
**Flipp results**: chicken at Walmart ($5.99/lb)
**Context**: Only Walmart and one local grocery store nearby
**Expected**: Route = Walmart (1 stop, has deal + regular items). System should work gracefully even with few store options -- don't require 3+ stores to function.

---

## Key Patterns from Scenarios

1. **1-2 stops is almost always optimal** -- 3+ stops only make sense for very large lists with significant savings
2. **Budget stores with deals are the sweet spot** -- Walmart/No Frills with a flyer deal should be heavily favored
3. **Core trade-off: "is the deal savings worth an extra stop?"** -- small savings ($1-2) rarely justify extra travel
4. **Chain-level thinking** -- don't think about individual locations, think about chains. Then pick nearest location
5. **Non-deal items dominate large lists** -- for 15 items with 3 on sale, the 12 regular items matter more for store choice
6. **Budget chains already in the route absorb non-deal items** -- no extra stop needed
