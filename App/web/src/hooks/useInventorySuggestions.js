import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AGENTS } from "@/api/agents";
import { inventoryRestApi } from "@/api/inventoryRest";
import { extractItems } from "@/lib/parseResponse";
import {
  normalizeInventoryRows,
  inventoryFingerprint,
  readBestCache,
  writeBestCache,
  normalizeAgentRecipeList,
  BEST_CACHE_KEY,
} from "@/lib/mealdb";
import {
  appendExecutionLifecycleStep,
  applyArtifactUpdateToTimeline,
  applyStatusUpdateToTimeline,
  createExecutionTimelineTracker,
  getExecutionTimelineSnapshot,
} from "@/lib/executionTimeline";

/**
 * Hook for generating and caching inventory-based recipe suggestions.
 *
 * @param {import("@/api/gateway").GatewayClient} client
 */
export function useInventorySuggestions(client) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [itemCount, setItemCount] = useState(0);
  const [inventoryNames, setInventoryNames] = useState([]);
  const [freshness, setFreshness] = useState("no_cache");
  const [cachedFingerprint, setCachedFingerprint] = useState("");
  const [progressTimeline, setProgressTimeline] = useState([]);
  const trackerRef = useRef(null);

  const fetchCurrentInventory = useCallback(async () => {
    const result = await inventoryRestApi.list();
    return normalizeInventoryRows(extractItems(result));
  }, []);

  const refreshFreshness = useCallback(async () => {
    setChecking(true);

    const cached = readBestCache();
    if (cached?.recipes?.length) {
      setSuggestions(cached.recipes);
      setLastUpdated(
        cached.generatedAt ? new Date(cached.generatedAt) : null
      );
      setCachedFingerprint(cached.inventoryFingerprint || "");
    }

    try {
      const rows = await fetchCurrentInventory();
      const names = rows.map((row) => row.name);
      setItemCount(rows.length);
      setInventoryNames(names);

      const fingerprint = inventoryFingerprint(rows);

      if (!cached?.recipes?.length) {
        setFreshness("no_cache");
      } else if (cached.inventoryFingerprint === fingerprint) {
        setFreshness("fresh");
      } else {
        setFreshness("stale");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (cached?.recipes?.length) {
        setFreshness("unknown");
      }
    } finally {
      setChecking(false);
    }
  }, [fetchCurrentInventory]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const tracker = createExecutionTimelineTracker();
    trackerRef.current = tracker;
    appendExecutionLifecycleStep(tracker, {
      status: "info",
      title: "Preparing inventory snapshot",
    });
    setProgressTimeline(getExecutionTimelineSnapshot(tracker));

    try {
      const rows = await fetchCurrentInventory();
      const names = rows.map((row) => row.name);
      setItemCount(rows.length);
      setInventoryNames(names);
      appendExecutionLifecycleStep(tracker, {
        status: "completed",
        title: `Inventory snapshot ready (${rows.length} item${rows.length === 1 ? "" : "s"})`,
      });
      setProgressTimeline(getExecutionTimelineSnapshot(tracker));

      if (!rows.length) {
        setSuggestions([]);
        setCachedFingerprint("");
        setFreshness("no_cache");
        setLastUpdated(null);
        localStorage.removeItem(BEST_CACHE_KEY);
        appendExecutionLifecycleStep(tracker, {
          status: "completed",
          title: "No pantry items available to generate recommendations",
        });
        setProgressTimeline(getExecutionTimelineSnapshot(tracker));
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
      setProgressTimeline(getExecutionTimelineSnapshot(tracker));

      const response = await client.send(
        `Based on this inventory JSON, recommend the best 3 recipes with FULL details. For each recipe, first search for matches using get_top_3_meals, then get the full details (ingredients and instructions) using get_meal_details for each one.\nInventory: ${JSON.stringify(inventoryPayload)}`,
        AGENTS.RECIPE_INVENTORY_SEARCH,
        {
          onStatus: (statusText, payload) => {
            const changed = applyStatusUpdateToTimeline(
              tracker,
              statusText,
              payload
            );
            if (changed) {
              setProgressTimeline(getExecutionTimelineSnapshot(tracker));
            }
          },
          onArtifact: (payload) => {
            const changed = applyArtifactUpdateToTimeline(tracker, payload);
            if (changed) {
              setProgressTimeline(getExecutionTimelineSnapshot(tracker));
            }
          },
        }
      );

      const recipes = normalizeAgentRecipeList(response.text);
      if (!recipes.length) {
        throw new Error("Chef agent did not return a valid recipe list.");
      }

      const generatedAt = new Date().toISOString();
      setSuggestions(recipes);
      setFreshness("fresh");
      setCachedFingerprint(fingerprint);
      setLastUpdated(new Date(generatedAt));
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
      setProgressTimeline(getExecutionTimelineSnapshot(tracker));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      appendExecutionLifecycleStep(tracker, {
        status: "error",
        title: "Recommendation generation failed",
        detail: message,
      });
      setProgressTimeline(getExecutionTimelineSnapshot(tracker));
      toast.error("Could not generate pantry recommendations", {
        description: message,
      });
    } finally {
      trackerRef.current = null;
      setLoading(false);
    }
  }, [client, fetchCurrentInventory]);

  // Load cache + check freshness on mount and focus
  useEffect(() => {
    void refreshFreshness();
  }, [refreshFreshness]);

  useEffect(() => {
    const onFocus = () => void refreshFreshness();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshFreshness]);

  return {
    suggestions,
    loading,
    checking,
    error,
    lastUpdated,
    itemCount,
    inventoryNames,
    freshness,
    cachedFingerprint,
    progressTimeline,
    generate,
  };
}
