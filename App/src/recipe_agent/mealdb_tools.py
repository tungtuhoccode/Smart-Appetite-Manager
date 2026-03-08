from __future__ import annotations

import asyncio
import json
import os
import random
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from google.adk.tools import ToolContext
from dotenv import load_dotenv
try:
    from tool_execution_logger import logged_tool
except ImportError:  # pragma: no cover
    from src.tool_execution_logger import logged_tool

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
if _ENV_PATH.exists():
    load_dotenv(dotenv_path=_ENV_PATH)
else:
    load_dotenv()

SPOONACULAR_BASE = "https://api.spoonacular.com"


class SpoonacularError(RuntimeError):
    """Raised when Spoonacular request setup/call fails."""


def _get_api_key() -> str:
    key = (os.environ.get("SPOONACULAR_API_KEY") or "").strip()
    if not key:
        raise SpoonacularError(
            "SPOONACULAR_API_KEY is missing. Set it in App/.env and restart SAM."
        )
    return key


async def _fetch_json(url: str) -> Any:
    def _blocking() -> Any:
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            snippet = body[:500] if body else ""
            raise SpoonacularError(
                f"Spoonacular HTTP {e.code}. {snippet or 'No response body.'}"
            ) from e
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", e)
            raise SpoonacularError(
                f"Network error calling Spoonacular: {reason}"
            ) from e
        except json.JSONDecodeError as e:
            raise SpoonacularError(
                f"Invalid JSON from Spoonacular: {e}"
            ) from e
    return await asyncio.to_thread(_blocking)


@logged_tool("recipe.get_top_3_meals")
async def get_top_3_meals(ingredients: str) -> Dict[str, Any]:
    """
    Get the top 3 meals with the most used ingredients from Spoonacular.
    """
    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    params = {
        "apiKey": api_key,
        "ingredients": ingredients,
        "number": 10,  # Fetch more to sort and get top 3
        "ranking": 1,  # Maximize used ingredients
        "ignorePantry": "true",
    }
    encoded_params = urllib.parse.urlencode(params)
    url = f"{SPOONACULAR_BASE}/recipes/findByIngredients?{encoded_params}"

    try:
        data = await _fetch_json(url)
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}
    if not isinstance(data, list):
        return {"status": "error", "message": "Unexpected Spoonacular API response"}

    if not data:
        return {"status": "error", "message": "No meals found with the given ingredients."}

    # Sort meals by the number of used ingredients in descending order
    sorted_meals = sorted(data, key=lambda x: x.get("usedIngredientCount", 0), reverse=True)

    # Get the top 3
    top_3_meals = sorted_meals[:3]

    results = []
    for meal in top_3_meals:
        results.append({
            "idMeal": str(meal.get("id")),
            "strMeal": meal.get("title"),
            "strMealThumb": meal.get("image"),
            "usedIngredientCount": meal.get("usedIngredientCount", 0),
            "missedIngredientCount": meal.get("missedIngredientCount", 0),
            "usedIngredients": [{"ingredient": ui["name"], "measure": f"{ui['amount']} {ui['unit']}"} for ui in meal.get("usedIngredients", [])],
            "missedIngredients": [{"ingredient": mi["name"], "measure": f"{mi['amount']} {mi['unit']}"} for mi in meal.get("missedIngredients", [])],
        })

    return {"status": "success", "count": len(results), "meals": results}


@logged_tool("recipe.search_meals")
async def search_meals(
    ingredient: Optional[str] = None,
    category: Optional[str] = None,  # Corresponds to diet in Spoonacular
    area: Optional[str] = None,  # Corresponds to cuisine in Spoonacular
    tool_context: Optional[ToolContext] = None,
) -> Dict[str, Any]:
    """
    Search for meals online using the Spoonacular API based on ingredients, diet, and cuisine.
    """

    if not ingredient:
        return {"status": "error", "message": "Please provide some ingredients to search for."}

    return await get_top_3_meals(ingredient)


@logged_tool("recipe.get_meal_details")
async def get_meal_details(
    meal_id: str,
    tool_context: Optional[ToolContext] = None,
) -> Dict[str, Any]:
    """
    Lookup full meal details by ID (ingredients + instructions) using Spoonacular.
    """
    if not meal_id:
        return {"status": "error", "message": "meal_id is required"}

    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    params = {"apiKey": api_key}
    encoded_params = urllib.parse.urlencode(params)
    url = f"{SPOONACULAR_BASE}/recipes/{meal_id}/information?{encoded_params}"

    try:
        data = await _fetch_json(url)
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}
    if not isinstance(data, dict) or not data:
        return {"status": "error", "message": f"No meal found for id={meal_id}"}

    meal = data
    ingredients = [{"ingredient": ing.get("name"), "measure": f"{ing.get('amount')} {ing.get('unit')}"} for ing in meal.get("extendedIngredients", [])]

    return {
        "status": "success",
        "meal": {
            "idMeal": str(meal.get("id")),
            "name": meal.get("title"),
            "instructions": (meal.get("instructions") or "").strip(),
            "ingredients": ingredients,
        },
    }


@logged_tool("recipe.get_random_meal")
async def get_random_meal(
    tool_context: Optional[ToolContext] = None,
) -> Dict[str, Any]:
    """

    Get a random meal recipe online using Spoonacular.
    """
    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    params = {
        "apiKey": api_key,
        "number": 1,
    }
    encoded_params = urllib.parse.urlencode(params)
    url = f"{SPOONACULAR_BASE}/recipes/random?{encoded_params}"

    try:
        data = await _fetch_json(url)
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}
    if not isinstance(data, dict) or "recipes" not in data or not data["recipes"]:
        return {"status": "error", "message": "No random meal returned from Spoonacular"}

    meal = data["recipes"][0]
    # Random endpoint doesn't return used/missing ingredients, so we just get the full list
    ingredients = [{"ingredient": ing.get("name"), "measure": f"{ing.get('amount')} {ing.get('unit')}"} for ing in meal.get("extendedIngredients", [])]

    return {
        "status": "success",
        "meal": {
            "idMeal": str(meal.get("id")),
            "name": meal.get("title"),
            "instructions": (meal.get("instructions") or "").strip(),
            "ingredients": ingredients,
        },
    }
