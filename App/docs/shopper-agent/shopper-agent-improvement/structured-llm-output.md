# Structured LLM Output — `instructor` Integration

## Problem

The shopper pipeline makes 3 LLM calls inside `shopper_tools.py`. Two of them — the relevance filter (Step 2) and the product enrichment (Step 2b) — parse the LLM's response as JSON manually:

```python
# Current pattern in _generate_exclude_list_via_llm and enrich_flipp_results
result = await _call_llm(...)
if "error" in result:
    return {}                          # silent failure
exclude_data = result.get("data", {})
if not isinstance(exclude_data, dict): # silent failure
    return {}
```

If the LLM returns malformed JSON (missing bracket, trailing comma, wrapped in markdown), the function silently returns `{}` and the pipeline continues with empty data — no error is raised, no retry is attempted.

## Proposed Fix: `instructor` Library

[`instructor`](https://python.useinstructor.com/) is a lightweight library that wraps any OpenAI-compatible client and adds:

- **Pydantic-validated output** — the response is automatically parsed and validated against a model you define
- **Auto-retry on failure** — if the LLM returns bad JSON, `instructor` feeds the parse error back to the LLM and retries (up to N times)
- **No pipeline changes** — it only replaces the LLM call + JSON parsing boilerplate

## Installation

```bash
uv add instructor
```

## Code Change Pattern

### Before

```python
result = await _call_llm(
    messages=messages,
    model=model,
    api_base=api_base,
    api_key=api_key,
    log_id=log_id,
    max_tokens=16384,
    temperature=0.1,
)
if "error" in result:
    return {}
exclude_data = result.get("data", {})
if not isinstance(exclude_data, dict):
    return {}
```

### After

```python
import instructor
from openai import AsyncOpenAI
from pydantic import BaseModel

class FilterResult(BaseModel):
    excludes: dict[str, list[str]]  # search_term -> product names to exclude

client = instructor.from_openai(
    AsyncOpenAI(base_url=api_base, api_key=api_key)
)

result = await client.chat.completions.create(
    model=model,
    response_model=FilterResult,
    messages=messages,
    max_retries=3,
    max_tokens=16384,
    temperature=0.1,
)
# result is always a valid FilterResult — no checks needed
exclude_data = result.excludes
```

## Affected Functions

| Function | File | Step |
|---|---|---|
| `_generate_exclude_list_via_llm` | `src/shopper_agent/shopper_tools.py` | Step 2 — filter irrelevant items |
| `enrich_flipp_results` | `src/shopper_agent/shopper_tools.py` | Step 2b — add product detail tags |

## Pydantic Models to Define

```python
# Step 2 — filter
class FilterResult(BaseModel):
    excludes: dict[str, list[str]]
    # e.g. {"chicken breast": ["Dog Food", "Chicken Shampoo"]}

# Step 2b — enrich
class EnrichResult(BaseModel):
    details: dict[str, dict[str, str]]
    # e.g. {"salmon": {"Ocean's Pink Salmon": "canned", "Atlantic Salmon": "fresh fillet"}}
```

## Why Not LangChain?

LangChain offers similar structured output via `.with_structured_output()`, but it comes with a large dependency footprint and requires rewriting the pipeline as chains. `instructor` is a drop-in replacement for just the LLM call layer — no pipeline restructuring needed.
