# Inventory Schema Reference

Shared reference for all inventory management agents.
Update this file when the schema changes — both InventoryManager and IngredientParser
should stay consistent with these definitions.

## Database Schema

| Column         | Type    | Description                                          |
| -------------- | ------- | ---------------------------------------------------- |
| product_name   | TEXT    | Name of the item (e.g., "Chicken breast")            |
| quantity       | REAL    | Numeric amount (e.g., 2, 500, 12)                    |
| quantity_unit  | TEXT    | Unit of measurement (e.g., "kg", "g", "mL", "unit") |
| unit           | TEXT    | Packaging/container type (e.g., "can", "loaf", "kg") |

## Canonical Units

When parsing ingredients, normalize all units to these canonical forms:

| Category   | Canonical Units                                    |
| ---------- | -------------------------------------------------- |
| Weight     | `kg`, `g`, `lb`, `oz`                              |
| Volume     | `L`, `mL`, `cup`, `tbsp`, `tsp`                    |
| Count      | `unit` (for: pieces, pcs, each, count, items, ea)  |
| Containers | `can`, `bottle`, `bag`, `box`, `jar`, `packet`     |
| Produce    | `head`, `bunch`, `loaf`, `clove`, `stick`, `slice` |

## Parsing Examples

### Simple format: "Name: Quantity Unit"

| Input                       | product_name        | quantity | quantity_unit | unit   |
| --------------------------- | ------------------- | -------- | ------------- | ------ |
| Chicken breast: 2 kg        | Chicken breast      | 2        | kg            | kg     |
| Eggs: 12 units              | Eggs                | 12       | unit          | unit   |
| Whole wheat bread: 1 loaf   | Whole wheat bread   | 1        | loaf          | loaf   |
| Garlic: 1 head              | Garlic              | 1        | head          | head   |
| Olive oil: 500 mL           | Olive oil           | 500      | mL            | mL     |

### Container with inner weight: "Name: N container (weight)"

| Input                                    | product_name              | quantity | quantity_unit | unit |
| ---------------------------------------- | ------------------------- | -------- | ------------- | ---- |
| Diced tomatoes (canned): 1 can (400 g)   | Diced tomatoes (canned)  | 400      | g             | can  |
| Coconut milk (canned): 1 can (400 mL)    | Coconut milk (canned)    | 400      | mL            | can  |
| Black beans (canned): 1 can (540 mL)     | Black beans (canned)     | 540      | mL            | can  |
| Chickpeas (canned): 1 can (540 mL)       | Chickpeas (canned)       | 540      | mL            | can  |

### Container with count: "Name: N container (count)"

| Input                            | product_name | quantity | quantity_unit | unit  |
| -------------------------------- | ------------ | -------- | ------------- | ----- |
| Bananas: 1 bunch (5 count)       | Bananas      | 5        | unit          | bunch |

## insert_inventory_items Format

The `insert_inventory_items` tool expects a `items` parameter — a list of objects:

```json
[
  {"product_name": "Chicken breast", "quantity": 2, "quantity_unit": "kg", "unit": "kg"},
  {"product_name": "Eggs", "quantity": 12, "quantity_unit": "unit", "unit": "unit"},
  {"product_name": "Diced tomatoes (canned)", "quantity": 400, "quantity_unit": "g", "unit": "can"}
]
```

Each object MUST have:
- `product_name` (string) — required
- `quantity` (number) — required
- `quantity_unit` (string) — required
- `unit` (string) — optional, defaults to same as quantity_unit
