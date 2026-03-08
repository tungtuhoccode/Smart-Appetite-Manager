#!/usr/bin/env python3
"""Quick smoke test to verify the Spoonacular API key works and endpoints respond."""

import asyncio
import os
import sys
from pathlib import Path

# Allow running from App/ directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

# Load .env from App/
env_path = Path(__file__).resolve().parents[1] / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

from src.recipe_agent.mealdb_tools import (
    get_meal_details,
    get_random_meal,
    get_top_3_meals,
)

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
SKIP = "\033[93mSKIP\033[0m"


def check(label: str, result: dict) -> bool:
    status = result.get("status")
    if status == "success":
        print(f"  [{PASS}] {label}")
        return True

    msg = result.get("message", "")
    if "402" in str(msg):
        print(f"  [{FAIL}] {label} — API key valid but quota exceeded (HTTP 402)")
    elif "401" in str(msg):
        print(f"  [{FAIL}] {label} — Invalid API key (HTTP 401)")
    elif "403" in str(msg):
        print(f"  [{FAIL}] {label} — Access denied (HTTP 403). Check key permissions.")
    else:
        print(f"  [{FAIL}] {label} — {msg}")
    return False


async def main() -> int:
    key = (os.environ.get("SPOONACULAR_API_KEY") or "").strip()
    if not key:
        print(f"[{FAIL}] SPOONACULAR_API_KEY is not set. Add it to App/.env or export it.")
        return 1

    print(f"API key found: {key[:4]}...{key[-4:]}")
    print()

    passed = 0
    failed = 0

    # 1. Search by ingredients
    print("1) GET /recipes/findByIngredients (get_top_3_meals)")
    r = await get_top_3_meals("chicken,tomato,garlic")
    if check("Search by ingredients", r):
        passed += 1
        meals = r.get("meals", [])
        print(f"     Returned {len(meals)} meal(s): {[m['strMeal'] for m in meals]}")
        meal_id = meals[0]["idMeal"] if meals else None
    else:
        failed += 1
        meal_id = None

    print()

    # 2. Get meal details
    print("2) GET /recipes/{id}/information (get_meal_details)")
    if meal_id:
        r = await get_meal_details(meal_id)
        if check("Meal details", r):
            passed += 1
            meal = r.get("meal", {})
            print(f"     Name: {meal.get('name')}")
            print(f"     Ingredients: {len(meal.get('ingredients', []))} items")
            has_instructions = bool(meal.get("instructions"))
            print(f"     Instructions: {'yes' if has_instructions else 'none'}")
        else:
            failed += 1
    else:
        print(f"  [{SKIP}] Skipped — no meal_id from previous step")

    print()

    # 3. Random meal
    print("3) GET /recipes/random (get_random_meal)")
    r = await get_random_meal()
    if check("Random meal", r):
        passed += 1
        meal = r.get("meal", {})
        print(f"     Name: {meal.get('name')}")
    else:
        failed += 1

    print()
    print(f"Results: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))