import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGateway } from "@/api";
import { AGENTS } from "@/api/agents";
import { inventoryRestApi } from "@/api/inventoryRest";
import { RecipeDetailsDialog } from "@/components/recipes/RecipeDetailsDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { ExecutionTimeline } from "@/components/progress/ExecutionTimeline";
import {
  appendExecutionLifecycleStep,
  applyArtifactUpdateToTimeline,
  applyStatusUpdateToTimeline,
  createExecutionTimelineTracker,
  getExecutionTimelineSnapshot,
} from "@/lib/executionTimeline";
import { useResizableSidebar } from "@/lib/useResizableSidebar";
import { toast } from "sonner";
import {
  ChefHatIcon,
  SearchIcon,
  SparklesIcon,
  RefreshCwIcon,
  XIcon,
  MessageCircleIcon,
  SendIcon,
  MicIcon,
  MicOffIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  UtensilsCrossedIcon,
  ClockIcon,
  LeafIcon,
} from "lucide-react";

const MEALDB_BASE_URL = "https://www.themealdb.com/api/json/v1/1";
const BEST_CACHE_KEY = "recipe_best_inventory_cache_v1";
const GATEWAY_URL_KEY = "inventory_gateway_url";
const RECIPE_SESSION_KEY = "recipe_gateway_session_id";

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
  text: "Recipe assistant connected. Ask me for recipe recommendations based on your latest inventory.",
};

function makeSessionId(prefix = "recipe-session") {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function responseToChatText(result) {
  if (typeof result?.text === "string" && result.text.trim()) {
    return result.text.trim();
  }
  if (result?.raw && typeof result.raw === "object") {
    return JSON.stringify(result.raw, null, 2);
  }
  return "Done.";
}

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

function tryParseJSON(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // ignore malformed code block
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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

function normalizeAgentRecipeList(responseText) {
  const parsed = tryParseJSON(responseText);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.recipes)
      ? parsed.recipes
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];

  const normalized = list
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

      const usedIngredientCount = explicitUsedCount ?? usedIngredients.length;
      const missingIngredientCount = explicitMissingCount ?? missingIngredients.length;

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
        usedIngredientCount,
        missingIngredientCount,
        sourceUrl: String(recipe.source_url || recipe.sourceUrl || "").trim(),
        provider: "agent",
      };
    })
    .filter(Boolean);

  return normalized;
}

function normalizeAgentRecipeDetails(responseText, fallbackRecipe) {
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
    imageUrl: String(source.image_url || source.image || fallbackRecipe?.imageUrl || "").trim(),
    ingredients,
    instructions: String(
      source.instructions || responseText || "No detailed instructions were returned."
    ).trim(),
    sourceUrl: String(source.source_url || source.sourceUrl || fallbackRecipe?.sourceUrl || "").trim(),
  };
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
    usedIngredientCount: usedIngredients.length,
    missingIngredientCount: missingIngredients.length,
    sourceUrl: meal.strSource || meal.strYoutube || "",
    provider: "mealdb",
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
  activeTimeline,
  suggestions,
  onSuggestionClick,
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
  const { panelWidth, isResizing, startResize } = useResizableSidebar({
    storageKey: "assistant_sidebar_width",
  });

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
        style={{ "--assistant-panel-width": `${panelWidth}px` }}
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[var(--assistant-panel-width)] border-l shadow-2xl flex flex-col transition-transform duration-300 ease-out bg-[radial-gradient(circle_at_top,_rgba(255,247,236,0.95),_rgba(255,255,255,0.98)_45%),linear-gradient(180deg,_rgba(255,250,244,0.88),_rgba(255,255,255,1))] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          type="button"
          className={`hidden sm:block absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize ${
            isResizing ? "bg-amber-300/30" : "bg-transparent"
          }`}
          onMouseDown={startResize}
          aria-label="Resize assistant panel"
        />

        <div className="flex h-14 items-center gap-3 px-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
          <AssistantAvatar />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground leading-tight">Recipe Assistant</h2>
            <p className="text-xs text-muted-foreground truncate leading-tight">
              Connected to SAM for live recipe guidance.
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>

        {Array.isArray(suggestions) && suggestions.length > 0 && (
          <div className="px-4 py-2 border-b bg-background">
            <div className="flex flex-wrap gap-2">
              {suggestions.map((tag) => (
                <Button
                  key={`chat-suggestion-${tag}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-white"
                  onClick={() => onSuggestionClick?.(tag)}
                  disabled={sending}
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  {tag}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,250,243,0.55))]"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {message.role === "assistant" && <AssistantAvatar />}
              <div
                className={`max-w-[84%] rounded-2xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-white/95 border border-amber-200/70 shadow-sm rounded-bl-md"
                }`}
              >
                {message.role === "assistant" ? (
                  <MarkdownRenderer content={message.text} />
                ) : (
                  <span className="whitespace-pre-wrap">{message.text}</span>
                )}
                {message.role === "assistant" &&
                Array.isArray(message.timeline) &&
                message.timeline.length > 0 ? (
                  <ExecutionTimeline
                    steps={message.timeline}
                    defaultExpanded={false}
                    className="mt-2"
                  />
                ) : null}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex gap-2 items-end">
              <AssistantAvatar />
              <div className="bg-white/90 border border-amber-200/70 rounded-2xl rounded-bl-md px-3 py-2 max-w-[84%] w-full shadow-sm">
                {Array.isArray(activeTimeline) && activeTimeline.length > 0 ? (
                  <ExecutionTimeline
                    steps={activeTimeline}
                    heading="Live backend progress"
                    defaultExpanded
                  />
                ) : (
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                )}
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
  const totalIngredients = recipe.usedIngredients.length + recipe.missingIngredients.length;
  const matchPercent = totalIngredients > 0 ? Math.round((recipe.usedIngredients.length / totalIngredients) * 100) : 0;

  return (
    <Card
      className="group overflow-hidden border-orange-100/60 bg-white shadow-sm hover:shadow-lg hover:border-orange-200/80 transition-all duration-300 cursor-pointer"
      onClick={() => onView(recipe)}
    >
      <div className="relative">
        {recipe.imageUrl ? (
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="h-44 w-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="h-44 w-full bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center">
            <ChefHatIcon className="h-10 w-10 text-orange-400" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

        {totalIngredients > 0 && (
          <div className="absolute top-2.5 right-2.5">
            <div className={`text-xs font-semibold px-2 py-1 rounded-full backdrop-blur-sm ${
              matchPercent >= 70
                ? "bg-emerald-500/90 text-white"
                : matchPercent >= 40
                  ? "bg-amber-500/90 text-white"
                  : "bg-white/80 text-gray-700"
            }`}>
              {recipe.usedIngredients.length}/{totalIngredients} match
            </div>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-3">
          <h3 className="font-semibold text-white text-sm leading-snug drop-shadow-md line-clamp-2">
            {recipe.title}
          </h3>
        </div>
      </div>

      <CardContent className="p-3 space-y-2.5">
        <p className="text-xs text-muted-foreground line-clamp-1">{recipe.summary}</p>

        <div className="flex flex-wrap gap-1">
          {recipe.usedIngredients.slice(0, 3).map((ingredient) => (
            <Badge
              key={`used-${recipe.id}-${ingredient}`}
              className="bg-emerald-50 text-emerald-700 border-emerald-200/60 text-[10px] font-medium px-1.5 py-0"
            >
              {ingredient}
            </Badge>
          ))}
          {recipe.missingIngredients.slice(0, 2).map((ingredient) => (
            <Badge
              key={`missing-${recipe.id}-${ingredient}`}
              variant="outline"
              className="text-[10px] text-muted-foreground border-dashed px-1.5 py-0"
            >
              {ingredient}
            </Badge>
          ))}
          {(recipe.usedIngredients.length + recipe.missingIngredients.length > 5) && (
            <span className="text-[10px] text-muted-foreground self-center">
              +{recipe.usedIngredients.length + recipe.missingIngredients.length - 5} more
            </span>
          )}
        </div>

        <Button
          className="w-full h-8 text-xs font-medium"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onView(recipe);
          }}
        >
          <UtensilsCrossedIcon className="w-3.5 h-3.5 mr-1" />
          View Recipe
        </Button>
      </CardContent>
    </Card>
  );
}

export default function RecipeDiscoveryPage() {
  const { client } = useGateway();
  const [inventorySuggestions, setInventorySuggestions] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryChecking, setInventoryChecking] = useState(false);
  const [inventoryError, setInventoryError] = useState(null);
  const [inventoryLastUpdated, setInventoryLastUpdated] = useState(null);
  const [inventoryItemCount, setInventoryItemCount] = useState(0);
  const [inventoryNames, setInventoryNames] = useState([]);
  const [inventoryFreshness, setInventoryFreshness] = useState("no_cache");
  const [cachedFingerprint, setCachedFingerprint] = useState("");
  const [inventoryProgressTimeline, setInventoryProgressTimeline] = useState([]);

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
  const [chatActiveTimeline, setChatActiveTimeline] = useState([]);

  const msgIdRef = useRef(1);
  const inventoryProgressTrackerRef = useRef(null);
  const chatTimelineTrackerRef = useRef(null);

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

  useEffect(() => {
    const savedGatewayUrl = localStorage.getItem(GATEWAY_URL_KEY) || "http://localhost:8000";
    const savedSessionId = localStorage.getItem(RECIPE_SESSION_KEY) || makeSessionId();
    client.setGatewayUrl(savedGatewayUrl);
    client.setSessionId(savedSessionId);
    localStorage.setItem(GATEWAY_URL_KEY, savedGatewayUrl);
    localStorage.setItem(RECIPE_SESSION_KEY, savedSessionId);
  }, [client]);

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
    const tracker = createExecutionTimelineTracker();
    inventoryProgressTrackerRef.current = tracker;
    appendExecutionLifecycleStep(tracker, {
      status: "info",
      title: "Preparing inventory snapshot",
    });
    setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));

    try {
      const rows = await fetchCurrentInventory();
      const names = rows.map((row) => row.name);
      setInventoryItemCount(rows.length);
      setInventoryNames(names);
      appendExecutionLifecycleStep(tracker, {
        status: "completed",
        title: `Inventory snapshot ready (${rows.length} item${rows.length === 1 ? "" : "s"})`,
      });
      setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));

      if (!rows.length) {
        setInventorySuggestions([]);
        setCachedFingerprint("");
        setInventoryFreshness("no_cache");
        setInventoryLastUpdated(null);
        localStorage.removeItem(BEST_CACHE_KEY);
        appendExecutionLifecycleStep(tracker, {
          status: "completed",
          title: "No pantry items available to generate recommendations",
        });
        setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));
        return;
      }

      const fingerprint = inventoryFingerprint(rows);
      const inventoryPayload = rows.map((row) => ({
        product_name: row.name,
        quantity: row.quantity,
        unit: row.unit,
      }));

      appendExecutionLifecycleStep(tracker, {
        status: "running",
        title: "Requesting best recipes from backend",
      });
      setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));

      const response = await client.send(
        `Based on this inventory JSON, recommend the best 3 recipes. Return ONLY JSON array with fields: id, title, summary, used_ingredients (array), missing_ingredients (array), image_url, source_url.\nInventory: ${JSON.stringify(
          inventoryPayload
        )}`,
        AGENTS.RECIPE_RESEARCH,
        {
          onStatus: (statusText, payload) => {
            const changed = applyStatusUpdateToTimeline(tracker, statusText, payload);
            if (changed) {
              setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));
            }
          },
          onArtifact: (payload) => {
            const changed = applyArtifactUpdateToTimeline(tracker, payload);
            if (changed) {
              setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));
            }
          },
        }
      );

      localStorage.setItem(RECIPE_SESSION_KEY, client.getSessionId());

      const recipes = normalizeAgentRecipeList(response.text);
      if (!recipes.length) {
        throw new Error("Recipe agent did not return a valid recipe list.");
      }

      const generatedAt = new Date().toISOString();
      setInventorySuggestions(recipes);
      setInventoryFreshness("fresh");
      setCachedFingerprint(fingerprint);
      setInventoryLastUpdated(new Date(generatedAt));
      writeBestCache({
        recipes,
        generatedAt,
        inventoryFingerprint: fingerprint,
        inventorySnapshot: rows,
      });
      appendExecutionLifecycleStep(tracker, {
        status: "completed",
        title: `Generated ${recipes.length} recommendation${recipes.length === 1 ? "" : "s"}`,
      });
      setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInventoryError(message);
      appendExecutionLifecycleStep(tracker, {
        status: "error",
        title: "Recommendation generation failed",
        detail: message,
      });
      setInventoryProgressTimeline(getExecutionTimelineSnapshot(tracker));
      toast.error("Could not generate pantry recommendations", { description: message });
    } finally {
      inventoryProgressTrackerRef.current = null;
      setInventoryLoading(false);
    }
  }, [client, fetchCurrentInventory]);

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
      if (recipe.provider === "agent") {
        const response = await client.send(
          `Provide full details for this recipe: "${recipe.title}". Return ONLY JSON with fields: title, ingredients (array of {name, measure}), instructions, image_url, source_url.`,
          AGENTS.RECIPE_RESEARCH
        );
        localStorage.setItem(RECIPE_SESSION_KEY, client.getSessionId());
        const details = normalizeAgentRecipeDetails(response.text, recipe);
        setRecipeDetails(details);
        return;
      }

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
  }, [client]);

  const sendChat = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatSending) return;

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

    const tracker = createExecutionTimelineTracker();
    chatTimelineTrackerRef.current = tracker;
    appendExecutionLifecycleStep(tracker, {
      status: "info",
      title: "Task submitted",
    });
    setChatActiveTimeline(getExecutionTimelineSnapshot(tracker));

    try {
      const response = await client.send(prompt, AGENTS.RECIPE_RESEARCH, {
        onStatus: (statusText, payload) => {
          const changed = applyStatusUpdateToTimeline(tracker, statusText, payload);
          if (changed) {
            setChatActiveTimeline(getExecutionTimelineSnapshot(tracker));
          }
        },
        onArtifact: (payload) => {
          const changed = applyArtifactUpdateToTimeline(tracker, payload);
          if (changed) {
            setChatActiveTimeline(getExecutionTimelineSnapshot(tracker));
          }
        },
      });
      localStorage.setItem(RECIPE_SESSION_KEY, client.getSessionId());

      appendExecutionLifecycleStep(tracker, {
        status: "completed",
        title: "Final response received",
      });
      const timeline = getExecutionTimelineSnapshot(tracker);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `recipe-chat-assistant-${msgIdRef.current++}`,
          role: "assistant",
          text: responseToChatText(response),
          timeline,
        },
      ]);
      setChatActiveTimeline([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      appendExecutionLifecycleStep(tracker, {
        status: "error",
        title: "Request failed",
        detail: message,
      });
      const timeline = getExecutionTimelineSnapshot(tracker);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `recipe-chat-error-${msgIdRef.current++}`,
          role: "assistant",
          text: `Request failed: ${message}`,
          timeline,
        },
      ]);
      setChatActiveTimeline([]);
      toast.error("Recipe assistant failed", { description: message });
    } finally {
      chatTimelineTrackerRef.current = null;
      setChatSending(false);
    }
  }, [chatInput, chatSending, client]);

  const handleQuickSuggestion = useCallback((tag) => {
    setChatOpen(true);
    setChatInput(tag);
  }, []);

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
                    handleQuickSuggestion(tag);
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

              {inventoryProgressTimeline.length > 0 && (
                <ExecutionTimeline
                  steps={inventoryProgressTimeline}
                  heading="Recommendation generation progress"
                  defaultExpanded={inventoryLoading}
                />
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
                    <div className="flex items-start gap-3">
                      {recipe.imageUrl ? (
                        <img
                          src={recipe.imageUrl}
                          alt={recipe.title}
                          className="h-16 w-16 rounded-md border object-cover shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-md border bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center shrink-0">
                          <ChefHatIcon className="h-5 w-5 text-orange-500" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="font-medium line-clamp-2">{recipe.title}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge variant="secondary" className="text-[11px]">
                            Available: {recipe.usedIngredientCount ?? recipe.usedIngredients?.length ?? 0}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            Missing: {recipe.missingIngredientCount ?? recipe.missingIngredients?.length ?? 0}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{recipe.summary}</p>
                      </div>
                    </div>
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
        activeTimeline={chatActiveTimeline}
        suggestions={QUICK_TAGS}
        onSuggestionClick={handleQuickSuggestion}
        input={chatInput}
        sending={chatSending}
        onInputChange={setChatInput}
        onSend={() => void sendChat()}
      />

      <RecipeDetailsDialog
        open={!!selectedRecipe}
        selectedRecipe={selectedRecipe}
        recipeDetails={recipeDetails}
        detailLoading={detailLoading}
        detailError={detailError}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRecipe(null);
            setRecipeDetails(null);
            setDetailError(null);
          }
        }}
      />
    </div>
  );
}
