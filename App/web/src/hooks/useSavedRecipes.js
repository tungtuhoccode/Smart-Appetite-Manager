import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const V1_KEY = "saved_recipes_v1";
const V2_KEY = "saved_recipes_v2";

const DEFAULT_CATEGORY = {
  id: "cat_uncategorized",
  name: "Uncategorized",
  color: "gray",
  order: 0,
};

function generateId() {
  return "cat_" + Math.random().toString(36).slice(2, 10);
}

function loadStore() {
  try {
    // Try v2 first
    const v2Raw = localStorage.getItem(V2_KEY);
    if (v2Raw) {
      const parsed = JSON.parse(v2Raw);
      if (parsed.version === 2) return parsed;
    }

    // Migrate from v1
    const v1Raw = localStorage.getItem(V1_KEY);
    if (v1Raw) {
      const v1Recipes = JSON.parse(v1Raw);
      if (Array.isArray(v1Recipes) && v1Recipes.length > 0) {
        const migrated = {
          version: 2,
          categories: [{ ...DEFAULT_CATEGORY }],
          recipes: v1Recipes.map((r) => ({
            ...r,
            categoryId: DEFAULT_CATEGORY.id,
            addedAt: new Date().toISOString(),
          })),
          viewMode: "board",
        };
        localStorage.setItem(V2_KEY, JSON.stringify(migrated));
        localStorage.removeItem(V1_KEY);
        return migrated;
      }
    }
  } catch {
    // fall through
  }

  // Fresh start
  return {
    version: 2,
    categories: [{ ...DEFAULT_CATEGORY }],
    recipes: [],
    viewMode: "board",
  };
}

function persist(store) {
  localStorage.setItem(V2_KEY, JSON.stringify(store));
}

export function useSavedRecipes() {
  const [store, setStore] = useState(loadStore);

  // Persist on every change
  useEffect(() => {
    persist(store);
  }, [store]);

  // --- Backward-compatible flat array ---
  const savedRecipes = store.recipes;

  // --- Categories (ordered) ---
  const categories = useMemo(
    () => [...store.categories].sort((a, b) => a.order - b.order),
    [store.categories]
  );

  // --- Recipes grouped by category ---
  const recipesByCategory = useMemo(() => {
    const map = new Map();
    for (const cat of store.categories) {
      map.set(cat.id, []);
    }
    for (const recipe of store.recipes) {
      const catId = recipe.categoryId || DEFAULT_CATEGORY.id;
      if (!map.has(catId)) {
        map.set(DEFAULT_CATEGORY.id, [
          ...(map.get(DEFAULT_CATEGORY.id) || []),
          recipe,
        ]);
      } else {
        map.get(catId).push(recipe);
      }
    }
    return map;
  }, [store]);

  // --- View mode ---
  const viewMode = store.viewMode || "board";

  const setViewMode = useCallback((mode) => {
    setStore((prev) => ({ ...prev, viewMode: mode }));
  }, []);

  // --- Recipe CRUD (backward-compatible) ---
  const isRecipeSaved = useCallback(
    (recipeId) =>
      store.recipes.some((r) => String(r.id) === String(recipeId)),
    [store.recipes]
  );

  const saveRecipe = useCallback((recipe, categoryId) => {
    setStore((prev) => {
      if (prev.recipes.some((r) => String(r.id) === String(recipe.id)))
        return prev;
      toast.success("Recipe saved", { description: recipe.title });
      return {
        ...prev,
        recipes: [
          ...prev.recipes,
          {
            ...recipe,
            categoryId: categoryId || DEFAULT_CATEGORY.id,
            addedAt: new Date().toISOString(),
          },
        ],
      };
    });
  }, []);

  const removeRecipe = useCallback((recipeId) => {
    setStore((prev) => {
      const next = prev.recipes.filter(
        (r) => String(r.id) !== String(recipeId)
      );
      if (next.length < prev.recipes.length) {
        toast("Recipe removed from saved");
      }
      return { ...prev, recipes: next };
    });
  }, []);

  const toggleSave = useCallback(
    (recipe) => {
      if (isRecipeSaved(recipe.id)) {
        removeRecipe(recipe.id);
      } else {
        saveRecipe(recipe);
      }
    },
    [isRecipeSaved, removeRecipe, saveRecipe]
  );

  // --- Move recipe to category (drag-and-drop) ---
  const moveRecipe = useCallback((recipeId, toCategoryId) => {
    setStore((prev) => ({
      ...prev,
      recipes: prev.recipes.map((r) =>
        String(r.id) === String(recipeId)
          ? { ...r, categoryId: toCategoryId }
          : r
      ),
    }));
  }, []);

  // --- Category CRUD ---
  const addCategory = useCallback((name, color = "orange") => {
    const id = generateId();
    setStore((prev) => {
      const maxOrder = Math.max(0, ...prev.categories.map((c) => c.order));
      return {
        ...prev,
        categories: [
          ...prev.categories,
          { id, name, color, order: maxOrder + 1 },
        ],
      };
    });
    toast.success("Category created", { description: name });
    return id;
  }, []);

  const renameCategory = useCallback((id, name) => {
    if (id === DEFAULT_CATEGORY.id) return;
    setStore((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === id ? { ...c, name } : c
      ),
    }));
    toast.success("Category renamed");
  }, []);

  const deleteCategory = useCallback((id) => {
    if (id === DEFAULT_CATEGORY.id) return;
    setStore((prev) => ({
      ...prev,
      categories: prev.categories.filter((c) => c.id !== id),
      recipes: prev.recipes.map((r) =>
        r.categoryId === id
          ? { ...r, categoryId: DEFAULT_CATEGORY.id }
          : r
      ),
    }));
    toast("Category deleted, recipes moved to Uncategorized");
  }, []);

  const updateCategoryColor = useCallback((id, color) => {
    if (id === DEFAULT_CATEGORY.id) return;
    setStore((prev) => ({
      ...prev,
      categories: prev.categories.map((c) =>
        c.id === id ? { ...c, color } : c
      ),
    }));
  }, []);

  return {
    // Backward-compatible
    savedRecipes,
    saveRecipe,
    removeRecipe,
    isRecipeSaved,
    toggleSave,
    count: savedRecipes.length,
    // New: categories
    categories,
    recipesByCategory,
    addCategory,
    renameCategory,
    deleteCategory,
    updateCategoryColor,
    // New: move
    moveRecipe,
    // New: view mode
    viewMode,
    setViewMode,
  };
}
