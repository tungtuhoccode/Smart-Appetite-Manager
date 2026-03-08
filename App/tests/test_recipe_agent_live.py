import os
import unittest

from src.recipe_agent import mealdb_tools


class RecipeAgentLiveApiTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        api_key = (os.getenv("SPOONACULAR_API_KEY") or "").strip()
        if not api_key:
            raise unittest.SkipTest(
                "SPOONACULAR_API_KEY is not set. Add it to App/.env or export it before running."
            )

    def _assert_success_or_skip(self, result: dict, context: str) -> None:
        status = result.get("status")
        if status == "success":
            return

        message = str(result.get("message", ""))
        if "Spoonacular HTTP 403" in message or "error code: 1010" in message:
            self.skipTest(
                f"{context}: Spoonacular denied access (403/1010). Check key validity, quota, or IP restrictions. Raw: {result}"
            )
        self.fail(f"{context}: expected success but got {result}")

    async def test_get_top_3_meals_live(self) -> None:
        result = await mealdb_tools.get_top_3_meals("chicken,tomato,garlic")

        self._assert_success_or_skip(result, "get_top_3_meals")
        self.assertGreaterEqual(result.get("count", 0), 1, msg=str(result))
        self.assertLessEqual(result.get("count", 0), 3, msg=str(result))
        self.assertTrue(result.get("meals"), msg=str(result))

        first_meal = result["meals"][0]
        self.assertTrue(first_meal.get("idMeal"), msg=str(first_meal))
        self.assertTrue(first_meal.get("strMeal"), msg=str(first_meal))

    async def test_get_meal_details_live(self) -> None:
        search = await mealdb_tools.get_top_3_meals("salmon,lemon,garlic")
        self._assert_success_or_skip(search, "seed get_top_3_meals")
        self.assertTrue(search.get("meals"), msg=str(search))

        meal_id = search["meals"][0]["idMeal"]
        details = await mealdb_tools.get_meal_details(meal_id)

        self._assert_success_or_skip(details, "get_meal_details")
        meal = details.get("meal") or {}
        self.assertEqual(meal.get("idMeal"), str(meal_id), msg=str(details))
        self.assertTrue(meal.get("name"), msg=str(details))
        self.assertIsInstance(meal.get("ingredients"), list, msg=str(details))

    async def test_get_random_meal_live(self) -> None:
        result = await mealdb_tools.get_random_meal()

        self._assert_success_or_skip(result, "get_random_meal")
        meal = result.get("meal") or {}
        self.assertTrue(meal.get("idMeal"), msg=str(result))
        self.assertTrue(meal.get("name"), msg=str(result))
        self.assertIsInstance(meal.get("ingredients"), list, msg=str(result))


if __name__ == "__main__":
    unittest.main()
