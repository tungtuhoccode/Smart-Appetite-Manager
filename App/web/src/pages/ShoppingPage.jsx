import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { typeIntoChat } from "@/lib/typeIntoChat";
import { useChatOpen } from "@/context/ChatOpenContext";
import { useGateway } from "@/api";
import { AGENTS } from "@/api/agents";
import { useGatewaySession } from "@/hooks/useGatewaySession";
import { useShoppingChat } from "@/hooks/useShoppingChat";
import { useWeeklyDeals } from "@/hooks/useWeeklyDeals";
import { extractShopperMapData, extractRoutePlanData } from "@/lib/parseResponse";
import { StoreMap } from "@/components/shopping/StoreMap";
import { StoreDealCard } from "@/components/shopping/StoreDealCard";
import { RouteScoreCard } from "@/components/shopping/RouteScoreCard";
import { WeeklyDealsGrid } from "@/components/shopping/WeeklyDealsGrid";
import { AssistantPanel, PANEL_THEMES } from "@/components/assistant/AssistantPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircleIcon,
  ShoppingCartIcon,
  MapPinIcon,
  SparklesIcon,
  RouteIcon,
  TrophyIcon,
  TagIcon,
} from "lucide-react";

const SHOPPER_SESSION_KEY = "shopper_gateway_session_id";

const QUICK_TAGS = [
  "Find deals on chicken, eggs, milk, bread, rice",
  "Best price for eggs and milk",
  "Deals on rice and pasta",
  "Plan a trip for eggs, milk, bread, chicken, rice",
  "Cheapest route for pasta, tomatoes, onions, garlic",
  "Fewest stops for butter, flour, sugar, eggs",
];

const STORAGE_KEYS = {
  gatewayUrl: "inventory_gateway_url",
  sessionId: SHOPPER_SESSION_KEY,
};

export default function ShoppingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { client } = useGateway();
  useGatewaySession(client, STORAGE_KEYS, AGENTS.SHOPPER);

  const [activeTab, setActiveTab] = useState("weekly");
  const { chatOpen, setChatOpen } = useChatOpen();
  const weeklyDeals = useWeeklyDeals();
  const prefillApplied = useRef(false);
  const typingCleanup = useRef(null);

  // Single unified chat — smart-routes to ShopperAgent or RoutePlannerAgent
  const chat = useShoppingChat(client, {
    welcomeText:
      "Hey! I'm your Smart Shopper. I can hunt down the best deals on your groceries and plan the most efficient shopping route. What are you looking to buy?",
    idPrefix: "shopping-chat",
  });

  // Pre-fill chat from ?items= URL param (e.g. from Shopping List "Find Deals" button)
  useEffect(() => {
    if (prefillApplied.current) return;
    const itemsParam = searchParams.get("items");
    if (itemsParam) {
      prefillApplied.current = true;
      setChatOpen(true);
      setActiveTab("deals");
      chat.setInput(`Find deals on ${itemsParam}`);
      // Clean up the URL
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, chat]);

  const handleQuickSuggestion = useCallback(
    (tag) => {
      setChatOpen(true);
      if (typingCleanup.current) typingCleanup.current();
      typingCleanup.current = typeIntoChat(chat.setInput, tag);
    },
    [chat]
  );

  // Find the most recent shopper map data from messages (any agent)
  const latestMapData = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (
        msg.agentName === AGENTS.SHOPPER &&
        msg.shopperMapData &&
        Array.isArray(msg.shopperMapData.stores) &&
        msg.shopperMapData.stores.length > 0
      ) {
        return msg.shopperMapData;
      }
    }
    // Fallback: re-parse from raw text
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (msg.rawText && msg.agentName === AGENTS.SHOPPER) {
        const { mapData } = extractShopperMapData(msg.rawText);
        if (mapData && Array.isArray(mapData.stores) && mapData.stores.length > 0) {
          return mapData;
        }
      }
    }
    return null;
  }, [chat.messages]);

  const sortedStores = useMemo(() => {
    if (!latestMapData?.stores) return [];
    return [...latestMapData.stores].sort((a, b) => {
      const diff = (b.items?.length || 0) - (a.items?.length || 0);
      if (diff !== 0) return diff;
      if (a.is_recommended && !b.is_recommended) return -1;
      if (!a.is_recommended && b.is_recommended) return 1;
      return 0;
    });
  }, [latestMapData]);

  // Find the most recent route plan data from messages
  const latestRoutePlan = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (
        msg.routePlanData &&
        Array.isArray(msg.routePlanData.top_routes) &&
        msg.routePlanData.top_routes.length > 0
      ) {
        return msg.routePlanData;
      }
    }
    // Fallback: re-parse from raw text
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (msg.rawText) {
        const { routeData } = extractRoutePlanData(msg.rawText);
        if (routeData && Array.isArray(routeData.top_routes) && routeData.top_routes.length > 0) {
          return routeData;
        }
      }
    }
    return null;
  }, [chat.messages]);

  // Route planner's map data (from route planner agent responses)
  const latestRouteMapData = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (
        msg.agentName === AGENTS.ROUTE_PLANNER &&
        msg.shopperMapData &&
        Array.isArray(msg.shopperMapData.stores) &&
        msg.shopperMapData.stores.length > 0
      ) {
        return msg.shopperMapData;
      }
    }
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const msg = chat.messages[i];
      if (msg.rawText && msg.agentName === AGENTS.ROUTE_PLANNER) {
        const { mapData } = extractShopperMapData(msg.rawText);
        if (mapData && Array.isArray(mapData.stores) && mapData.stores.length > 0) {
          return mapData;
        }
      }
    }
    return null;
  }, [chat.messages]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(230,248,255,0.95),_#fff_48%),linear-gradient(135deg,_rgba(241,250,255,0.9),_rgba(255,255,255,1))]">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Hero */}
        <Card className="border-blue-100 bg-gradient-to-br from-blue-50 via-sky-50 to-white">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3 max-w-2xl">
                <Badge className="bg-blue-500 text-white hover:bg-blue-500">
                  <ShoppingCartIcon className="w-3 h-3 mr-1" />
                  Smart Shopping
                </Badge>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-balance">
                  Find the best deals and plan your shopping route
                </h1>
                <p className="text-sm md:text-base text-muted-foreground">
                  Search live weekly flyer deals and automatically get an optimized
                  shopping route. SAM does it all.
                </p>
              </div>
              <Button
                className="shrink-0 gap-1.5 bg-sky-600 hover:bg-sky-700 text-white"
                onClick={() => setChatOpen(true)}
              >
                <MessageCircleIcon className="w-4 h-4" />
                Ask Smart Shopper
              </Button>
            </div>

            {/* Tabs */}
            <div className="mt-5 flex items-center gap-2 border-b border-blue-100 pb-3">
              <button
                onClick={() => setActiveTab("weekly")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === "weekly"
                    ? "bg-blue-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-blue-100"
                }`}
              >
                <TagIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Deals this week
                {weeklyDeals.freshness === "stale" && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-2 h-2 rounded-full bg-amber-400" />
                )}
              </button>
              <button
                onClick={() => setActiveTab("deals")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === "deals"
                    ? "bg-blue-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-blue-100"
                }`}
              >
                <ShoppingCartIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Deal Finder (AI)
              </button>
              <button
                onClick={() => setActiveTab("route")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === "route"
                    ? "bg-blue-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-blue-100"
                }`}
              >
                <RouteIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Route Planner (AI)
                {latestRoutePlan && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_TAGS.map((tag) => (
                <Button
                  key={tag}
                  variant="outline"
                  size="sm"
                  onClick={() => handleQuickSuggestion(tag)}
                  className="bg-white/80 hover:bg-blue-100"
                >
                  <SparklesIcon className="w-3.5 h-3.5" />
                  {tag}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* === WEEKLY DEALS TAB === */}
        {activeTab === "weekly" && (
          <WeeklyDealsGrid
            deals={weeklyDeals.deals}
            loading={weeklyDeals.loading}
            error={weeklyDeals.error}
            onRefresh={weeklyDeals.refresh}
            freshness={weeklyDeals.freshness}
            checking={weeklyDeals.checking}
          />
        )}

        {/* === DEALS TAB === */}
        {activeTab === "deals" && (
          <>
            {latestMapData ? (
              <>
                <Card className="border-blue-100">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="w-5 h-5 text-blue-500" />
                      <CardTitle className="text-xl">Store Locations</CardTitle>
                      {latestMapData.recommended_store && (
                        <Badge className="bg-emerald-500 text-white text-xs">
                          Best: {latestMapData.recommended_store}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {sortedStores.length} store{sortedStores.length !== 1 ? "s" : ""} with
                      deals found. Green marker = recommended one-stop shop.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <StoreMap mapData={latestMapData} height="420px" />
                  </CardContent>
                </Card>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sortedStores.map((store, index) => (
                    <StoreDealCard
                      key={`store-card-${store.store}-${index}`}
                      store={store}
                    />
                  ))}
                </div>
              </>
            ) : (
              <Card className="border-dashed border-blue-200">
                <CardContent className="p-12 text-center">
                  <MapPinIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Ask the Smart Shopper to find deals and store locations will
                    appear here on the map.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setChatOpen(true)}
                  >
                    <MessageCircleIcon className="w-4 h-4 mr-1.5" />
                    Start searching
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* === ROUTE PLANNER TAB === */}
        {activeTab === "route" && (
          <>
            {latestRoutePlan ? (
              <>
                {/* Route map */}
                {latestRouteMapData && (
                  <Card className="border-blue-100">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <RouteIcon className="w-5 h-5 text-blue-500" />
                        <CardTitle className="text-xl">Optimal Route Map</CardTitle>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Showing stores from the best route.{" "}
                        {latestRoutePlan.routes_evaluated} routes evaluated across{" "}
                        {latestRoutePlan.total_stores_found} stores.
                      </p>
                    </CardHeader>
                    <CardContent>
                      <StoreMap mapData={latestRouteMapData} height="420px" />
                    </CardContent>
                  </Card>
                )}

                {/* Summary stats */}
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                  <Card className="border-blue-100">
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-blue-600">
                        {latestRoutePlan.items_with_deals?.length || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Items with deals</p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-100">
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-blue-600">
                        {latestRoutePlan.total_stores_found || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Stores found</p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-100">
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-blue-600">
                        {latestRoutePlan.routes_evaluated || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Routes evaluated</p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-100">
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-emerald-600">
                        {latestRoutePlan.top_routes?.[0]
                          ? `$${latestRoutePlan.top_routes[0].total_cost.toFixed(2)}`
                          : "--"}
                      </p>
                      <p className="text-xs text-muted-foreground">Best route cost</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Items not found warning */}
                {latestRoutePlan.items_not_found &&
                  latestRoutePlan.items_not_found.length > 0 && (
                    <Card className="border-amber-200 bg-amber-50/50">
                      <CardContent className="p-4">
                        <p className="text-sm text-amber-800">
                          <strong>Not on sale this week:</strong>{" "}
                          {latestRoutePlan.items_not_found.join(", ")}.
                          You may need to pick these up at regular price.
                        </p>
                      </CardContent>
                    </Card>
                  )}

                {/* Route cards */}
                <div>
                  <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <TrophyIcon className="w-5 h-5 text-emerald-500" />
                    Top Routes
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {latestRoutePlan.top_routes.map((route) => (
                      <RouteScoreCard
                        key={`route-card-${route.rank}`}
                        route={route}
                        isBest={route.rank === 1}
                      />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <Card className="border-dashed border-blue-200">
                <CardContent className="p-12 text-center">
                  <RouteIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    {chat.sending
                      ? "Route optimization in progress..."
                      : "Ask SAM for deals and the route planner will automatically optimize your shopping trip."}
                  </p>
                  {!chat.sending && (
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setChatOpen(true)}
                    >
                      <MessageCircleIcon className="w-4 h-4 mr-1.5" />
                      Start searching
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Chat FAB */}
      {!chatOpen && (
        <Button
          className="fixed bottom-6 right-6 z-40 rounded-full shadow-xl h-14 pl-5 pr-4 bg-sky-600 hover:bg-sky-700 text-white text-base gap-3"
          onClick={() => setChatOpen(true)}
        >
          Ask SAM
          <MessageCircleIcon className="w-5 h-5" />
        </Button>
      )}

      <AssistantPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Smart Shopper Agent"
        subtitle="Connected to SAM for deals and route planning."
        messages={chat.messages}
        activeTimeline={chat.activeTimeline}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={() => void chat.send()}
        sending={chat.sending}
        suggestions={QUICK_TAGS}
        onSuggestionClick={handleQuickSuggestion}
        theme={PANEL_THEMES.shopping}
        sessionId={client?.getSessionId?.() || ""}
      />
    </div>
  );
}
