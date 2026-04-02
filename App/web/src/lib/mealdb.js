/**
 * MealDB API client and recipe normalization utilities.
 * Extracted from RecipeDiscoveryPage for reuse and testability.
 */

import { tryParseJSON, extractRecipeData } from "./parseResponse";

const MEALDB_BASE_URL = "https://www.themealdb.com/api/json/v1/1";
export const BEST_CACHE_KEY = "recipe_best_inventory_cache_v1";

// ── Text normalization helpers ──────────────────────────────────────

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeInventoryRows(rows) {
  return rows
    .map((row) => {
      const name = String(row.product_name || row.name || "").trim();
      const quantity = String(row.quantity ?? "").trim();
      const unit = String(row.quantity_unit || row.unit || "").trim();
      return { name, quantity, unit };
    })
    .filter((row) => row.name);
}

export function inventoryFingerprint(rows) {
  const stable = [...rows]
    .map(
      (row) =>
        `${normalizeText(row.name)}|${normalizeText(row.quantity)}|${normalizeText(row.unit)}`
    )
    .sort();
  return stable.join("||");
}

// ── Cache helpers ───────────────────────────────────────────────────

export function readBestCache() {
  try {
    const raw = localStorage.getItem(BEST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.recipes) ||
      typeof parsed.inventoryFingerprint !== "string" ||
      typeof parsed.generatedAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeBestCache(payload) {
  const record = {
    version: 1,
    generatedAt: payload.generatedAt,
    inventoryFingerprint: payload.inventoryFingerprint,
    inventorySnapshot: payload.inventorySnapshot,
    recipes: payload.recipes,
  };
  localStorage.setItem(BEST_CACHE_KEY, JSON.stringify(record));
}

// ── Agent response normalization ────────────────────────────────────

function normalizeIngredientValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.name || value.ingredient || value.item || "").trim();
  }
  return "";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeAgentRecipeList(responseText) {
  // First try extracting from ```recipe_data fenced blocks (agent FRONTEND MODE)
  const { recipes: recipeDataBlock } = extractRecipeData(responseText);

  // Then try generic JSON parsing (```json or raw JSON)
  const parsed = recipeDataBlock ?? tryParseJSON(responseText);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.recipes)
      ? parsed.recipes
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];

  return list
    .map((recipe, index) => {
      if (!recipe || typeof recipe !== "object") return null;

      const usedIngredients = Array.isArray(recipe.used_ingredients)
        ? recipe.used_ingredients.map(normalizeIngredientValue).filter(Boolean)
        : Array.isArray(recipe.usedIngredients)
          ? recipe.usedIngredients.map(normalizeIngredientValue).filter(Boolean)
          : [];

      const missingIngredients = Array.isArray(recipe.missing_ingredients)
        ? recipe.missing_ingredients.map(normalizeIngredientValue).filter(Boolean)
        : Array.isArray(recipe.missingIngredients)
          ? recipe.missingIngredients.map(normalizeIngredientValue).filter(Boolean)
          : Array.isArray(recipe.missedIngredients)
            ? recipe.missedIngredients.map(normalizeIngredientValue).filter(Boolean)
            : [];

      const title = String(recipe.title || recipe.name || "").trim();
      if (!title) return null;

      const explicitUsedCount =
        numberOrNull(recipe.used_ingredients_count) ??
        numberOrNull(recipe.usedIngredientsCount) ??
        numberOrNull(recipe.used_count) ??
        numberOrNull(recipe.available_ingredients_count) ??
        numberOrNull(recipe.availableIngredientsCount) ??
        numberOrNull(recipe.available_count);

      const explicitMissingCount =
        numberOrNull(recipe.missing_ingredients_count) ??
        numberOrNull(recipe.missingIngredientsCount) ??
        numberOrNull(recipe.missing_count) ??
        numberOrNull(recipe.missed_ingredients_count) ??
        numberOrNull(recipe.missedIngredientsCount);

      const scores = recipe.scores && typeof recipe.scores === "object"
        ? {
            final_score: typeof recipe.scores.final_score === "number" ? recipe.scores.final_score : null,
            pantry_coverage_score: typeof recipe.scores.pantry_coverage_score === "number" ? recipe.scores.pantry_coverage_score : null,
            prep_time_score: typeof recipe.scores.prep_time_score === "number" ? recipe.scores.prep_time_score : null,
            preference_match_score: typeof recipe.scores.preference_match_score === "number" ? recipe.scores.preference_match_score : null,
            missing_ingredient_count: typeof recipe.scores.missing_ingredient_count === "number" ? recipe.scores.missing_ingredient_count : null,
            explanation: String(recipe.scores.explanation || "").trim(),
          }
        : null;

      // Extract full ingredients list (structured) if available
      const rawIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
      const ingredients = rawIngredients
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (!item || typeof item !== "object") return "";
          const name = String(item.name || item.ingredient || "").trim();
          const measure = String(item.measure || item.amount || "").trim();
          return `${measure ? `${measure} ` : ""}${name}`.trim();
        })
        .filter(Boolean);

      return {
        id: String(recipe.id || recipe.recipe_id || `agent-recipe-${index}`),
        title,
        imageUrl: String(recipe.image_url || recipe.image || "").trim(),
        summary: String(
          recipe.summary ||
            recipe.description ||
            `${usedIngredients.length} pantry ingredients available`
        ).trim(),
        usedIngredients,
        missingIngredients,
        usedIngredientCount: explicitUsedCount ?? usedIngredients.length,
        missingIngredientCount: explicitMissingCount ?? missingIngredients.length,
        readyInMinutes: numberOrNull(recipe.readyInMinutes) ?? numberOrNull(recipe.ready_in_minutes),
        servings: numberOrNull(recipe.servings),
        diets: Array.isArray(recipe.diets) ? recipe.diets : [],
        cuisines: Array.isArray(recipe.cuisines) ? recipe.cuisines : [],
        scores,
        ingredients,
        instructions: typeof recipe.instructions === "string" ? recipe.instructions.trim() : "",
        sourceUrl: String(recipe.source_url || recipe.sourceUrl || "").trim(),
        provider: "agent",
      };
    })
    .filter(Boolean);
}

/**
 * Parse recipes from a markdown-formatted agent response.
 * Used as a last-resort fallback when the agent omits the recipe_data block
 * but still produces a numbered list with **Title** and ![alt](imageUrl) markers.
 * Spoonacular image URLs embed the recipe ID, so we can reconstruct minimal cards.
 */
export function parseMarkdownRecipeList(text) {
  if (!text || typeof text !== "string") return [];

  // Split at each \n immediately before a numbered list item (delimiter consumed).
  // Each section then starts with "N. **Title**".
  const sections = text.split(/\n(?=\d+\.\s)/);
  const recipes = [];

  for (const section of sections) {
    const titleMatch = section.match(/^\d+\.\s+\*\*([^*\n]+)\*\*/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();

    // Image URL is optional — recipes without images still get a card
    const imageMatch = section.match(/!\[[^\]]*\]\((https?:[^)]+)\)/);
    const imageUrl = imageMatch ? imageMatch[1].trim() : "";

    const idMatch = imageUrl.match(/\/recipes\/(\d+)\//);
    const id = idMatch ? idMatch[1] : `md-${recipes.length}`;

    const summaryLines = section
      .split("\n")
      .map((l) => l.replace(/^[-*\s]+/, "").replace(/\*\*/g, "").trim())
      .filter((l) => l && !l.match(/^!\[/) && !l.match(/^\d+\.\s/) && l.length > 20)
      .slice(0, 2);
    const summary = summaryLines.join(" ").slice(0, 200) || title;

    const timeMatch = section.match(/(\d+)\s*(?:min|minutes)/i);

    recipes.push({
      id,
      title,
      imageUrl,
      summary,
      readyInMinutes: timeMatch ? parseInt(timeMatch[1]) : null,
      servings: null,
      diets: [],
      cuisines: [],
      usedIngredients: [],
      missingIngredients: [],
      usedIngredientCount: 0,
      missingIngredientCount: 0,
      ingredients: [],
      instructions: "",
      sourceUrl: "",
      provider: "agent",
      scores: null,
    });
  }

  return recipes;
}

export function normalizeAgentRecipeDetails(responseText, fallbackRecipe) {
  const parsed = tryParseJSON(responseText);
  const source =
    parsed && typeof parsed === "object"
      ? Array.isArray(parsed)
        ? parsed[0] || {}
        : parsed
      : {};

  const ingredients = Array.isArray(source.ingredients)
    ? source.ingredients
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (!item || typeof item !== "object") return "";
          const name = String(item.name || item.ingredient || "").trim();
          const measure = String(item.measure || item.amount || "").trim();
          return `${measure ? `${measure} ` : ""}${name}`.trim();
        })
        .filter(Boolean)
    : [];

  return {
    title: String(source.title || fallbackRecipe?.title || "Recipe details").trim(),
    imageUrl: String(
      source.image_url || source.image || fallbackRecipe?.imageUrl || ""
    ).trim(),
    ingredients,
    instructions: String(
      source.instructions ||
        responseText ||
        "No detailed instructions were returned."
    ).trim(),
    sourceUrl: String(
      source.source_url || source.sourceUrl || fallbackRecipe?.sourceUrl || ""
    ).trim(),
  };
}

// ── MealDB API ──────────────────────────────────────────────────────

async function fetchMealDb(pathname, params = {}) {
  const url = new URL(`${MEALDB_BASE_URL}/${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`MealDB request failed (${response.status})`);
  }
  return response.json();
}

export function extractMealIngredients(meal) {
  const ingredients = [];
  for (let index = 1; index <= 20; index += 1) {
    const name = String(meal?.[`strIngredient${index}`] || "").trim();
    const measure = String(meal?.[`strMeasure${index}`] || "").trim();
    if (!name) continue;
    ingredients.push({
      name,
      measure,
      display: `${measure ? `${measure} ` : ""}${name}`.trim(),
    });
  }
  return ingredients;
}

export function toRecipeCard(meal, pantrySet = new Set()) {
  if (!meal || !meal.idMeal || !meal.strMeal) return null;

  const ingredients = extractMealIngredients(meal);
  const ingredientNames = ingredients.map((item) => item.name);
  const usedIngredients = ingredientNames.filter((name) =>
    pantrySet.has(normalizeText(name))
  );
  const missingIngredients = ingredientNames.filter(
    (name) => !pantrySet.has(normalizeText(name))
  );

  const summary = ingredients.length
    ? `${usedIngredients.length} of ${ingredients.length} ingredients already in pantry`
    : "Tap to view full recipe details";

  return {
    id: String(meal.idMeal),
    title: String(meal.strMeal),
    imageUrl: meal.strMealThumb || "",
    summary,
    usedIngredients,
    missingIngredients,
    usedIngredientCount: usedIngredients.length,
    missingIngredientCount: missingIngredients.length,
    sourceUrl: meal.strSource || meal.strYoutube || "",
    youtubeUrl: meal.strYoutube || "",
    provider: "mealdb",
  };
}

export function toRecipeDetails(meal, fallbackRecipe) {
  const ingredients = extractMealIngredients(meal);
  return {
    title: String(meal?.strMeal || fallbackRecipe?.title || "Recipe details"),
    imageUrl: meal?.strMealThumb || fallbackRecipe?.imageUrl || "",
    ingredients: ingredients.map((item) => item.display),
    instructions: String(
      meal?.strInstructions || "No detailed instructions were returned."
    ),
    sourceUrl:
      meal?.strSource || meal?.strYoutube || fallbackRecipe?.sourceUrl || "",
    youtubeUrl: meal?.strYoutube || fallbackRecipe?.youtubeUrl || "",
  };
}

export async function getMealById(id) {
  const payload = await fetchMealDb("lookup.php", { i: id });
  return Array.isArray(payload?.meals) && payload.meals.length
    ? payload.meals[0]
    : null;
}

export async function getRandomMeal() {
  const payload = await fetchMealDb("random.php");
  return Array.isArray(payload?.meals) && payload.meals.length
    ? payload.meals[0]
    : null;
}

export async function searchMealsByName(query) {
  const payload = await fetchMealDb("search.php", { s: query });
  return Array.isArray(payload?.meals) ? payload.meals : [];
}

export async function filterMealsByIngredient(ingredient) {
  const payload = await fetchMealDb("filter.php", { i: ingredient });
  return Array.isArray(payload?.meals) ? payload.meals : [];
}
