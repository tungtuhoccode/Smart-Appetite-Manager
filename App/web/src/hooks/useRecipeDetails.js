import { useCallback, useState } from "react";
import { AGENTS } from "@/api/agents";
import {
  getMealById,
  normalizeAgentRecipeDetails,
  toRecipeDetails,
} from "@/lib/mealdb";

/**
 * Hook for loading detailed recipe information (MealDB or agent-sourced).
 *
 * @param {import("@/api/gateway").GatewayClient} client
 * @param {string} sessionKey - localStorage key for session persistence
 */
export function useRecipeDetails(client, sessionKey) {
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const open = useCallback(
    async (recipe) => {
      setSelectedRecipe(recipe);
      setDetails(null);
      setError(null);

      try {
        // Agent recipes always use card data directly — never re-fetch.
        // The card already has every field the dialog needs from the recipe_data JSON block.
        // Re-fetching by ID risks returning the wrong dish entirely.
        if (recipe.provider === "agent") {
          setDetails({
            title: recipe.title,
            imageUrl: recipe.imageUrl || "",
            ingredients: recipe.ingredients,
            instructions: recipe.instructions,
            sourceUrl: recipe.sourceUrl || "",
            usedIngredients: recipe.usedIngredients || [],
            missingIngredients: recipe.missingIngredients || [],
            readyInMinutes: recipe.readyInMinutes || 0,
            servings: recipe.servings || 0,
            diets: recipe.diets || [],
            cuisines: recipe.cuisines || [],
            scores: recipe.scores || null,
          });
          return;
        }

        setLoading(true);

        if (recipe.provider === "agent") {
          // If we have a Spoonacular numeric ID, ask for details by ID for reliability
          const hasNumericId = recipe.id && /^\d+$/.test(String(recipe.id));
          const prompt = hasNumericId
            ? `Get the full recipe details for meal ID ${recipe.id} using get_meal_details. Return ONLY JSON with fields: title, ingredients (array of {name, measure}), instructions, image_url, source_url.`
            : `Provide full details for this recipe: "${recipe.title}". Return ONLY JSON with fields: title, ingredients (array of {name, measure}), instructions, image_url, source_url.`;
          const response = await client.send(prompt, AGENTS.RECIPE_GENERAL_SEARCH);
          localStorage.setItem(sessionKey, client.getSessionId());
          const normalized = normalizeAgentRecipeDetails(response.text, recipe);
          setDetails({
            ...normalized,
            imageUrl: recipe.imageUrl || normalized.imageUrl,
            usedIngredients: recipe.usedIngredients || [],
            missingIngredients: recipe.missingIngredients || [],
            readyInMinutes: recipe.readyInMinutes || 0,
            servings: recipe.servings || 0,
            diets: recipe.diets || [],
            cuisines: recipe.cuisines || [],
            scores: recipe.scores || null,
          });
          return;
        }

        const meal = await getMealById(recipe.id);
        if (!meal) {
          throw new Error("Could not load recipe details.");
        }
        setDetails(toRecipeDetails(meal, recipe));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [client, sessionKey]
  );

  const close = useCallback(() => {
    setSelectedRecipe(null);
    setDetails(null);
    setError(null);
  }, []);

  return {
    selectedRecipe,
    details,
    loading,
    error,
    open,
    close,
  };
}
