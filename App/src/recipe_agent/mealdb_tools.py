from __future__ import annotations

import asyncio
import json
import random
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from google.adk.tools import ToolContext

API_NINJAS_BASE = "https://api.api-ninjas.com/v1/recipe"


def _merge_headers(headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    merged = {"User-Agent": "solace-agent-mesh-recipe-agent/1.0"}
    if headers:
        merged.update(headers)
    return merged


async def _fetch_json(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    def _blocking() -> Any:
        req = urllib.request.Request(
            url,
            headers=_merge_headers(headers),
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))

    return await asyncio.to_thread(_blocking)


def _extract_ingredients(raw: str) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    cleaned = (raw or "").strip()
    if not cleaned:
        return out

    if "|" in cleaned:
        parts = cleaned.split("|")
    elif "\n" in cleaned:
        parts = cleaned.splitlines()
    else:
        parts = cleaned.split(";")

    for part in parts:
        item = part.strip().strip("-").strip()
        if item:
            out.append({"ingredient": item, "measure": ""})
    return out


def _get_api_key(tool_config: Optional[Dict[str, Any]]) -> Optional[str]:
    if not tool_config:
        return None
    api_key = str(tool_config.get("api_key") or "").strip()
    return api_key or None


async def search_meals(
    query: Optional[str] = None,
    ingredient: Optional[str] = None,
    category: Optional[str] = None,
    area: Optional[str] = None,
    max_results: int = 5,
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Search for meals online using API Ninjas.

    Use ONE of:
      - query: meal name (e.g., "Arrabiata")
      - ingredient: main ingredient (e.g., "chicken")
      - category: category (e.g., "Seafood")
      - area: cuisine/area (e.g., "Canadian")

    Returns a list of candidate meals with ids you can pass to get_meal_details().
    """
    max_results = max(1, min(int(max_results or 5), 10))
    api_key = _get_api_key(tool_config)
    if not api_key:
        return {"status": "error", "message": "API_NINJAS_API_KEY is required"}

    # Decide which endpoint to use
    if query:
        search_term = query
    elif ingredient:
        search_term = ingredient
    elif category:
        search_term = category
    elif area:
        search_term = area
    else:
        return {
            "status": "error",
            "message": "Provide at least one of: query, ingredient, category, area",
        }

    url = (
        f"{API_NINJAS_BASE}?query={urllib.parse.quote(search_term)}"
        f"&limit={max_results}"
    )

    data = await _fetch_json(url, headers={"X-Api-Key": api_key})
    if not isinstance(data, list):
        return {"status": "error", "message": "Unexpected API response"}

    meals = data
    results = []

    for idx, m in enumerate(meals[:max_results], start=1):
        results.append(
            {
                "idMeal": m.get("title") or f"recipe-{idx}",
                "strMeal": m.get("title"),
                "strMealThumb": None,
            }
        )

    return {"status": "success", "count": len(results), "meals": results}


async def get_meal_details(
    meal_id: str,
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Lookup full meal details by name (ingredients + instructions + metadata).
    """
    if not meal_id:
        return {"status": "error", "message": "meal_id is required"}

    api_key = _get_api_key(tool_config)
    if not api_key:
        return {"status": "error", "message": "API_NINJAS_API_KEY is required"}

    url = f"{API_NINJAS_BASE}?query={urllib.parse.quote(str(meal_id))}&limit=1"
    data = await _fetch_json(url, headers={"X-Api-Key": api_key})
    if not isinstance(data, list):
        return {"status": "error", "message": "Unexpected API response"}

    meals = data
    if not meals:
        return {"status": "error", "message": f"No meal found for id={meal_id}"}

    meal = meals[0]
    return {
        "status": "success",
        "meal": {
            "idMeal": meal_id,
            "name": meal.get("title"),
            "category": None,
            "area": None,
            "tags": None,
            "youtube": None,
            "source": None,
            "thumbnail": None,
            "ingredients": _extract_ingredients(meal.get("ingredients") or ""),
            "instructions": (meal.get("instructions") or "").strip(),
        },
    }


async def get_random_meal(
    tool_context: Optional[ToolContext] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Get a random meal recipe online.
    """
    api_key = _get_api_key(tool_config)
    if not api_key:
        return {"status": "error", "message": "API_NINJAS_API_KEY is required"}

    seed_queries = [
        "chicken",
        "beef",
        "pasta",
        "salad",
        "soup",
        "tofu",
        "seafood",
        "rice",
        "vegetarian",
        "dessert",
    ]
    seed = random.choice(seed_queries)
    url = f"{API_NINJAS_BASE}?query={urllib.parse.quote(seed)}&limit=10"
    data = await _fetch_json(url, headers={"X-Api-Key": api_key})
    if not isinstance(data, list) or not data:
        return {"status": "error", "message": "No random meal returned"}
    meal = random.choice(data)
    return {
        "status": "success",
        "meal": {
            "idMeal": meal.get("title"),
            "name": meal.get("title"),
            "category": None,
            "area": None,
            "tags": None,
            "youtube": None,
            "source": None,
            "thumbnail": None,
            "ingredients": _extract_ingredients(meal.get("ingredients") or ""),
            "instructions": (meal.get("instructions") or "").strip(),
        },
    }
