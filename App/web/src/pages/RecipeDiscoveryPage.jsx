import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inventoryRestApi } from "@/api/inventoryRest";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ChefHatIcon,
  SearchIcon,
  SparklesIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
  XIcon,
  MessageCircleIcon,
  SendIcon,
  MicIcon,
  MicOffIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
} from "lucide-react";

const MEALDB_BASE_URL = "https://www.themealdb.com/api/json/v1/1";
const BEST_CACHE_KEY = "recipe_best_inventory_cache_v1";

const QUICK_TAGS = [
  "Quick dinners",
  "High protein",
  "Comfort food",
  "Vegetarian",
  "One-pot meals",
  "Meal prep",
];

const CHAT_WELCOME_MESSAGE = {
  id: "recipe-chat-welcome",
  role: "assistant",
  text: "Recipe assistant is running in local mode. Ask for search ideas or pantry refresh guidance.",
};

function extractItems(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  const { data, type } = result;
  if (type === "json") {
    if (Array.isArray(data)) return data;
    if (data?.rows && Array.isArray(data.rows)) return data.rows;
    if (data?.data && Array.isArray(data.data)) return data.data;
  }
  if (type === "table" && Array.isArray(data)) return data;
  return [];
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeInventoryRows(rows) {
  return rows
    .map((row) => {
      const name = String(row.product_name || row.name || "").trim();
      const quantity = String(row.quantity ?? "").trim();
      const unit = String(row.quantity_unit || row.unit || "").trim();
      return { name, quantity, unit };
    })
    .filter((row) => row.name);
}

function inventoryFingerprint(rows) {
  const stable = [...rows]
    .map((row) => `${normalizeText(row.name)}|${normalizeText(row.quantity)}|${normalizeText(row.unit)}`)
    .sort();
  return stable.join("||");
}

function readBestCache() {
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

function writeBestCache(payload) {
  const record = {
    version: 1,
    generatedAt: payload.generatedAt,
    inventoryFingerprint: payload.inventoryFingerprint,
    inventorySnapshot: payload.inventorySnapshot,
    recipes: payload.recipes,
  };
  localStorage.setItem(BEST_CACHE_KEY, JSON.stringify(record));
}

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

function extractMealIngredients(meal) {
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

function toRecipeCard(meal, pantrySet = new Set()) {
  if (!meal || !meal.idMeal || !meal.strMeal) return null;

  const ingredients = extractMealIngredients(meal);
  const ingredientNames = ingredients.map((item) => item.name);
  const usedIngredients = ingredientNames.filter((name) => pantrySet.has(normalizeText(name)));
  const missingIngredients = ingredientNames.filter((name) => !pantrySet.has(normalizeText(name)));

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
    sourceUrl: meal.strSource || meal.strYoutube || "",
  };
}

function toRecipeDetails(meal, fallbackRecipe) {
  const ingredients = extractMealIngredients(meal);
  return {
    title: String(meal?.strMeal || fallbackRecipe?.title || "Recipe details"),
    imageUrl: meal?.strMealThumb || fallbackRecipe?.imageUrl || "",
    ingredients: ingredients.map((item) => item.display),
    instructions: String(meal?.strInstructions || "No detailed instructions were returned."),
    sourceUrl: meal?.strSource || meal?.strYoutube || fallbackRecipe?.sourceUrl || "",
  };
}

async function getMealById(id) {
  const payload = await fetchMealDb("lookup.php", { i: id });
  return Array.isArray(payload?.meals) && payload.meals.length ? payload.meals[0] : null;
}

async function getRandomMeal() {
  const payload = await fetchMealDb("random.php");
  return Array.isArray(payload?.meals) && payload.meals.length ? payload.meals[0] : null;
}

async function searchMealsByName(query) {
  const payload = await fetchMealDb("search.php", { s: query });
  return Array.isArray(payload?.meals) ? payload.meals : [];
}

async function filterMealsByIngredient(ingredient) {
  const payload = await fetchMealDb("filter.php", { i: ingredient });
  return Array.isArray(payload?.meals) ? payload.meals : [];
}

async function findBestFromInventory(ingredientNames) {
  const normalizedNames = [...new Set(ingredientNames.map(normalizeText).filter(Boolean))];
  if (!normalizedNames.length) return [];

  const seedIngredients = normalizedNames.slice(0, 8);
  const pantrySet = new Set(normalizedNames);

  const resultSets = await Promise.all(
    seedIngredients.map((ingredient) =>
      filterMealsByIngredient(ingredient).catch(() => [])
    )
  );

  const scoreMap = new Map();
  resultSets.forEach((meals) => {
    meals.forEach((meal) => {
      if (!meal?.idMeal) return;
      const current = scoreMap.get(meal.idMeal) || { meal, score: 0 };
      current.score += 1;
      scoreMap.set(meal.idMeal, current);
    });
  });

  const ranked = [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const detailedMeals = await Promise.all(
    ranked.map(async ({ meal, score }) => {
      const detail = await getMealById(meal.idMeal).catch(() => null);
      return { meal: detail || meal, score };
    })
  );

  return detailedMeals
    .map(({ meal, score }) => {
      const card = toRecipeCard(meal, pantrySet);
      if (!card) return null;
      return { ...card, matchScore: score };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.usedIngredients.length !== b.usedIngredients.length) {
        return b.usedIngredients.length - a.usedIngredients.length;
      }
      return (b.matchScore || 0) - (a.matchScore || 0);
    })
    .slice(0, 3)
    .map(({ matchScore, ...recipe }) => recipe);
}

function useSpeechRecognition(onResult) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const supported =
    typeof window !== "undefined" &&
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition);

  const toggle = useCallback(() => {
    if (!supported) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
      setListening(false);
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, onResult, supported]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // no-op
        }
      }
    };
  }, []);

  return { listening, toggle, supported };
}

function AssistantAvatar() {
  return (
    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-md">
      <ChefHatIcon className="w-5 h-5 text-white" />
    </div>
  );
}

function RecipeAssistantPanel({
  open,
  onClose,
  messages,
  input,
  sending,
  onInputChange,
  onSend,
}) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const handleDictation = useCallback(
    (transcript) => {
      onInputChange((prev) => (prev ? `${prev} ${transcript}` : transcript));
    },
    [onInputChange]
  );

  const { listening, toggle: toggleMic, supported: micSupported } = useSpeechRecognition(handleDictation);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/10 sm:hidden" onClick={onClose} />}

      <div
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[420px] bg-background border-l shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-3 px-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
          <AssistantAvatar />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground leading-tight">Recipe Assistant</h2>
            <p className="text-xs text-muted-foreground truncate leading-tight">
              Local helper mode for search and pantry refresh hints.
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {message.role === "assistant" && <AssistantAvatar />}
              <div
                className={`max-w-[84%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted/60 border rounded-bl-md"
                }`}
              >
                {message.text}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex gap-2 items-end">
              <AssistantAvatar />
              <div className="bg-muted/60 border rounded-2xl rounded-bl-md px-4 py-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3 bg-background">
          <div className="flex items-end gap-2">
            {micSupported && (
              <Button
                variant={listening ? "destructive" : "ghost"}
                size="icon"
                onClick={toggleMic}
                disabled={sending}
                title={listening ? "Stop dictation" : "Start dictation"}
                className="shrink-0"
              >
                {listening ? <MicOffIcon className="w-4 h-4" /> : <MicIcon className="w-4 h-4" />}
              </Button>
            )}
            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                className="flex min-h-[44px] max-h-[200px] w-full rounded-xl border border-input bg-muted/30 px-3 py-2.5 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-y-auto"
                style={{ fieldSizing: "content" }}
                placeholder={listening ? "Listening..." : "Try: show quick chicken recipes"}
                value={input}
                onChange={(e) => {
                  onInputChange(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                disabled={sending}
                rows={1}
              />
            </div>
            <Button size="icon" onClick={onSend} disabled={sending || !input.trim()} className="shrink-0 rounded-xl">
              <SendIcon className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
            Press Enter to send{micSupported ? " · Click mic to dictate" : ""}
          </p>
        </div>
      </div>
    </>
  );
}

function RecipeCard({ recipe, onView }) {
  return (
    <Card className="overflow-hidden border-orange-100/80 bg-white/90 shadow-sm">
      {recipe.imageUrl ? (
        <img src={recipe.imageUrl} alt={recipe.title} className="h-36 w-full object-cover" loading="lazy" />
      ) : (
        <div className="h-36 w-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
          <ChefHatIcon className="h-8 w-8 text-orange-500" />
        </div>
      )}

      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold leading-tight">{recipe.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{recipe.summary}</p>
        </div>

        <div className="flex flex-wrap gap-1.5 min-h-6">
          {recipe.usedIngredients.slice(0, 2).map((ingredient) => (
            <Badge key={`used-${recipe.id}-${ingredient}`} variant="secondary">
              {ingredient}
            </Badge>
          ))}
          {recipe.missingIngredients.slice(0, 2).map((ingredient) => (
            <Badge key={`missing-${recipe.id}-${ingredient}`} variant="outline">
              Missing: {ingredient}
            </Badge>
          ))}
        </div>

        <Button className="w-full" variant="outline" onClick={() => onView(recipe)}>
          View Recipe
        </Button>
      </CardContent>
    </Card>
  );
}

export default function RecipeDiscoveryPage() {
  const [inventorySuggestions, setInventorySuggestions] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryChecking, setInventoryChecking] = useState(false);
  const [inventoryError, setInventoryError] = useState(null);
  const [inventoryLastUpdated, setInventoryLastUpdated] = useState(null);
  const [inventoryItemCount, setInventoryItemCount] = useState(0);
  const [inventoryNames, setInventoryNames] = useState([]);
  const [inventoryFreshness, setInventoryFreshness] = useState("no_cache");
  const [cachedFingerprint, setCachedFingerprint] = useState("");

  const [featuredRecipe, setFeaturedRecipe] = useState(null);
  const [featuredLoading, setFeaturedLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [recipeResults, setRecipeResults] = useState([]);

  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [recipeDetails, setRecipeDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([CHAT_WELCOME_MESSAGE]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const msgIdRef = useRef(1);

  useEffect(() => {
    const className = "inventory-chat-open";
    if (chatOpen) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }

    return () => {
      document.body.classList.remove(className);
    };
  }, [chatOpen]);

  const fetchCurrentInventory = useCallback(async () => {
    const result = await inventoryRestApi.list();
    const rows = normalizeInventoryRows(extractItems(result));
    return rows;
  }, []);

  const refreshInventoryFreshness = useCallback(async () => {
    setInventoryChecking(true);

    const cached = readBestCache();
    if (cached?.recipes?.length) {
      setInventorySuggestions(cached.recipes);
      setInventoryLastUpdated(cached.generatedAt ? new Date(cached.generatedAt) : null);
      setCachedFingerprint(cached.inventoryFingerprint || "");
    }

    try {
      const rows = await fetchCurrentInventory();
      const names = rows.map((row) => row.name);
      setInventoryItemCount(rows.length);
      setInventoryNames(names);

      const fingerprint = inventoryFingerprint(rows);

      if (!cached?.recipes?.length) {
        setInventoryFreshness("no_cache");
      } else if (cached.inventoryFingerprint === fingerprint) {
        setInventoryFreshness("fresh");
      } else {
        setInventoryFreshness("stale");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInventoryError(message);
      if (cached?.recipes?.length) {
        setInventoryFreshness("unknown");
      }
    } finally {
      setInventoryChecking(false);
    }
  }, [fetchCurrentInventory]);

  const fetchFeaturedRecipe = useCallback(async () => {
    setFeaturedLoading(true);
    try {
      const meal = await getRandomMeal();
      const card = toRecipeCard(meal || {}, new Set());
      setFeaturedRecipe(
        card || {
          id: "featured-fallback",
          title: "Featured recipe",
          imageUrl: "",
          summary: "Could not load featured recipe.",
          usedIngredients: [],
          missingIngredients: [],
          sourceUrl: "",
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Could not load featured recipe", { description: message });
    } finally {
      setFeaturedLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeaturedRecipe();
    void refreshInventoryFreshness();
  }, [fetchFeaturedRecipe, refreshInventoryFreshness]);

  useEffect(() => {
    const onFocus = () => {
      void refreshInventoryFreshness();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshInventoryFreshness]);

  const generateInventorySuggestions = useCallback(async () => {
    setInventoryLoading(true);
    setInventoryError(null);

    try {
      const rows = await fetchCurrentInventory();
      const names = rows.map((row) => row.name);
      setInventoryItemCount(rows.length);
      setInventoryNames(names);

      if (!rows.length) {
        setInventorySuggestions([]);
        setCachedFingerprint("");
        setInventoryFreshness("no_cache");
        setInventoryLastUpdated(null);
        localStorage.removeItem(BEST_CACHE_KEY);
        return;
      }

      const fingerprint = inventoryFingerprint(rows);
      const recipes = await findBestFromInventory(names);
      if (!recipes.length) {
        throw new Error("No matching recipes found for your pantry.");
      }

      const generatedAt = new Date().toISOString();
      setInventorySuggestions(recipes);
      setInventoryFreshness("fresh");
      setCachedFingerprint(fingerprint);
      setInventoryLastUpdated(new Date(generatedAt));
      setRecipeResults((prev) => (prev.length ? prev : recipes));

      writeBestCache({
        recipes,
        generatedAt,
        inventoryFingerprint: fingerprint,
        inventorySnapshot: rows,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInventoryError(message);
      toast.error("Could not generate pantry recommendations", { description: message });
    } finally {
      setInventoryLoading(false);
    }
  }, [fetchCurrentInventory]);

  const runRecipeSearch = useCallback(
    async (query) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      setSearching(true);
      setSearchError(null);

      try {
        let meals = await searchMealsByName(trimmed);

        if (!meals.length) {
          const filtered = await filterMealsByIngredient(trimmed);
          meals = await Promise.all(
            filtered.slice(0, 10).map((meal) => getMealById(meal.idMeal).catch(() => null))
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

        setRecipeResults(normalized);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSearchError(message);
        toast.error("Recipe search failed", { description: message });
      } finally {
        setSearching(false);
      }
    },
    [inventoryNames]
  );

  const openRecipeDetails = useCallback(async (recipe) => {
    setSelectedRecipe(recipe);
    setRecipeDetails(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const meal = await getMealById(recipe.id);
      if (!meal) {
        throw new Error("Could not load recipe details.");
      }
      setRecipeDetails(toRecipeDetails(meal, recipe));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDetailError(message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const sendChat = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatSending) return;

    const promptLower = prompt.toLowerCase();

    setChatMessages((prev) => [
      ...prev,
      {
        id: `recipe-chat-user-${msgIdRef.current++}`,
        role: "user",
        text: prompt,
      },
    ]);
    setChatInput("");
    setChatSending(true);

    let reply = "Try searching in the main bar above, or use quick tags for instant recipe results.";

    if (promptLower.includes("inventory") || promptLower.includes("pantry") || promptLower.includes("best")) {
      if (inventorySuggestions.length) {
        const titles = inventorySuggestions.map((recipe) => `- ${recipe.title}`).join("\n");
        const freshnessNote =
          inventoryFreshness === "stale"
            ? "\nYour cached pantry matches are outdated. Click Refresh in 'Best from your inventory'."
            : "";
        reply = `Current cached pantry matches:\n${titles}${freshnessNote}`;
      } else {
        reply = "No pantry matches are cached yet. Click Generate in 'Best from your inventory' to create and store them.";
      }
    } else if (promptLower.includes("search") || promptLower.includes("find") || promptLower.includes("recipe")) {
      reply = "I can help with local search. Type ingredients or dish names in the top search bar (for example: chicken, pasta, curry).";
    }

    setChatMessages((prev) => [
      ...prev,
      {
        id: `recipe-chat-assistant-${msgIdRef.current++}`,
        role: "assistant",
        text: reply,
      },
    ]);
    setChatSending(false);
  }, [chatInput, chatSending, inventoryFreshness, inventorySuggestions]);

  const inventoryMeta = useMemo(() => {
    if (!inventoryItemCount) return "Pantry is empty";
    const suffix = inventoryItemCount === 1 ? "ingredient" : "ingredients";
    return `${inventoryItemCount} pantry ${suffix}`;
  }, [inventoryItemCount]);

  const hasCachedSuggestions = inventorySuggestions.length > 0;
  const freshnessBadge =
    inventoryFreshness === "fresh"
      ? "Fresh cache"
      : inventoryFreshness === "stale"
        ? "Outdated cache"
        : inventoryFreshness === "unknown"
          ? "Unverified cache"
          : "No cache";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(255,244,230,0.95),_#fff_48%),linear-gradient(135deg,_rgba(255,250,241,0.9),_rgba(255,255,255,1))]">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <Card className="border-orange-100 bg-gradient-to-br from-amber-50 via-orange-50 to-white">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3 max-w-2xl">
                <Badge className="bg-orange-500 text-white hover:bg-orange-500">Recipe Studio</Badge>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-balance">
                  Cook smarter with pantry-aware recipe discovery
                </h1>
                <p className="text-sm md:text-base text-muted-foreground">
                  Browse recipes from MealDB, cache your pantry matches, and refresh only when you choose.
                </p>
              </div>

              <form
                className="w-full md:w-[420px] flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runRecipeSearch(searchQuery);
                }}
              >
                <div className="relative flex-1">
                  <SearchIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 pl-8 bg-white"
                    placeholder="Search: salmon, pasta, high-protein dinner..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={searching || !searchQuery.trim()}>
                  {searching ? "Searching..." : "Find"}
                </Button>
              </form>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {QUICK_TAGS.map((tag) => (
                <Button
                  key={tag}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery(tag);
                    void runRecipeSearch(tag);
                  }}
                  className="bg-white"
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  {tag}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.35fr,1fr]">
          <Card className="overflow-hidden border-orange-100">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">Recipe Spotlight</CardTitle>
            </CardHeader>
            <CardContent>
              {featuredLoading && <div className="h-56 rounded-xl bg-muted animate-pulse" />}

              {!featuredLoading && featuredRecipe && (
                <div className="space-y-4">
                  {featuredRecipe.imageUrl ? (
                    <img
                      src={featuredRecipe.imageUrl}
                      alt={featuredRecipe.title}
                      className="h-56 w-full object-cover rounded-xl border"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-56 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                      <ChefHatIcon className="h-10 w-10 text-orange-500" />
                    </div>
                  )}

                  <div>
                    <h3 className="text-lg font-semibold">{featuredRecipe.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{featuredRecipe.summary}</p>
                  </div>

                  <Button onClick={() => void openRecipeDetails(featuredRecipe)}>View spotlight recipe</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-orange-100">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Best from your inventory</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{inventoryMeta}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {inventoryLastUpdated
                      ? `Last generated ${inventoryLastUpdated.toLocaleTimeString()}`
                      : "Not generated yet"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void generateInventorySuggestions()}
                  disabled={inventoryLoading || inventoryChecking}
                  className="shrink-0"
                >
                  <RefreshCwIcon className={`w-3.5 h-3.5 ${inventoryLoading ? "animate-spin" : ""}`} />
                  {hasCachedSuggestions ? "Refresh" : "Generate"}
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <Badge variant="outline">{freshnessBadge}</Badge>
                {cachedFingerprint ? <span className="truncate">Fingerprint tracked</span> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {inventoryFreshness === "stale" && hasCachedSuggestions && (
                <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
                  <AlertTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Inventory changed since this cache was generated. Refresh to update matches.</span>
                </div>
              )}

              {inventoryFreshness === "fresh" && hasCachedSuggestions && (
                <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900 flex gap-2">
                  <CheckCircle2Icon className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Cached recommendations match your latest inventory snapshot.</span>
                </div>
              )}

              {inventoryFreshness === "unknown" && hasCachedSuggestions && (
                <div className="rounded-lg border border-muted p-3 text-sm text-muted-foreground">
                  Could not verify cache freshness. Showing stored recommendations.
                </div>
              )}

              {inventoryError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {inventoryError}
                </div>
              )}

              {!hasCachedSuggestions && !inventoryLoading && (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Generate best pantry matches once, then they stay cached in your browser until you refresh.
                </div>
              )}

              {inventoryLoading && (
                <div className="space-y-2">
                  <div className="h-20 rounded-lg bg-muted animate-pulse" />
                  <div className="h-20 rounded-lg bg-muted animate-pulse" />
                  <div className="h-20 rounded-lg bg-muted animate-pulse" />
                </div>
              )}

              {!inventoryLoading &&
                inventorySuggestions.map((recipe) => (
                  <button
                    key={`inventory-best-${recipe.id}`}
                    type="button"
                    className="w-full text-left rounded-lg border p-3 hover:bg-muted/40 transition-colors"
                    onClick={() => void openRecipeDetails(recipe)}
                  >
                    <p className="font-medium">{recipe.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{recipe.summary}</p>
                  </button>
                ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-orange-100">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xl">Recipe ideas</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setChatOpen(true)} className="gap-1.5">
                <MessageCircleIcon className="w-3.5 h-3.5" />
                Ask Assistant
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Search MealDB by dish style, goal, or ingredient names.
            </p>
          </CardHeader>
          <CardContent>
            {searchError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mb-4">
                {searchError}
              </div>
            )}

            {recipeResults.length === 0 && !searching && (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Use search or quick tags to load recipe cards.
              </div>
            )}

            {searching && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={`search-skeleton-${index}`} className="h-72 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            )}

            {!searching && recipeResults.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recipeResults.map((recipe) => (
                  <RecipeCard key={`recipe-card-${recipe.id}`} recipe={recipe} onView={(selected) => void openRecipeDetails(selected)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!chatOpen && (
        <Button className="fixed bottom-6 right-6 z-40 rounded-full shadow-xl h-12 px-4" onClick={() => setChatOpen(true)}>
          <MessageCircleIcon className="w-5 h-5 mr-1.5" />
          Chat
        </Button>
      )}

      <RecipeAssistantPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        input={chatInput}
        sending={chatSending}
        onInputChange={setChatInput}
        onSend={() => void sendChat()}
      />

      <Dialog
        open={!!selectedRecipe}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRecipe(null);
            setRecipeDetails(null);
            setDetailError(null);
          }
        }}
      >
        <DialogContent className="max-w-[920px] p-0 overflow-hidden">
          <div className="grid gap-0 md:grid-cols-[340px,1fr]">
            <div className="bg-muted/30 border-r">
              {recipeDetails?.imageUrl || selectedRecipe?.imageUrl ? (
                <img
                  src={recipeDetails?.imageUrl || selectedRecipe?.imageUrl}
                  alt={recipeDetails?.title || selectedRecipe?.title || "Recipe"}
                  className="h-56 md:h-full w-full object-cover"
                />
              ) : (
                <div className="h-56 md:h-full w-full flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100">
                  <ChefHatIcon className="h-10 w-10 text-orange-500" />
                </div>
              )}
            </div>

            <div className="p-5 md:p-6 max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{recipeDetails?.title || selectedRecipe?.title || "Recipe details"}</DialogTitle>
                <DialogDescription>MealDB recipe details.</DialogDescription>
              </DialogHeader>

              {detailLoading && <p className="text-sm text-muted-foreground mt-4">Loading details...</p>}

              {detailError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mt-4">
                  {detailError}
                </div>
              )}

              {!detailLoading && !detailError && (
                <div className="space-y-5 mt-4">
                  {recipeDetails?.ingredients?.length > 0 && (
                    <section>
                      <h4 className="font-semibold mb-2">Ingredients</h4>
                      <ul className="list-disc pl-5 text-sm space-y-1">
                        {recipeDetails.ingredients.map((item) => (
                          <li key={`ingredient-${item}`}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section>
                    <h4 className="font-semibold mb-2">Instructions</h4>
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {recipeDetails?.instructions || "Instructions were not returned for this recipe."}
                    </div>
                  </section>

                  {(recipeDetails?.sourceUrl || selectedRecipe?.sourceUrl) && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        window.open(recipeDetails?.sourceUrl || selectedRecipe?.sourceUrl, "_blank", "noopener,noreferrer")
                      }
                    >
                      <ExternalLinkIcon className="w-4 h-4" />
                      Open source
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
