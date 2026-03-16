import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/progress/ExecutionTimeline";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { TypewriterText } from "@/components/assistant/TypewriterText";
import { useResizableSidebar } from "@/lib/useResizableSidebar";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { RecipeCard } from "@/components/recipes/RecipeCard";
import { normalizeAgentRecipeList } from "@/lib/mealdb";
import { StoreMap } from "@/components/shopping/StoreMap";
import { RouteScoreCard } from "@/components/shopping/RouteScoreCard";
import {
  XIcon,
  SendIcon,
  MicIcon,
  MicOffIcon,
  ChefHatIcon,
  SparklesIcon,
  PackageIcon,
  ShoppingCartIcon,
  CameraIcon,
} from "lucide-react";

/** Pre-defined themes for each page context */
export const PANEL_THEMES = {
  inventory: {
    icon: PackageIcon,
    avatarGradient: "from-emerald-400 to-green-600",
    headerBg: "from-emerald-50 to-green-50",
    panelBg: "bg-[radial-gradient(circle_at_top,_rgba(236,253,245,0.95),_rgba(255,255,255,0.98)_45%),linear-gradient(180deg,_rgba(240,253,244,0.88),_rgba(255,255,255,1))]",
    messagesBg: "bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(240,253,244,0.55))]",
    bubbleBorder: "border-emerald-200/70",
    resizeHighlight: "bg-emerald-300/30",
  },
  recipe: {
    icon: ChefHatIcon,
    avatarGradient: "from-amber-400 to-orange-500",
    headerBg: "from-amber-50 to-orange-50",
    panelBg: "bg-[radial-gradient(circle_at_top,_rgba(255,247,236,0.95),_rgba(255,255,255,0.98)_45%),linear-gradient(180deg,_rgba(255,250,244,0.88),_rgba(255,255,255,1))]",
    messagesBg: "bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,250,243,0.55))]",
    bubbleBorder: "border-amber-200/70",
    resizeHighlight: "bg-amber-300/30",
  },
  shopping: {
    icon: ShoppingCartIcon,
    avatarGradient: "from-sky-400 to-blue-600",
    headerBg: "from-sky-50 to-blue-50",
    panelBg: "bg-[radial-gradient(circle_at_top,_rgba(224,242,254,0.95),_rgba(255,255,255,0.98)_45%),linear-gradient(180deg,_rgba(240,249,255,0.88),_rgba(255,255,255,1))]",
    messagesBg: "bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(240,249,255,0.55))]",
    bubbleBorder: "border-sky-200/70",
    resizeHighlight: "bg-sky-300/30",
  },
};

const DEFAULT_THEME = PANEL_THEMES.recipe;

function AssistantAvatar({ size = "sm", theme = DEFAULT_THEME }) {
  const sizeClass =
    size === "lg"
      ? "w-12 h-12"
      : size === "md"
        ? "w-10 h-10"
        : "w-7 h-7";
  const iconClass =
    size === "lg"
      ? "w-8 h-8 text-white"
      : size === "md"
        ? "w-5 h-5 text-white"
        : "w-4 h-4 text-white";
  const Icon = theme.icon;
  if (theme.avatarSrc) {
    return (
      <img
        src={theme.avatarSrc}
        alt=""
        className={`${sizeClass} rounded-full object-cover shrink-0 shadow-md`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-br ${theme.avatarGradient} flex items-center justify-center shrink-0 shadow-md`}
    >
      <Icon className={iconClass} />
    </div>
  );
}

/**
 * Self-contained assistant chat sidebar panel.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the panel is visible
 * @param {() => void} props.onClose - Close handler
 * @param {string} props.title - Panel header title
 * @param {string} props.subtitle - Panel header subtitle
 * @param {Array} props.messages - Chat messages from useAssistantChat
 * @param {Array} props.activeTimeline - Active timeline from useAssistantChat
 * @param {string} props.input - Current input text
 * @param {(value: string | ((prev: string) => string)) => void} props.onInputChange
 * @param {() => void} props.onSend - Send handler
 * @param {boolean} props.sending - Whether a message is being sent
 * @param {string[]} [props.suggestions] - Optional quick suggestion buttons
 * @param {(tag: string) => void} [props.onSuggestionClick] - Suggestion click handler
 * @param {(recipe: object) => void} [props.onViewRecipe] - Handler when user clicks a recipe card
 * @param {object} [props.theme] - Theme object from PANEL_THEMES (inventory | recipe | shopping)
 */
export function AssistantPanel({
  open,
  onClose,
  title = "Pantry Agent",
  subtitle = "I can help manage your inventory. Just ask!",
  messages,
  activeTimeline,
  input,
  onInputChange,
  onSend,
  sending,
  suggestions,
  onSuggestionClick,
  onViewRecipe,
  hideInlineRecipes = false,
  theme = DEFAULT_THEME,
  sessionId = "",
}) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const [animatedIds, setAnimatedIds] = useState(new Set());

  const handleDictation = useCallback(
    (transcript) => {
      onInputChange((prev) => (prev ? `${prev} ${transcript}` : transcript));
    },
    [onInputChange]
  );

  const { listening, toggle: toggleMic, supported: micSupported } =
    useSpeechRecognition(handleDictation);
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

  // Manage body class + CSS variable for layout shift
  useEffect(() => {
    const className = "inventory-chat-open";
    if (open) {
      document.body.classList.add(className);
      document.body.style.setProperty("--inventory-assistant-width", `${panelWidth}px`);
    } else {
      document.body.classList.remove(className);
      document.body.style.removeProperty("--inventory-assistant-width");
    }
    return () => {
      document.body.classList.remove(className);
      document.body.style.removeProperty("--inventory-assistant-width");
    };
  }, [open, panelWidth]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/10 transition-opacity duration-200 sm:hidden"
          onClick={onClose}
        />
      )}

      <div
        style={{ "--assistant-panel-width": `${panelWidth}px` }}
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[var(--assistant-panel-width)] border-l shadow-2xl flex flex-col transition-transform duration-300 ease-out ${theme.panelBg} ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          type="button"
          className={`hidden sm:block absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize ${
            isResizing ? theme.resizeHighlight : "bg-transparent"
          }`}
          onMouseDown={startResize}
          aria-label="Resize assistant panel"
        />

        {/* Header */}
        <div className={`flex h-14 items-center gap-3 px-4 border-b bg-gradient-to-r ${theme.headerBg}`}>
          <div className="relative shrink-0">
            <img src="/SAM-Logo.png" alt="SAM" className="w-9 h-9 rounded-full object-cover shadow-md" />
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground leading-tight">
              {title}
            </h2>
            <p className="text-xs text-emerald-600 leading-tight flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Online
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>

        {/* Suggestions */}
        {Array.isArray(suggestions) && suggestions.length > 0 && (
          <div className="px-4 py-2 border-b bg-background">
            <div className="flex flex-wrap gap-2">
              {suggestions.map((tag) => {
                const label = typeof tag === "object" ? tag.label : tag;
                return (
                  <Button
                    key={`chat-suggestion-${label}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={() => onSuggestionClick?.(tag)}
                    disabled={sending}
                  >
                    <SparklesIcon className="w-3.5 h-3.5" />
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollRef}
          className={`flex-1 overflow-y-auto px-4 py-4 space-y-3 ${theme.messagesBg}`}
        >
          {messages.map((message) =>
            message.role === "system" ? (
              <div
                key={message.id}
                className="flex items-center gap-2 py-1"
              >
                <div className="flex-1 h-px bg-blue-200" />
                <span className="text-[11px] text-blue-500 font-medium whitespace-nowrap">
                  {message.text}
                </span>
                <div className="flex-1 h-px bg-blue-200" />
              </div>
            ) : (
            <div
              key={message.id}
              className={`flex gap-2 ${
                message.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {message.role === "assistant" && <AssistantAvatar theme={theme} />}
              <div
                className={`max-w-[84%] rounded-2xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "whitespace-pre-wrap bg-primary text-primary-foreground rounded-br-md"
                    : `bg-white/95 border ${theme.bubbleBorder} shadow-sm rounded-bl-md`
                }`}
              >
                {message.receiptImage && (
                  <div className={`mb-2 rounded-lg overflow-hidden border ${
                    message.role === "user" ? "border-white/20" : "border-emerald-200/50"
                  }`}>
                    <img src={message.receiptImage} alt="Scanned receipt"
                         className="w-full max-h-48 object-contain bg-gray-50" />
                    <div className={`px-2 py-1 text-[10px] flex items-center gap-1 ${
                      message.role === "user"
                        ? "bg-white/10 text-primary-foreground/70"
                        : "bg-emerald-50/50 text-muted-foreground"
                    }`}>
                      <CameraIcon className="w-3 h-3" /> Scanned receipt
                    </div>
                  </div>
                )}
                {message.role === "assistant" ? (
                  animatedIds.has(message.id) ? (
                    <MarkdownRenderer content={message.text} />
                  ) : (
                    <TypewriterText
                      content={message.text}
                      onComplete={() => setAnimatedIds((prev) => new Set(prev).add(message.id))}
                    />
                  )
                ) : (
                  message.text
                )}
                {message.role === "assistant" &&
                Array.isArray(message.timeline) &&
                message.timeline.length > 0 ? (
                  <ExecutionTimeline
                    steps={message.timeline}
                    defaultExpanded={false}
                    className="mt-2"
                    sessionId={sessionId}
                  />
                ) : null}
                {!hideInlineRecipes &&
                message.role === "assistant" &&
                Array.isArray(message.recipeData) &&
                message.recipeData.length > 0 ? (
                  <div className="mt-3 grid gap-3 grid-cols-1">
                    {/* recipeData may already be normalized objects (from auto-detect)
                        or raw objects from recipe_data blocks — normalize to be safe */}
                    {(message.recipeData[0]?.provider
                      ? message.recipeData
                      : normalizeAgentRecipeList(JSON.stringify(message.recipeData))
                    ).map((recipe) => (
                      <RecipeCard
                        key={`chat-recipe-${recipe.id}`}
                        recipe={recipe}
                        onView={(r) => onViewRecipe?.(r)}
                      />
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" &&
                message.shopperMapData &&
                Array.isArray(message.shopperMapData.stores) &&
                message.shopperMapData.stores.length > 0 ? (
                  <div className="mt-3">
                    <StoreMap
                      mapData={message.shopperMapData}
                      height="260px"
                    />
                  </div>
                ) : null}
                {message.role === "assistant" &&
                message.routePlanData &&
                Array.isArray(message.routePlanData.top_routes) &&
                message.routePlanData.top_routes.length > 0 ? (
                  <div className="mt-3 grid gap-3 grid-cols-1">
                    {message.routePlanData.top_routes.slice(0, 3).map((route) => (
                      <RouteScoreCard
                        key={`route-${route.rank}`}
                        route={route}
                        isBest={route.rank === 1}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex gap-2 items-end">
              <AssistantAvatar theme={theme} />
              <div className={`bg-white/90 border ${theme.bubbleBorder} rounded-2xl rounded-bl-md px-3 py-2 max-w-[84%] w-full shadow-sm`}>
                {Array.isArray(activeTimeline) &&
                activeTimeline.length > 0 ? (
                  <ExecutionTimeline
                    steps={activeTimeline}
                    heading="Live backend progress"
                    defaultExpanded
                    sessionId={sessionId}
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

        {/* Input area */}
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
                {listening ? (
                  <MicOffIcon className="w-4 h-4" />
                ) : (
                  <MicIcon className="w-4 h-4" />
                )}
              </Button>
            )}
            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                className="flex min-h-[44px] max-h-[200px] w-full rounded-xl border border-input bg-muted/30 px-3 py-2.5 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-y-auto"
                style={{ fieldSizing: "content" }}
                placeholder={
                  listening
                    ? "Listening..."
                    : 'Try "Add 2 kg rice" or "What do I have?"'
                }
                value={input}
                onChange={(e) => {
                  onInputChange(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(e.target.scrollHeight, 200) + "px";
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
            <Button
              size="icon"
              onClick={onSend}
              disabled={sending || !input.trim()}
              className="shrink-0 rounded-xl"
            >
              <SendIcon className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-1.5 text-center">
            Press Enter to send
            {micSupported ? " · Click mic to dictate" : ""}
            {" · "}
            <span className="inline-flex items-center gap-0.5 align-middle">
              Powered by
              <img src="/SAM-Logo.png" alt="Solace Agent Mesh" className="inline h-3 w-3 mx-0.5" />
              Solace Agent Mesh
            </span>
          </p>
        </div>
      </div>
    </>
  );
}
