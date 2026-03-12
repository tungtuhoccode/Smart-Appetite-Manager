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

from dotenv import load_dotenv

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
        req = urllib.request.Request(url, headers={"User-Agent": "SmartAppetiteManager/1.0"})
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


async def _post_form(url: str, data: Dict[str, str]) -> Any:
    """POST with application/x-www-form-urlencoded (needed for parseIngredients)."""
    def _blocking() -> Any:
        encoded = urllib.parse.urlencode(data).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=encoded,
            headers={
                "User-Agent": "SmartAppetiteManager/1.0",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )
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


# ── Private helpers ─────────────────────────────────────────────────


async def _find_by_ingredients_raw(ingredients: str, number: int = 10) -> List[Dict]:
    """Call findByIngredients and return raw Spoonacular list."""
    api_key = _get_api_key()
    params = {
        "apiKey": api_key,
        "ingredients": ingredients,
        "number": number,
        "ranking": 1,
        "ignorePantry": "true",
    }
    url = f"{SPOONACULAR_BASE}/recipes/findByIngredients?{urllib.parse.urlencode(params)}"
    data = await _fetch_json(url)
    return data if isinstance(data, list) else []


async def _get_random_fallback(number: int = 5) -> List[Dict]:
    """Fetch random recipes as a last-resort fallback."""
    api_key = _get_api_key()
    params = {"apiKey": api_key, "number": number}
    url = f"{SPOONACULAR_BASE}/recipes/random?{urllib.parse.urlencode(params)}"
    data = await _fetch_json(url)
    if isinstance(data, dict) and isinstance(data.get("recipes"), list):
        return data["recipes"]
    return []


# ── Scoring model ───────────────────────────────────────────────────


def _compute_scores(
    recipe_data: Dict,
    pantry_ingredients: List[str],
    user_target_time: int = 0,
    user_diet: str = "",
    user_intolerances: str = "",
    user_cuisine: str = "",
) -> Dict[str, Any]:
    """Compute a multi-factor score for a recipe."""
    used = recipe_data.get("usedIngredientCount", 0)
    missed = recipe_data.get("missedIngredientCount", 0)
    total = used + missed
    pantry_coverage = used / total if total > 0 else 0.0

    ready = recipe_data.get("readyInMinutes", 0) or 0
    if user_target_time > 0 and ready > 0:
        if ready <= user_target_time:
            prep_time_score = 1.0
        else:
            prep_time_score = max(0.0, 1.0 - (ready - user_target_time) / user_target_time)
    else:
        prep_time_score = 0.5

    recipe_diets = {d.lower() for d in recipe_data.get("diets", [])}
    recipe_cuisines = {c.lower() for c in recipe_data.get("cuisines", [])}

    pref_hits = 0
    pref_checks = 0
    if user_diet:
        pref_checks += 1
        if user_diet.lower() in recipe_diets:
            pref_hits += 1
    if user_cuisine:
        pref_checks += 1
        if user_cuisine.lower() in recipe_cuisines:
            pref_hits += 1
    if user_intolerances:
        pref_checks += 1
        # If the recipe has diets info, we trust Spoonacular filtered correctly
        pref_hits += 1

    pref_score = pref_hits / pref_checks if pref_checks > 0 else 0.5

    norm_missing = min(missed / 10.0, 1.0) if missed > 0 else 0.0
    final = (
        0.45 * pantry_coverage
        + 0.25 * pref_score
        + 0.20 * prep_time_score
        + 0.10 * (1.0 - norm_missing)
    )

    parts = []
    parts.append(f"{pantry_coverage:.0%} pantry match ({used}/{total} ingredients)")
    if ready:
        parts.append(f"{ready} min prep")
    if recipe_diets:
        parts.append(f"diets: {', '.join(sorted(recipe_diets))}")
    explanation = " · ".join(parts)

    return {
        "pantry_coverage_score": round(pantry_coverage, 3),
        "missing_ingredient_count": missed,
        "prep_time_score": round(prep_time_score, 3),
        "preference_match_score": round(pref_score, 3),
        "final_score": round(final, 3),
        "explanation": explanation,
    }


def _normalize_recipe(raw: Dict, scores: Optional[Dict] = None) -> Dict[str, Any]:
    """Standardize a recipe dict from any Spoonacular endpoint."""
    used_ings = raw.get("usedIngredients", [])
    missed_ings = raw.get("missedIngredients", [])

    def _fmt_ing(ing: Dict) -> Dict:
        return {
            "ingredient": ing.get("name", ""),
            "measure": f"{ing.get('amount', '')} {ing.get('unit', '')}".strip(),
        }

    return {
        "id": str(raw.get("id", "")),
        "title": raw.get("title", ""),
        "image": raw.get("image", ""),
        "readyInMinutes": raw.get("readyInMinutes", 0),
        "servings": raw.get("servings", 0),
        "sourceUrl": raw.get("sourceUrl", ""),
        "usedIngredients": [_fmt_ing(i) for i in used_ings] if used_ings else [],
        "missedIngredients": [_fmt_ing(i) for i in missed_ings] if missed_ings else [],
        "usedIngredientCount": raw.get("usedIngredientCount", len(used_ings)),
        "missedIngredientCount": raw.get("missedIngredientCount", len(missed_ings)),
        "diets": raw.get("diets", []),
        "cuisines": raw.get("cuisines", []),
        "scores": scores,
    }


# ── Public tool functions ───────────────────────────────────────────


async def complex_search(
    query: str = "",
    ingredients: str = "",
    exclude_ingredients: str = "",
    diet: str = "",
    intolerances: str = "",
    cuisine: str = "",
    max_ready_time: int = 0,
    number: int = 5,
    tool_context: Any = None,
) -> Dict[str, Any]:
    """
    Advanced recipe search with filters for diet, cuisine, intolerances, and prep time.
    Falls back to findByIngredients then random recipes if no results.
    """
    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    params: Dict[str, Any] = {
        "apiKey": api_key,
        "number": number,
        "fillIngredients": "true",
        "addRecipeInformation": "true",
    }
    if query:
        params["query"] = query
    if ingredients:
        params["includeIngredients"] = ingredients
    if exclude_ingredients:
        params["excludeIngredients"] = exclude_ingredients
    if diet:
        params["diet"] = diet
    if intolerances:
        params["intolerances"] = intolerances
    if cuisine:
        params["cuisine"] = cuisine
    if max_ready_time > 0:
        params["maxReadyTime"] = max_ready_time

    url = f"{SPOONACULAR_BASE}/recipes/complexSearch?{urllib.parse.urlencode(params)}"
    fallback_used = None

    try:
        data = await _fetch_json(url)
        results_raw = data.get("results", []) if isinstance(data, dict) else []
    except SpoonacularError as e:
        results_raw = []

    # Fallback chain
    if not results_raw and ingredients:
        fallback_used = "findByIngredients"
        try:
            results_raw = await _find_by_ingredients_raw(ingredients, number)
        except SpoonacularError:
            results_raw = []

    if not results_raw:
        fallback_used = "random"
        try:
            results_raw = await _get_random_fallback(number)
        except SpoonacularError:
            results_raw = []

    if not results_raw:
        return {"status": "error", "message": "No recipes found after all search strategies."}

    pantry_list = [i.strip().lower() for i in ingredients.split(",") if i.strip()] if ingredients else []

    recipes = []
    for raw in results_raw:
        scores = _compute_scores(
            raw, pantry_list,
            user_target_time=max_ready_time,
            user_diet=diet,
            user_intolerances=intolerances,
            user_cuisine=cuisine,
        )
        recipes.append(_normalize_recipe(raw, scores))

    recipes.sort(key=lambda r: r["scores"]["final_score"], reverse=True)

    return {
        "status": "success",
        "count": len(recipes),
        "fallback_used": fallback_used,
        "meals": recipes,
    }


async def get_top_3_meals(
    ingredients: str,
    number: int = 3,
    pantry_ingredients: str = "",
    tool_context: Any = None,
) -> Dict[str, Any]:
    """
    Get the top N meals with the most used ingredients from Spoonacular.
    Results are scored and sorted by final_score.
    """
    try:
        raw_list = await _find_by_ingredients_raw(ingredients, max(number * 3, 10))
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    if not raw_list:
        return {"status": "error", "message": "No meals found with the given ingredients."}

    pantry_list = [i.strip().lower() for i in ingredients.split(",") if i.strip()]

    scored = []
    for meal in raw_list:
        scores = _compute_scores(meal, pantry_list)
        scored.append(_normalize_recipe(meal, scores))

    scored.sort(key=lambda r: r["scores"]["final_score"], reverse=True)
    top_meals = scored[:number]

    # Backward-compatible format: also include legacy keys
    results = []
    for meal in top_meals:
        entry = {
            "idMeal": meal["id"],
            "strMeal": meal["title"],
            "strMealThumb": meal["image"],
            "usedIngredientCount": meal["usedIngredientCount"],
            "missedIngredientCount": meal["missedIngredientCount"],
            "usedIngredients": meal["usedIngredients"],
            "missedIngredients": meal["missedIngredients"],
            "readyInMinutes": meal["readyInMinutes"],
            "diets": meal["diets"],
            "cuisines": meal["cuisines"],
            "scores": meal["scores"],
        }
        results.append(entry)

    return {"status": "success", "count": len(results), "meals": results}


async def search_meals(
    ingredient: Optional[str] = None,
    category: Optional[str] = None,
    area: Optional[str] = None,
    max_ready_time: int = 0,
    intolerances: str = "",
    number: int = 5,
    tool_context: Any = None,
) -> Dict[str, Any]:
    """
    Search for meals online using the Spoonacular API based on ingredients, diet, and cuisine.
    When diet or cuisine filters are provided, uses complexSearch for accurate filtering.
    """
    if not ingredient:
        return {"status": "error", "message": "Please provide some ingredients to search for."}

    if category or area or max_ready_time or intolerances:
        return await complex_search(
            ingredients=ingredient,
            diet=category or "",
            cuisine=area or "",
            max_ready_time=max_ready_time,
            intolerances=intolerances,
            number=number,
            tool_context=tool_context,
        )

    return await get_top_3_meals(ingredient)


async def get_meal_details(
    meal_id: str,
    tool_context: Any = None,
) -> Dict[str, Any]:
    """
    Lookup full meal details by ID (ingredients, instructions, analyzed steps) using Spoonacular.
    """
    if not meal_id:
        return {"status": "error", "message": "meal_id is required"}

    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    params = {"apiKey": api_key}
    encoded_params = urllib.parse.urlencode(params)
    info_url = f"{SPOONACULAR_BASE}/recipes/{meal_id}/information?{encoded_params}"
    instructions_url = f"{SPOONACULAR_BASE}/recipes/{meal_id}/analyzedInstructions?{encoded_params}"

    try:
        data, analyzed = await asyncio.gather(
            _fetch_json(info_url),
            _fetch_json(instructions_url),
        )
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    if not isinstance(data, dict) or not data:
        return {"status": "error", "message": f"No meal found for id={meal_id}"}

    meal = data
    ingredients = [
        {"ingredient": ing.get("name"), "measure": f"{ing.get('amount')} {ing.get('unit')}"}
        for ing in meal.get("extendedIngredients", [])
    ]

    return {
        "status": "success",
        "meal": {
            "idMeal": str(meal.get("id")),
            "name": meal.get("title"),
            "instructions": (meal.get("instructions") or "").strip(),
            "ingredients": ingredients,
            "analyzedInstructions": analyzed if isinstance(analyzed, list) else [],
            "readyInMinutes": meal.get("readyInMinutes", 0),
            "servings": meal.get("servings", 0),
            "diets": meal.get("diets", []),
            "cuisines": meal.get("cuisines", []),
            "sourceUrl": meal.get("sourceUrl", ""),
        },
    }


async def get_random_meal(
    tool_context: Any = None,
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


# ── Phase 2: Ingredient Intelligence ───────────────────────────────


async def parse_ingredients(
    ingredient_list: str,
    servings: int = 1,
    tool_context: Any = None,
) -> Dict[str, Any]:
    """
    Parse a list of ingredient strings into structured data (name, amount, unit).
    Pass ingredients as newline-separated text.
    """
    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    url = f"{SPOONACULAR_BASE}/recipes/parseIngredients?apiKey={api_key}"
    form_data = {
        "ingredientList": ingredient_list,
        "servings": str(servings),
        "includeNutrition": "false",
    }

    try:
        data = await _post_form(url, form_data)
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    if not isinstance(data, list):
        return {"status": "error", "message": "Unexpected response from parseIngredients"}

    parsed = []
    for item in data:
        parsed.append({
            "name": item.get("name", ""),
            "amount": item.get("amount", 0),
            "unit": item.get("unit", ""),
            "original": item.get("original", ""),
        })

    return {"status": "success", "count": len(parsed), "ingredients": parsed}


async def convert_amounts(
    ingredient_name: str,
    source_amount: float,
    source_unit: str,
    target_unit: str,
    tool_context: Any = None,
) -> Dict[str, Any]:
    """
    Convert an ingredient amount from one unit to another (e.g., cups to grams).
    """
    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    params = {
        "apiKey": api_key,
        "ingredientName": ingredient_name,
        "sourceAmount": source_amount,
        "sourceUnit": source_unit,
        "targetUnit": target_unit,
    }
    url = f"{SPOONACULAR_BASE}/recipes/convert?{urllib.parse.urlencode(params)}"

    try:
        data = await _fetch_json(url)
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    if not isinstance(data, dict):
        return {"status": "error", "message": "Unexpected response from convert endpoint"}

    return {
        "status": "success",
        "sourceAmount": data.get("sourceAmount"),
        "sourceUnit": data.get("sourceUnit"),
        "targetAmount": data.get("targetAmount"),
        "targetUnit": data.get("targetUnit"),
        "answer": data.get("answer", ""),
    }


async def get_substitutes(
    ingredient_name: str,
    tool_context: Any = None,
) -> Dict[str, Any]:
    """
    Find substitutes for a given ingredient (e.g., what can replace butter?).
    """
    try:
        api_key = _get_api_key()
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    params = {
        "apiKey": api_key,
        "ingredientName": ingredient_name,
    }
    url = f"{SPOONACULAR_BASE}/food/ingredients/substitutes?{urllib.parse.urlencode(params)}"

    try:
        data = await _fetch_json(url)
    except SpoonacularError as e:
        return {"status": "error", "message": str(e)}

    if not isinstance(data, dict):
        return {"status": "error", "message": "Unexpected response from substitutes endpoint"}

    if data.get("status") == "failure":
        return {
            "status": "not_found",
            "message": data.get("message", f"No substitutes found for '{ingredient_name}'."),
        }

    return {
        "status": "success",
        "ingredient": ingredient_name,
        "substitutes": data.get("substitutes", []),
        "message": data.get("message", ""),
    }
