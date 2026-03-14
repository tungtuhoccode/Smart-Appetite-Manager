import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { typeIntoChat } from "@/lib/typeIntoChat";
import { useChatOpen } from "@/context/ChatOpenContext";
import { useGateway } from "@/api";
import { AGENTS } from "@/api/agents";
import { useGatewaySession } from "@/hooks/useGatewaySession";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { useInventorySuggestions } from "@/hooks/useInventorySuggestions";
import { useRecipeSearch } from "@/hooks/useRecipeSearch";
import { useRecipeDetails } from "@/hooks/useRecipeDetails";
import { useSavedRecipes } from "@/hooks/useSavedRecipes";
import { getRandomMeal, toRecipeCard, normalizeAgentRecipeList } from "@/lib/mealdb";
import { RecipeDetailsDialog } from "@/components/recipes/RecipeDetailsDialog";
import { RecipeCard } from "@/components/recipes/RecipeCard";
import { SavedRecipesGrid } from "@/components/recipes/SavedRecipesGrid";
import { CookingTab } from "@/components/recipes/CookingTab";
import { AssistantPanel, PANEL_THEMES } from "@/components/assistant/AssistantPanel";
import { ExecutionTimeline } from "@/components/progress/ExecutionTimeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ChefHatIcon,
  ChevronDownIcon,
  SearchIcon,
  SparklesIcon,
  RefreshCwIcon,
  MessageCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  BookmarkIcon,
  BrainCircuitIcon,
  Trash2Icon,
  UtensilsCrossedIcon,
  CookingPotIcon,
} from "lucide-react";

const RECIPE_SESSION_KEY = "recipe_gateway_session_id";

const AI_TAGS = [
  { label: "Quick dinners", prompt: "Find quick dinner recipes based on my current inventory" },
  { label: "High protein", prompt: "Suggest high protein meals I can make with my current inventory" },
  { label: "Comfort food", prompt: "What comfort food recipes can I make with what I have in my inventory?" },
  { label: "Vegetarian", prompt: "Find vegetarian recipes using ingredients from my current inventory" },
  { label: "One-pot meals", prompt: "Suggest one-pot meal recipes based on my current inventory" },
  { label: "Meal prep", prompt: "What meal prep recipes can I make with my current inventory?" },
];

const DISCOVER_TAGS = ["Chicken", "Pasta", "Beef", "Seafood", "Vegetarian", "Dessert"];

const STORAGE_KEYS = {
  gatewayUrl: "inventory_gateway_url",
  sessionId: RECIPE_SESSION_KEY,
};

const AI_GROUPS_KEY = "ai_recipe_groups_v1";
const AI_COLLAPSED_KEY = "ai_recipe_groups_collapsed_v1";

function loadPersistedGroups() {
  try {
    const raw = localStorage.getItem(AI_GROUPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function loadCollapsedState() {
  try {
    const raw = localStorage.getItem(AI_COLLAPSED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function formatGroupDate(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} \u00B7 ${time}`;
}

export default function RecipeDiscoveryPage() {
  const { client } = useGateway();
  useGatewaySession(client, STORAGE_KEYS, AGENTS.RECIPE_RESEARCH);

  const inventory = useInventorySuggestions(client);
  const recipeSearch = useRecipeSearch(inventory.inventoryNames);
  const recipeDetail = useRecipeDetails(client, RECIPE_SESSION_KEY);
  const saved = useSavedRecipes();

  const [activeTab, setActiveTab] = useState("discover");
  const { chatOpen, setChatOpen } = useChatOpen();
  const typingCleanup = useRef(null);
  const [trendingRecipes, setTrendingRecipes] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(false);

  const chat = useAssistantChat(client, AGENTS.RECIPE_RESEARCH, {
    welcomeText:
      "Hi! I'm your Recipe Agent. Tell me what you're in the mood for and I'll suggest recipes based on what's already in your pantry. Let's cook something great!",
    idPrefix: "recipe-chat",
    errorLabel: "SAM recipe agent failed",
  });

  // Load 6 random recipes on mount
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const pantrySet = new Set(inventory.inventoryNames.map((n) => n.trim().toLowerCase()));

    Promise.all(Array.from({ length: 6 }, () => getRandomMeal()))
      .then((meals) => {
        const cards = meals
          .filter(Boolean)
          .map((meal) => toRecipeCard(meal, pantrySet))
          .filter(Boolean);
        if (cards.length > 0) {
          recipeSearch.setResults(cards);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuickSuggestion = useCallback((tag) => {
    const prompt = typeof tag === "object" ? tag.prompt : tag;
    setChatOpen(true);
    if (typingCleanup.current) typingCleanup.current();
    typingCleanup.current = typeIntoChat(chat.setInput, prompt);
  }, [chat]);

  const handleDiscoverTag = useCallback((tag) => {
    recipeSearch.setQuery(tag);
    void recipeSearch.search(tag);
  }, [recipeSearch]);

  // Fetch 4 random trending recipes on mount
  useEffect(() => {
    let cancelled = false;
    setTrendingLoading(true);
    (async () => {
      try {
        const meals = await Promise.all(Array.from({ length: 4 }, () => getRandomMeal()));
        if (cancelled) return;
        const cards = meals
          .filter(Boolean)
          .map((meal) => ({
            ...toRecipeCard(meal, new Set()),
            category: meal.strCategory || meal.strArea || "",
          }))
          .filter((c) => c && c.id);
        setTrendingRecipes(cards);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Could not load trending recipes", { description: message });
      } finally {
        if (!cancelled) setTrendingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persistent AI recipe groups
  const [aiRecipeGroups, setAiRecipeGroups] = useState(loadPersistedGroups);
  const [collapsedGroups, setCollapsedGroups] = useState(loadCollapsedState);
  const seenGroupIds = useRef(new Set(loadPersistedGroups().map((g) => g.id)));

  // Merge new groups from chat messages into persisted groups
  useEffect(() => {
    let lastUserText = null;
    const newGroups = [];
    for (const msg of chat.messages) {
      if (msg.role === "user") {
        lastUserText = msg.text;
      } else if (msg.role === "assistant") {
        console.log("[ResearchTab] assistant msg:", msg.id, "recipeData:", msg.recipeData?.length ?? "none", "seen:", seenGroupIds.current.has(msg.id));
        if (Array.isArray(msg.recipeData) && msg.recipeData.length > 0) {
          if (seenGroupIds.current.has(msg.id)) continue;
          const normalized = msg.recipeData[0]?.provider
            ? msg.recipeData
            : normalizeAgentRecipeList(JSON.stringify(msg.recipeData));
          console.log("[ResearchTab] normalized recipes:", normalized.length, "from query:", lastUserText);
          newGroups.push({ id: msg.id, query: lastUserText, recipes: normalized, timestamp: new Date().toISOString() });
          seenGroupIds.current.add(msg.id);
        }
      }
    }
    if (newGroups.length > 0) {
      console.log("[ResearchTab] Adding", newGroups.length, "new group(s)");
      setAiRecipeGroups((prev) => [...prev, ...newGroups]);
    }
  }, [chat.messages]);

  // Persist groups to localStorage
  useEffect(() => {
    localStorage.setItem(AI_GROUPS_KEY, JSON.stringify(aiRecipeGroups));
  }, [aiRecipeGroups]);

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(AI_COLLAPSED_KEY, JSON.stringify(collapsedGroups));
  }, [collapsedGroups]);

  const toggleGroupCollapsed = useCallback((groupId) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  const clearAllGroups = useCallback(() => {
    setAiRecipeGroups([]);
    setCollapsedGroups({});
    seenGroupIds.current.clear();
    localStorage.removeItem(AI_GROUPS_KEY);
    localStorage.removeItem(AI_COLLAPSED_KEY);
  }, []);

  const inventoryMeta = useMemo(() => {
    if (!inventory.itemCount) return "Pantry is empty";
    const suffix = inventory.itemCount === 1 ? "ingredient" : "ingredients";
    return `${inventory.itemCount} pantry ${suffix}`;
  }, [inventory.itemCount]);

  const hasCachedSuggestions = inventory.suggestions.length > 0;
  const freshnessBadge =
    inventory.freshness === "fresh"
      ? "Fresh cache"
      : inventory.freshness === "stale"
        ? "Outdated cache"
        : inventory.freshness === "unknown"
          ? "Unverified cache"
          : "No cache";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(255,244,230,0.95),_#fff_48%),linear-gradient(135deg,_rgba(255,250,241,0.9),_rgba(255,255,255,1))]">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Hero / Search */}
        <Card className="border-orange-100 bg-gradient-to-br from-amber-50 via-orange-50 to-white">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3 max-w-2xl">
                <Badge className="bg-orange-500 text-white hover:bg-orange-500">
                  Recipe Studio
                </Badge>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-balance">
                  Cook smarter with pantry-aware recipe discovery
                </h1>
                <p className="text-sm md:text-base text-muted-foreground">
                  Browse recipes from MealDB, cache your pantry matches, and
                  refresh only when you choose.
                </p>
              </div>

              {activeTab === "discover" ? (
                <form
                  className="w-full md:w-[420px] flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void recipeSearch.search();
                  }}
                >
                  <div className="relative flex-1">
                    <SearchIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-9 pl-8 bg-white"
                      placeholder="Search: salmon, pasta, high-protein dinner..."
                      value={recipeSearch.query}
                      onChange={(e) => recipeSearch.setQuery(e.target.value)}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={recipeSearch.searching || !recipeSearch.query.trim()}
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    {recipeSearch.searching ? "Searching..." : "Find"}
                  </Button>
                </form>
              ) : (
                <Button
                  className="shrink-0 gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
                  onClick={() => setChatOpen(true)}
                >
                  <MessageCircleIcon className="w-4 h-4" />
                  Ask Recipe Agent
                </Button>
              )}
            </div>

            {/* Tabs */}
            <div className="mt-5 flex items-center gap-2 border-b border-orange-100 pb-3">
              <button
                onClick={() => setActiveTab("discover")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "discover"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-orange-100"
                }`}
              >
                <UtensilsCrossedIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Recipe Discover
              </button>
              <button
                onClick={() => setActiveTab("research")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "research"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-orange-100"
                }`}
              >
                <BrainCircuitIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Recipe Research (AI)
              </button>
              <button
                onClick={() => setActiveTab("saved")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "saved"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-orange-100"
                }`}
              >
                <BookmarkIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Saved Recipes
                {saved.count > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-orange-600 text-white text-[10px] font-semibold">
                    {saved.count}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("cooking")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === "cooking"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-orange-100"
                }`}
              >
                <CookingPotIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Cooking
              </button>
            </div>

            {/* Conditional quick tags per tab */}
            <div className="mt-3 flex flex-wrap gap-2">
              {activeTab === "discover" &&
                DISCOVER_TAGS.map((tag) => (
                  <Button
                    key={tag}
                    variant="outline"
                    size="sm"
                    onClick={() => handleDiscoverTag(tag)}
                    className="bg-white/80 hover:bg-orange-100"
                  >
                    <SearchIcon className="w-3.5 h-3.5" />
                    {tag}
                  </Button>
                ))}
              {activeTab === "research" &&
                AI_TAGS.map((tag) => (
                  <Button
                    key={tag.label}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickSuggestion(tag)}
                    className="bg-white/80 hover:bg-orange-100"
                  >
                    <SparklesIcon className="w-3.5 h-3.5" />
                    {tag.label}
                  </Button>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* === DISCOVER TAB === */}
        {activeTab === "discover" && (
          <>
            {/* Spotlight + Inventory Best */}
            <div className="grid gap-6 lg:grid-cols-[1.35fr,1fr]">
              {/* Trending Now */}
              <Card className="border-orange-100">
                <CardHeader>
                  <CardTitle className="text-2xl font-bold tracking-tight">Trending Now</CardTitle>
                </CardHeader>
                <CardContent>
                {trendingLoading && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={`trending-skel-${i}`} className="flex gap-4 items-center">
                        <div className="h-24 w-28 rounded-lg bg-muted animate-pulse shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                          <div className="h-5 w-full rounded bg-muted animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!trendingLoading && trendingRecipes.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                    {trendingRecipes.map((recipe) => (
                      <button
                        key={`trending-${recipe.id}`}
                        type="button"
                        className="flex gap-4 items-center text-left group cursor-pointer"
                        onClick={() => void recipeDetail.open(recipe)}
                      >
                        {recipe.imageUrl ? (
                          <img
                            src={recipe.imageUrl}
                            alt={recipe.title}
                            className="h-24 w-28 rounded-lg object-cover shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-24 w-28 rounded-lg bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center shrink-0">
                            <ChefHatIcon className="h-6 w-6 text-orange-500" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          {recipe.category && (
                            <p className="text-xs font-semibold tracking-wider uppercase text-orange-600 mb-1">
                              {recipe.category}
                            </p>
                          )}
                          <h3 className="text-base font-bold leading-snug line-clamp-2 group-hover:text-orange-600 transition-colors">
                            {recipe.title}
                          </h3>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                </CardContent>
              </Card>

              {/* Best from Inventory */}
              <Card className="border-orange-100">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-xl">
                        Best from your inventory
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {inventoryMeta}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {inventory.lastUpdated
                          ? `Last generated ${inventory.lastUpdated.toLocaleTimeString()}`
                          : "Not generated yet"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void inventory.generate()}
                      disabled={inventory.loading || inventory.checking}
                      className="shrink-0"
                    >
                      <RefreshCwIcon
                        className={`w-3.5 h-3.5 ${inventory.loading ? "animate-spin" : ""}`}
                      />
                      {hasCachedSuggestions ? "Refresh" : "Generate"}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <Badge variant="outline">{freshnessBadge}</Badge>
                    {inventory.cachedFingerprint ? (
                      <span className="truncate">Fingerprint tracked</span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {inventory.freshness === "stale" && hasCachedSuggestions && (
                    <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
                      <AlertTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        Inventory changed since this cache was generated. Refresh to
                        update matches.
                      </span>
                    </div>
                  )}
                  {inventory.freshness === "fresh" && hasCachedSuggestions && (
                    <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900 flex gap-2">
                      <CheckCircle2Icon className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>
                        Cached recommendations match your latest inventory snapshot.
                      </span>
                    </div>
                  )}
                  {inventory.freshness === "unknown" && hasCachedSuggestions && (
                    <div className="rounded-lg border border-muted p-3 text-sm text-muted-foreground">
                      Could not verify cache freshness. Showing stored
                      recommendations.
                    </div>
                  )}
                  {inventory.error && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      {inventory.error}
                    </div>
                  )}
                  {inventory.progressTimeline.length > 0 && (
                    <ExecutionTimeline
                      steps={inventory.progressTimeline}
                      heading="Recommendation generation progress"
                      defaultExpanded={inventory.loading}
                      sessionId={client?.getSessionId?.() || ""}
                    />
                  )}
                  {!hasCachedSuggestions && !inventory.loading && (
                    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      Generate best pantry matches once, then they stay cached in
                      your browser until you refresh.
                    </div>
                  )}
                  {inventory.loading && (
                    <div className="space-y-2">
                      <div className="h-20 rounded-lg bg-muted animate-pulse" />
                      <div className="h-20 rounded-lg bg-muted animate-pulse" />
                      <div className="h-20 rounded-lg bg-muted animate-pulse" />
                    </div>
                  )}
                  {!inventory.loading &&
                    inventory.suggestions.map((recipe) => (
                      <button
                        key={`inventory-best-${recipe.id}`}
                        type="button"
                        className="w-full text-left rounded-lg border p-3 hover:bg-muted/40 transition-colors"
                        onClick={() => void recipeDetail.open(recipe)}
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
                            <p className="font-medium line-clamp-2">
                              {recipe.title}
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <Badge variant="secondary" className="text-[11px]">
                                Available:{" "}
                                {recipe.usedIngredientCount ??
                                  recipe.usedIngredients?.length ??
                                  0}
                              </Badge>
                              <Badge variant="outline" className="text-[11px]">
                                Missing:{" "}
                                {recipe.missingIngredientCount ??
                                  recipe.missingIngredients?.length ??
                                  0}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                              {recipe.summary}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                </CardContent>
              </Card>
            </div>

            {/* Recipe Ideas Grid */}
            <Card className="border-orange-100">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-xl">Recipe ideas</CardTitle>
                  <Button
                    size="sm"
                    onClick={() => setChatOpen(true)}
                    className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <MessageCircleIcon className="w-3.5 h-3.5" />
                    Ask Agent
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Search MealDB by dish style, goal, or ingredient names.
                </p>
              </CardHeader>
              <CardContent>
                {recipeSearch.searchError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mb-4">
                    {recipeSearch.searchError}
                  </div>
                )}
                {recipeSearch.results.length === 0 && !recipeSearch.searching && (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Use search or quick tags to load recipe cards.
                  </div>
                )}
                {recipeSearch.searching && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div
                        key={`search-skeleton-${index}`}
                        className="h-72 rounded-xl bg-muted animate-pulse"
                      />
                    ))}
                  </div>
                )}
                {!recipeSearch.searching && recipeSearch.results.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {recipeSearch.results.map((recipe) => (
                      <RecipeCard
                        key={`recipe-card-${recipe.id}`}
                        recipe={recipe}
                        onView={(selected) => void recipeDetail.open(selected)}
                        isSaved={saved.isRecipeSaved(recipe.id)}
                        onToggleSave={saved.toggleSave}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* === RESEARCH (AI) TAB === */}
        {activeTab === "research" && (
          <>
            {aiRecipeGroups.length > 0 ? (
              <>
                {[...aiRecipeGroups].reverse().map((group) => {
                  const isCollapsed = !!collapsedGroups[group.id];
                  return (
                    <Card key={`ai-group-${group.id}`} className="border-orange-100 overflow-hidden">
                      <button
                        type="button"
                        className="w-full text-left px-6 py-4 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => toggleGroupCollapsed(group.id)}
                      >
                        <div className="min-w-0 flex-1">
                          {group.query && (
                            <p className="text-sm text-muted-foreground truncate">
                              <SparklesIcon className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5 text-orange-400" />
                              {group.query}
                            </p>
                          )}
                          <p className="text-lg font-semibold tracking-tight mt-1">
                            {group.recipes.length} recipe{group.recipes.length !== 1 ? "s" : ""} found
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 pt-0.5">
                          {group.timestamp && (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              {formatGroupDate(group.timestamp)}
                            </span>
                          )}
                          <ChevronDownIcon
                            className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
                          />
                        </div>
                      </button>
                      {!isCollapsed && (
                        <CardContent className="pt-0 pb-5">
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {group.recipes.map((recipe) => (
                              <RecipeCard
                                key={`ai-recipe-${recipe.id}`}
                                recipe={recipe}
                                onView={(selected) => {
                                  if (selected.sourceUrl) {
                                    window.open(selected.sourceUrl, "_blank", "noopener,noreferrer");
                                  } else {
                                    void recipeDetail.open({ ...selected, provider: "agent" });
                                  }
                                }}
                                isSaved={saved.isRecipeSaved(recipe.id)}
                                onToggleSave={saved.toggleSave}
                              />
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
                <div className="flex justify-center gap-3">
                  <Button
                    size="sm"
                    onClick={() => setChatOpen(true)}
                    className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <MessageCircleIcon className="w-3.5 h-3.5" />
                    Ask for more recommendations
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearAllGroups}
                    className="gap-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2Icon className="w-3.5 h-3.5" />
                    Clear history
                  </Button>
                </div>
              </>
            ) : (
              <Card className="border-orange-100">
                <CardContent className="p-12 text-center">
                  {chatOpen ? (
                    <>
                      <BrainCircuitIcon className="w-10 h-10 text-orange-400 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        The Recipe Agent is open in the sidebar. Ask it for
                        inventory-aware recipe recommendations, meal plans, and
                        cooking tips.
                      </p>
                    </>
                  ) : (
                    <>
                      <BrainCircuitIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">
                        AI-powered recipe research
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                        Ask SAM to get personalized recipe suggestions based
                        on your current pantry inventory. Use the quick tags above or
                        ask your own questions.
                      </p>
                      <Button
                        className="mt-4 bg-orange-500 hover:bg-orange-600 text-white"
                        onClick={() => setChatOpen(true)}
                      >
                        <MessageCircleIcon className="w-4 h-4 mr-1.5" />
                        Open Agent
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* === SAVED RECIPES TAB === */}
        {activeTab === "saved" && (
          <SavedRecipesGrid
            savedRecipes={saved.savedRecipes}
            onView={(selected) => void recipeDetail.open(selected)}
            onToggleSave={saved.toggleSave}
            isRecipeSaved={saved.isRecipeSaved}
            categories={saved.categories}
            recipesByCategory={saved.recipesByCategory}
            moveRecipe={saved.moveRecipe}
            viewMode={saved.viewMode}
            setViewMode={saved.setViewMode}
            addCategory={saved.addCategory}
            renameCategory={saved.renameCategory}
            deleteCategory={saved.deleteCategory}
            updateCategoryColor={saved.updateCategoryColor}
          />
        )}

        {/* === COOKING TAB === */}
        {activeTab === "cooking" && (
          <CookingTab savedRecipes={saved.savedRecipes} />
        )}
      </div>

      {/* Chat FAB */}
      {!chatOpen && (
        <Button
          className="fixed bottom-6 right-6 z-40 rounded-full shadow-xl h-14 pl-5 pr-4 bg-orange-500 hover:bg-orange-600 text-white text-base gap-3"
          onClick={() => setChatOpen(true)}
        >
          Ask SAM
          <span className="relative w-9 h-9 shrink-0">
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow ring-2 ring-white/20">
              <ChefHatIcon className="w-4.5 h-4.5 text-white" />
            </span>
            <img src="/SAM-Logo.png" alt="SAM" className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white shadow-md" />
          </span>
        </Button>
      )}

      <AssistantPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Recipe Agent"
        subtitle="Connected to SAM for live recipe guidance."
        messages={chat.messages}
        activeTimeline={chat.activeTimeline}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={() => void chat.send()}
        sending={chat.sending}
        suggestions={AI_TAGS}
        onSuggestionClick={handleQuickSuggestion}
        onViewRecipe={(recipe) => {
          if (recipe.sourceUrl) {
            window.open(recipe.sourceUrl, "_blank", "noopener,noreferrer");
          } else {
            void recipeDetail.open({ ...recipe, provider: "agent" });
          }
        }}
        hideInlineRecipes
        theme={PANEL_THEMES.recipe}
        sessionId={client?.getSessionId?.() || ""}
      />

      <RecipeDetailsDialog
        open={!!recipeDetail.selectedRecipe}
        selectedRecipe={recipeDetail.selectedRecipe}
        recipeDetails={recipeDetail.details}
        detailLoading={recipeDetail.loading}
        detailError={recipeDetail.error}
        onOpenChange={(open) => {
          if (!open) recipeDetail.close();
        }}
      />
    </div>
  );
}
