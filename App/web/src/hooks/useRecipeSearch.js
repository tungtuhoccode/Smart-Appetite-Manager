import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  normalizeText,
  searchMealsByName,
  filterMealsByIngredient,
  getMealById,
  toRecipeCard,
} from "@/lib/mealdb";

/**
 * Hook for searching MealDB recipes by name or ingredient.
 *
 * @param {string[]} inventoryNames - Current pantry ingredient names
 */
export function useRecipeSearch(inventoryNames) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [results, setResults] = useState([]);

  const search = useCallback(
    async (searchText) => {
      const trimmed = (searchText ?? query).trim();
      if (!trimmed) return;

      setSearching(true);
      setSearchError(null);

      try {
        let meals = await searchMealsByName(trimmed);

        if (!meals.length) {
          const filtered = await filterMealsByIngredient(trimmed);
          meals = await Promise.all(
            filtered
              .slice(0, 10)
              .map((meal) => getMealById(meal.idMeal).catch(() => null))
          );
          meals = meals.filter(Boolean);
        }

        if (!meals.length) {
          throw new Error("No recipes found. Try a different keyword.");
        }

        const pantrySet = new Set(inventoryNames.map(normalizeText));
        const normalized = meals
          .map((meal) => toRecipeCard(meal, pantrySet))
          .filter(Boolean)
          .slice(0, 12);

        setResults(normalized);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSearchError(message);
        toast.error("Recipe search failed", { description: message });
      } finally {
        setSearching(false);
      }
    },
    [inventoryNames, query]
  );

  return {
    query,
    setQuery,
    searching,
    searchError,
    results,
    setResults,
    search,
  };
}
