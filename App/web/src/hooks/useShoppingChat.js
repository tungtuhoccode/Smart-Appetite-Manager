import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { extractMessageTextParts } from "@/api/gateway";
import { AGENTS } from "@/api/agents";
import {
  responseToChatText,
  extractRecipeData,
  extractShopperMapData,
  extractRoutePlanData,
} from "@/lib/parseResponse";
import {
  appendExecutionLifecycleStep,
  applyArtifactUpdateToTimeline,
  applyStatusUpdateToTimeline,
  createExecutionTimelineTracker,
  getExecutionTimelineSnapshot,
} from "@/lib/executionTimeline";

/**
 * Keywords that indicate the user wants route planning / optimization.
 * Everything else is routed to the ShopperAgent for deal finding.
 */
const ROUTE_KEYWORDS =
  /\b(plan|route|optimi[sz]e|trip|fewest|stops|optimal|best route|shopping route|minimize|least stores)\b/i;

const INVENTORY_API_URL =
  import.meta.env.VITE_INVENTORY_API_URL || "http://localhost:8001";

/**
 * Fetch the pricing artifact via our inventory REST API.
 * The Python tool saves it to disk; our API reads it directly from the filesystem.
 */
async function fetchPricingArtifact(sessionId) {
  const url = `${INVENTORY_API_URL}/api/artifacts/${encodeURIComponent(sessionId)}/pricing-products.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.products ? data : null;
}

function detectAgent(prompt) {
  return ROUTE_KEYWORDS.test(prompt)
    ? AGENTS.ROUTE_PLANNER
    : AGENTS.LIVE_PRICING;
}

/**
 * Unified shopping chat hook with smart agent routing and auto route planning.
 *
 * - Detects whether a prompt is for deals or route planning using keywords
 * - After the ShopperAgent returns deals, automatically triggers the
 *   RoutePlannerAgent with the same items
 * - Single message list shared across both tabs
 */
export function useShoppingChat(client, options = {}) {
  const {
    welcomeText = "Smart Shopping Agent ready! Ask me to find deals or plan your shopping route.",
    idPrefix = "shopping",
    onComplete,
  } = options;

  const [messages, setMessages] = useState([
    {
      id: `${idPrefix}-welcome`,
      role: "assistant",
      text: welcomeText,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTimeline, setActiveTimeline] = useState([]);
  const trackerRef = useRef(null);
  const msgIdRef = useRef(1);

  // Streaming message refs — accumulate text parts (like SAM webui), throttle UI updates
  const streamingMsgIdRef = useRef(null);
  const streamingPartsRef = useRef([]);
  const throttleTimerRef = useRef(null);

  const flushStreamingText = useCallback(() => {
    const text = streamingPartsRef.current.join("");
    if (!text) return;
    if (!streamingMsgIdRef.current) {
      const id = `${idPrefix}-streaming-${msgIdRef.current++}`;
      streamingMsgIdRef.current = id;
      setMessages((prev) => [...prev, {
        id, role: "assistant", text, isStreaming: true,
      }]);
    } else {
      const sid = streamingMsgIdRef.current;
      setMessages((prev) => prev.map((m) =>
        m.id === sid ? { ...m, text } : m
      ));
    }
  }, [idPrefix]);

  const cleanupStreaming = useCallback(() => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    streamingMsgIdRef.current = null;
    streamingPartsRef.current = [];
  }, []);

  /**
   * Internal: send a prompt to a specific agent and append the response
   * to the shared message list. Returns the parsed message data.
   */
  const sendToAgent = useCallback(
    async (prompt, agentName, { isAutoFollowUp = false } = {}) => {
      const tracker = createExecutionTimelineTracker();
      trackerRef.current = tracker;
      let pricingArtifact = null;

      const agentLabel =
        agentName === AGENTS.ROUTE_PLANNER ? "Route Planner" : "Live Pricing";

      cleanupStreaming();
      appendExecutionLifecycleStep(tracker, {
        status: "info",
        title: isAutoFollowUp
          ? `Auto-routing to ${agentLabel}...`
          : "Task submitted",
      });
      setActiveTimeline(getExecutionTimelineSnapshot(tracker));

      try {
        const wirePrompt = prompt;

        const result = await client.send(wirePrompt, agentName, {
          onStatus: (statusText, payload) => {
            // Accumulate text parts from the SSE payload (SAM message structure)
            const taskState = payload?.result?.status?.state;
            if (taskState === "working") {
              const partText = extractMessageTextParts(payload);
              if (partText) {
                streamingPartsRef.current.push(partText);
                if (!throttleTimerRef.current) {
                  throttleTimerRef.current = setTimeout(() => {
                    throttleTimerRef.current = null;
                    flushStreamingText();
                  }, 150);
                }
              }
            }
            const changed = applyStatusUpdateToTimeline(
              tracker,
              statusText,
              payload
            );
            if (changed) {
              setActiveTimeline(getExecutionTimelineSnapshot(tracker));
            }
          },
          onArtifact: (payload) => {
            const changed = applyArtifactUpdateToTimeline(tracker, payload);
            if (changed) {
              setActiveTimeline(getExecutionTimelineSnapshot(tracker));
            }
          },
        });

        appendExecutionLifecycleStep(tracker, {
          status: "completed",
          title: `${agentLabel} responded`,
        });
        const timeline = getExecutionTimelineSnapshot(tracker);

        const rawText = responseToChatText(result);
        const { recipes: recipeData, cleanText: afterRecipe } =
          extractRecipeData(rawText);
        const { mapData: shopperMapData, cleanText: afterMap } =
          extractShopperMapData(afterRecipe);
        const { routeData: routePlanData, cleanText } =
          extractRoutePlanData(afterMap);

        // Fetch pricing artifact via REST after LivePricingAgent responds
        if (agentName === AGENTS.LIVE_PRICING) {
          try {
            const sessionId = client.getSessionId();
            const fetched = await fetchPricingArtifact(sessionId);
            if (fetched?.products) {
              pricingArtifact = fetched;
              console.log("[useShoppingChat] Fetched pricing artifact via REST:", fetched.store, fetched.products?.length, "products");
            }
          } catch (e) {
            console.warn("[useShoppingChat] REST artifact fetch failed:", e);
          }
        }

        // Update streaming message in-place or create a new one
        const streamingId = streamingMsgIdRef.current;
        const streamedText = streamingPartsRef.current.join("");
        // Streamed text already contains the full response — use it directly
        const finalText = (streamingId && streamedText) ? streamedText : cleanText;

        const msgData = {
          role: "assistant",
          text: finalText,
          rawText,
          timeline,
          recipeData,
          shopperMapData,
          routePlanData,
          pricingData: pricingArtifact,
          agentName,
        };

        if (streamingId) {
          setMessages((prev) => prev.map((m) =>
            m.id === streamingId
              ? { ...m, ...msgData, isStreaming: false }
              : m
          ));
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `${idPrefix}-assistant-${msgIdRef.current++}`, ...msgData },
          ]);
        }
        cleanupStreaming();
        return msgData;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        appendExecutionLifecycleStep(tracker, {
          status: "error",
          title: "Request failed",
          detail: message,
        });
        const timeline = getExecutionTimelineSnapshot(tracker);

        const streamingId = streamingMsgIdRef.current;
        const errorText = `Request failed: ${message}`;
        if (streamingId) {
          setMessages((prev) => prev.map((m) =>
            m.id === streamingId
              ? { ...m, text: (streamingPartsRef.current.join("") || "") + "\n\n" + errorText, isStreaming: false, timeline, agentName }
              : m
          ));
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `${idPrefix}-error-${msgIdRef.current++}`,
              role: "assistant",
              text: errorText,
              timeline,
              agentName,
            },
          ]);
        }
        toast.error(`${agentLabel} failed`, { description: message });
        cleanupStreaming();
        return null;
      }
    },
    [client, idPrefix, flushStreamingText, cleanupStreaming]
  );

  /**
   * Primary send function — detects agent, sends, and auto-follows-up.
   */
  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        id: `${idPrefix}-user-${msgIdRef.current++}`,
        role: "user",
        text: prompt,
      },
    ]);
    setInput("");
    setSending(true);

    try {
      const agent = detectAgent(prompt);
      await sendToAgent(prompt, agent);

      onComplete?.();
    } finally {
      trackerRef.current = null;
      setSending(false);
      setActiveTimeline([]);
      cleanupStreaming();
    }
  }, [client, input, sending, idPrefix, onComplete, sendToAgent, cleanupStreaming]);

  return {
    messages,
    input,
    setInput,
    sending,
    activeTimeline,
    send,
  };
}
