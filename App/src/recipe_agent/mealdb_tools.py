from __future__ import annotations

import asyncio
import json
import os
import random
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from google.adk.tools import ToolContext
from dotenv import load_dotenv

load_dotenv()

SPOONACULAR_BASE = "https://api.spoonacular.com"
API_KEY = os.environ.get("SPOONACULAR_API_KEY")


async def _fetch_json(url: str) -> Any:
    def _blocking() -> Any:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    return await asyncio.to_thread(_blocking)


async def get_top_3_meals(ingredients: str) -> Dict[str, Any]:
    """
    Get the top 3 meals with the most used ingredients from Spoonacular.
    """
    params = {
        "apiKey": API_KEY,
        "ingredients": ingredients,
        "number": 10,  # Fetch more to sort and get top 3
        "ranking": 1,  # Maximize used ingredients
        "ignorePantry": True,
    }
    encoded_params = urllib.parse.urlencode(params)
    url = f"{SPOONACULAR_BASE}/recipes/findByIngredients?{encoded_params}"

    data = await _fetch_json(url)
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


async def get_meal_details(
    meal_id: str,
    tool_context: Optional[ToolContext] = None,
) -> Dict[str, Any]:
    """
    Lookup full meal details by ID (ingredients + instructions) using Spoonacular.
    """
    if not meal_id:
        return {"status": "error", "message": "meal_id is required"}

    params = {"apiKey": API_KEY}
    encoded_params = urllib.parse.urlencode(params)
    url = f"{SPOONACULAR_BASE}/recipes/{meal_id}/information?{encoded_params}"

    data = await _fetch_json(url)
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


async def get_random_meal(
    tool_context: Optional[ToolContext] = None,
) -> Dict[str, Any]:
    """

    Get a random meal recipe online using Spoonacular.
    """
    params = {
        "apiKey": API_KEY,
        "number": 1,
    }
    encoded_params = urllib.parse.urlencode(params)
    url = f"{SPOONACULAR_BASE}/recipes/random?{encoded_params}"

    data = await _fetch_json(url)
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
