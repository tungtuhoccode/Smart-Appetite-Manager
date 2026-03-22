import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { extractMessageTextParts } from "@/api/gateway";
import { responseToChatText, extractRecipeData, extractShopperMapData, extractRoutePlanData } from "@/lib/parseResponse";
import { normalizeAgentRecipeList, parseMarkdownRecipeList } from "@/lib/mealdb";
import {
  appendExecutionLifecycleStep,
  applyArtifactUpdateToTimeline,
  applyStatusUpdateToTimeline,
  createExecutionTimelineTracker,
  getExecutionTimelineSnapshot,
} from "@/lib/executionTimeline";

/**
 * Self-contained chat state and send logic for the assistant panel.
 *
 * @param {import("@/api/gateway").GatewayClient} client - Gateway client
 * @param {string} agentName - Agent to send prompts to
 * @param {object} options
 * @param {string} options.welcomeText - Initial assistant message
 * @param {string} options.idPrefix - Prefix for message IDs
 * @param {string} options.errorLabel - Label for toast errors
 * @param {() => void} [options.onComplete] - Called after successful send
 */
export function useAssistantChat(client, agentName, options = {}) {
  const {
    welcomeText = "SAM agent ready. Ask me anything.",
    idPrefix = "chat",
    errorLabel = "SAM agent failed",
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
  const msgIdRef = useRef(Date.now());

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

  const send = useCallback(async (overridePrompt, messageMetadata) => {
    const prompt = (overridePrompt ?? input).trim();
    if (!prompt || sending) return;
    if (!overridePrompt) setInput("");

    const tracker = createExecutionTimelineTracker();
    trackerRef.current = tracker;
    appendExecutionLifecycleStep(tracker, {
      status: "info",
      title: "Task submitted",
    });
    setActiveTimeline(getExecutionTimelineSnapshot(tracker));
    cleanupStreaming();

    setMessages((prev) => [
      ...prev,
      {
        id: `${idPrefix}-user-${msgIdRef.current++}`,
        role: "user",
        text: prompt,
        ...messageMetadata,
      },
    ]);
    setSending(true);

    try {
      const wirePrompt = prompt;
      const statusTexts = [];
      const result = await client.send(wirePrompt, agentName, {
        onStatus: (statusText, payload) => {
          if (statusText) statusTexts.push(statusText);
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
          const changed = applyStatusUpdateToTimeline(tracker, statusText, payload);
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
        title: "Final response received",
      });
      const timeline = getExecutionTimelineSnapshot(tracker);

      const rawText = responseToChatText(result);

      // Tier 0: search the accumulated streaming text for recipe_data.
      // This is the most direct path to the helper agent's raw output — it captures
      // the recipe_data block before the routing agent has a chance to rewrite/lose it.
      const streamedText = streamingPartsRef.current.join("");
      const { recipes: streamedRecipeData, cleanText: streamedCleanText } = extractRecipeData(streamedText);

      const { recipes: explicitRecipeData, cleanText: afterRecipe } = extractRecipeData(rawText);

      const { mapData: shopperMapData, cleanText: afterMap } = extractShopperMapData(afterRecipe);
      const { routeData: routePlanData, cleanText } = extractRoutePlanData(afterMap);

      // Auto-detect recipe data: use explicit recipe_data block first,
      // then fall back to parsing the full response for any JSON recipe arrays,
      // then fall back to scanning streaming status updates (helper agent responses
      // may contain recipe_data blocks that the routing agent rewrote)
      let recipeData = streamedRecipeData?.length ? streamedRecipeData : explicitRecipeData;
      if (!recipeData || !recipeData.length) {
        const detected = normalizeAgentRecipeList(rawText);
        if (detected.length > 0) {
          recipeData = detected;
        }
      }
      if (!recipeData || !recipeData.length) {
        // Iterate each status text individually — joining them causes tryParseJSON to match
        // the wrong (first/smallest) code block when multiple ```-fenced blocks exist.
        for (const st of [...statusTexts, streamedText]) {
          if (!st) continue;
          const { recipes: sr } = extractRecipeData(st);
          if (sr?.length) {
            recipeData = sr;
            break;
          }
          const detected = normalizeAgentRecipeList(st);
          if (detected.length > 0) {
            recipeData = detected;
            break;
          }
        }
      }
      // Tier 4: parse recipe titles + image URLs from markdown-formatted text.
      // Try both streamedText (helper agent's full output, what chat displays) and rawText
      // (routing agent's final summary, which may mention fewer recipes). Use whichever
      // source yields more recipe cards.
      if (!recipeData || !recipeData.length) {
        const fromStreamed = parseMarkdownRecipeList(streamedText);
        const fromRaw = parseMarkdownRecipeList(rawText);
        const markdownRecipes = fromStreamed.length >= fromRaw.length ? fromStreamed : fromRaw;
        if (markdownRecipes.length > 0) {
          recipeData = markdownRecipes;
        }
      }

      // Normalize to consistent schema (adds provider:"agent") if not already set.
      // Tiers 0/1 extract raw agent JSON which lacks the provider field — normalize it
      // so RecipeDiscoveryPage can use the data directly without a stringify roundtrip.
      if (recipeData?.length && !recipeData[0]?.provider) {
        const normalized = normalizeAgentRecipeList(JSON.stringify(recipeData));
        if (normalized.length > 0) recipeData = normalized;
      }

      // Update streaming message in-place or create a new one
      const streamingId = streamingMsgIdRef.current;
      // streamedText already computed above for Tier 0 extraction.
      // Use the clean version (recipe_data block stripped) if we extracted recipes from it.
      const finalText = (streamingId && streamedText)
        ? (streamedRecipeData?.length ? streamedCleanText : streamedText)
        : cleanText;

      if (streamingId) {
        setMessages((prev) => prev.map((m) =>
          m.id === streamingId
            ? {
                ...m,
                text: finalText,
                isStreaming: false,
                rawText,
                timeline,
                recipeData,
                shopperMapData,
                routePlanData,
                ...messageMetadata,
              }
            : m
        ));
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `${idPrefix}-assistant-${msgIdRef.current++}`,
            role: "assistant",
            text: finalText,
            rawText,
            timeline,
            recipeData,
            shopperMapData,
            routePlanData,
            ...messageMetadata,
          },
        ]);
      }
      setActiveTimeline([]);
      onComplete?.();
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
            ? { ...m, text: (streamingPartsRef.current.join("") || "") + "\n\n" + errorText, isStreaming: false, timeline }
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
          },
        ]);
      }
      setActiveTimeline([]);
      toast.error(errorLabel, { description: message });
    } finally {
      trackerRef.current = null;
      cleanupStreaming();
      setSending(false);
    }
  }, [client, agentName, input, sending, idPrefix, errorLabel, onComplete, flushStreamingText, cleanupStreaming]);

  const clearMessages = useCallback(() => {
    setMessages([{ id: `${idPrefix}-welcome`, role: "assistant", text: welcomeText }]);
  }, [idPrefix, welcomeText]);

  return {
    messages,
    input,
    setInput,
    sending,
    activeTimeline,
    send,
    clearMessages,
  };
}
