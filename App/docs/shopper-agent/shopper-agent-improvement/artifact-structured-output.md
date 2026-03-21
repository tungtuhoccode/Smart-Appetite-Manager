# Artifact-Based Structured Output for Custom Frontend

## Problem

The ShopperAgent produces rich, formatted markdown by calling `format_deals_overview` and
`format_shopping_plan`. This works well in the chat UI, but a custom frontend needs structured
data (store names, item prices, product details) to render its own components — not markdown strings.

Three approaches were considered:

| Approach | Problem |
|---|---|
| `output_schema` on the agent | Replaces the markdown output entirely — breaks the chat UI |
| HTML comment embedding (`<!-- DATA: {...} -->`) | Unreliable for large datasets; LLM may truncate or malform JSON across hundreds of rows |
| **JSON artifact + comment reference** | Chat UI unaffected; frontend fetches full data separately |

## Proposed Fix: Artifact + Reference Comment

The agent saves the full structured deal data as a JSON artifact, then embeds only a small
reference comment at the end of its markdown response. The chat UI ignores the comment. The
custom frontend extracts the filename from the comment and fetches the artifact via the REST API.

```
[Chat UI sees]                        [Custom frontend sees]
  Formatted markdown tables             <!-- SHOPPER_ARTIFACT: shopper-deals-abc123.json -->
  Store recommendations                 → fetches artifact → renders own components
  Price breakdowns
  <!-- SHOPPER_ARTIFACT: ... -->  ← invisible in rendered markdown
```

## Required Changes

### 1. Add `artifact_management` tools to `configs/agents/shopper/shopper.yaml`

```yaml
tools:
  - tool_type: builtin-group
    group_name: artifact_management        # adds create_artifact, read_artifact, etc.
  - tool_type: python                      # existing tools unchanged
    component_base_path: "src"
    component_module: "shopper_agent.shopper_tools"
    function_name: "find_deals_for_planning"
    tool_config:
      ...
  - tool_type: python
    ...
    function_name: "format_deals_overview"
  - tool_type: python
    ...
    function_name: "format_shopping_plan"
```

The `artifact_service: *default_artifact_service` line is already present in the agent config —
no additional wiring needed.

### 2. Update the agent instruction in `configs/agents/shopper/shopper.yaml`

Append to the end of the `instruction` field:

```yaml
instruction: |
  ... existing instruction unchanged ...

  **STRUCTURED DATA ARTIFACT:**
  After outputting both formatted_markdown results, save the structured deal data as a JSON
  artifact using create_artifact. The artifact content must be:

  {
    "stores": ["StoreA", "StoreB"],
    "plan": [
      {
        "search_term": "milk",
        "store": "No Frills",
        "price": "$4.49",
        "product": "Beatrice 2% Milk 4L"
      }
    ],
    "store_comparison": { ...the full store_comparison object from find_deals_for_planning... }
  }

  Use filename: "shopper-deals-{a short unique slug}.json"
  mime_type: "application/json"

  Then, as the very last line of your response, output:
  <!-- SHOPPER_ARTIFACT: {the exact filename you used} -->

  This line must appear after all other content and must not be modified.
```

## How the Custom Frontend Consumes It

### Step 1 — Parse the artifact reference from the response

```javascript
function extractArtifactRef(responseText) {
  const match = responseText.match(/<!-- SHOPPER_ARTIFACT: (.+?) -->/);
  return match ? match[1] : null;
}
```

### Step 2 — Fetch the artifact via the REST API

```javascript
async function fetchShopperData(filename, sessionId) {
  const res = await fetch(
    `/api/v2/artifacts/${filename}?session_id=${sessionId}`
  );
  if (!res.ok) return null;
  return res.json();
}
```

### Step 3 — Render with the structured data

```javascript
const filename = extractArtifactRef(agentResponse);
if (filename) {
  const data = await fetchShopperData(filename, contextId);
  // data.stores  → ["No Frills", "IGA"]
  // data.plan    → [{ search_term, store, price, product }, ...]
  // data.store_comparison → full price matrix for all stores/items
}
```

## Artifact Schema

```json
{
  "stores": ["string"],
  "plan": [
    {
      "search_term": "string",
      "store": "string",
      "price": "string",
      "product": "string"
    }
  ],
  "store_comparison": {
    "<store_name>": {
      "tier": "budget | mid | premium",
      "deal_count": "number",
      "basket_total": "number",
      "items": {
        "<search_term>": {
          "name": "string",
          "price": "number",
          "detail": "string",
          "price_type": "flat | per_lb | per_100g | per_kg",
          "source": "flyer | ecom | inferred"
        }
      }
    }
  }
}
```

## Why This Approach

- **Chat UI is unaffected** — HTML comments are invisible in any markdown renderer
- **No LLM JSON size risk** — the artifact is written by the tool layer, not generated inline as part of the response text
- **Full data available on demand** — `store_comparison` contains the complete price matrix for all stores and items, useful for richer frontend visualizations
- **Graceful degradation** — if the comment is missing or the fetch fails, the frontend falls back to displaying the markdown response as-is
