import React, { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  PlayCircleIcon,
  LinkIcon,
  TimerIcon,
  PlusIcon,
  PlayIcon,
  PauseIcon,
  RotateCcwIcon,
  XIcon,
  BellRingIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import { toast } from "sonner";

// ── Helpers ──────────────────────────────────────────────────────────

export function extractVideoId(url) {
  if (!url) return null;
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

export function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const TIMER_PRESETS = [
  { label: "1 min", seconds: 60 },
  { label: "3 min", seconds: 180 },
  { label: "5 min", seconds: 300 },
  { label: "10 min", seconds: 600 },
  { label: "15 min", seconds: 900 },
  { label: "20 min", seconds: 1200 },
  { label: "30 min", seconds: 1800 },
  { label: "45 min", seconds: 2700 },
  { label: "1 hr", seconds: 3600 },
];

// ── Timer Component ──────────────────────────────────────────────────

export function CookingTimer({ timer, onUpdate, onRemove }) {
  const { id, label, totalSeconds, remaining, running } = timer;

  const progress = totalSeconds > 0 ? ((totalSeconds - remaining) / totalSeconds) * 100 : 0;
  const isComplete = remaining <= 0;

  return (
    <div
      className={`relative rounded-xl border p-4 transition-all ${
        isComplete
          ? "border-red-300 bg-red-50 shadow-md animate-pulse"
          : running
            ? "border-orange-200 bg-orange-50/50"
            : "border-muted bg-white"
      }`}
    >
      {/* Progress bar background */}
      {!isComplete && (
        <div
          className="absolute inset-0 rounded-xl bg-orange-100/40 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      )}

      <div className="relative flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
          <p
            className={`text-2xl font-mono font-bold tabular-nums ${
              isComplete ? "text-red-600" : running ? "text-orange-600" : "text-foreground"
            }`}
          >
            {isComplete ? "00:00" : formatTime(remaining)}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {isComplete ? (
            <>
              <BellRingIcon className="w-5 h-5 text-red-500 animate-bounce" />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2"
                onClick={() => onUpdate(id, { remaining: totalSeconds, running: false })}
              >
                <RotateCcwIcon className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => onUpdate(id, { running: !running })}
              >
                {running ? (
                  <PauseIcon className="w-3.5 h-3.5" />
                ) : (
                  <PlayIcon className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => onUpdate(id, { remaining: totalSeconds, running: false })}
              >
                <RotateCcwIcon className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(id)}
          >
            <XIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CookingTimers() {
  const [timers, setTimers] = useState([]);
  const [customMinutes, setCustomMinutes] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [expanded, setExpanded] = useState(true);
  const intervalRef = useRef(null);

  // Tick all running timers every second
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTimers((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          if (!t.running || t.remaining <= 0) return t;
          changed = true;
          const newRemaining = t.remaining - 1;
          if (newRemaining <= 0) {
            toast.success(`Timer done: ${t.label}`, {
              description: "Your cooking timer has finished!",
              duration: 10000,
            });
            // Play a beep if possible
            try {
              const ctx = new AudioContext();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = 880;
              gain.gain.value = 0.3;
              osc.start();
              osc.stop(ctx.currentTime + 0.5);
            } catch {
              // Audio not available
            }
          }
          return { ...t, remaining: Math.max(0, newRemaining) };
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const addTimer = useCallback((label, seconds) => {
    setTimers((prev) => [
      ...prev,
      {
        id: `timer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label,
        totalSeconds: seconds,
        remaining: seconds,
        running: true,
      },
    ]);
    setExpanded(true);
  }, []);

  const updateTimer = useCallback((id, updates) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const removeTimer = useCallback((id) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleCustomAdd = () => {
    const mins = parseFloat(customMinutes);
    if (!mins || mins <= 0) return;
    const seconds = Math.round(mins * 60);
    const label = customLabel.trim() || `${mins} min timer`;
    addTimer(label, seconds);
    setCustomMinutes("");
    setCustomLabel("");
  };

  const activeCount = timers.filter((t) => t.running && t.remaining > 0).length;
  const doneCount = timers.filter((t) => t.remaining <= 0).length;

  return (
    <Card className="border-orange-100">
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <TimerIcon className="w-5 h-5 text-orange-500" />
            <CardTitle className="text-xl">Cooking Timers</CardTitle>
            {activeCount > 0 && (
              <Badge className="bg-orange-500 text-white text-[11px]">
                {activeCount} running
              </Badge>
            )}
            {doneCount > 0 && (
              <Badge className="bg-red-500 text-white text-[11px] animate-pulse">
                {doneCount} done
              </Badge>
            )}
          </div>
          {expanded ? (
            <ChevronUpIcon className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        <p className="text-sm text-muted-foreground">
          Set timers while you cook. Notifications will alert you when time is up.
        </p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {/* Preset buttons */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Quick start</p>
            <div className="flex flex-wrap gap-2">
              {TIMER_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => addTimer(preset.label, preset.seconds)}
                >
                  <PlusIcon className="w-3 h-3 mr-1" />
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom timer */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Custom timer</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleCustomAdd();
              }}
            >
              <Input
                className="h-9 w-28"
                type="number"
                min="0.5"
                step="0.5"
                placeholder="Minutes"
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
              />
              <Input
                className="h-9 flex-1"
                placeholder="Label (optional), e.g. Boil pasta"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!customMinutes || parseFloat(customMinutes) <= 0}
              >
                <TimerIcon className="w-3.5 h-3.5 mr-1" />
                Start
              </Button>
            </form>
          </div>

          {/* Active timers */}
          {timers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Active timers ({timers.length})
              </p>
              {timers.map((timer) => (
                <CookingTimer
                  key={timer.id}
                  timer={timer}
                  onUpdate={updateTimer}
                  onRemove={removeTimer}
                />
              ))}
            </div>
          )}

          {timers.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No active timers. Use a preset or create a custom timer above.
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── YouTube Player ───────────────────────────────────────────────────

export function YouTubePlayer({ videoId, title }) {
  return (
    <div className="aspect-video rounded-lg overflow-hidden border bg-black">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
        title={title || "YouTube video"}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  );
}

// ── Main Export ──────────────────────────────────────────────────────

export function YouTubeSection({ savedRecipes = [] }) {
  const [pasteUrl, setPasteUrl] = useState("");
  const [embeddedVideoId, setEmbeddedVideoId] = useState(null);
  const [activeRecipeVideo, setActiveRecipeVideo] = useState(null);

  const recipesWithVideo = savedRecipes.filter((r) => extractVideoId(r.youtubeUrl));

  const handlePaste = () => {
    const id = extractVideoId(pasteUrl);
    if (id) {
      setEmbeddedVideoId(id);
      setPasteUrl("");
    }
  };

  return (
    <div className="space-y-6">
      {/* Cooking Timers */}
      <CookingTimers />

      {/* YouTube Videos */}
      <Card className="border-orange-100">
        <CardHeader>
          <div className="flex items-center gap-2">
            <PlayCircleIcon className="w-5 h-5 text-red-500" />
            <CardTitle className="text-xl">YouTube Recipes</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Watch cooking videos directly in the app while you cook.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Paste URL input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Paste a YouTube URL
            </label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handlePaste();
              }}
            >
              <div className="relative flex-1">
                <LinkIcon className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-8"
                  placeholder="https://youtube.com/watch?v=..."
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!extractVideoId(pasteUrl)}
              >
                Embed
              </Button>
            </form>
          </div>

          {/* Pasted video embed */}
          {embeddedVideoId && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground">Pasted video</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setEmbeddedVideoId(null)}
                >
                  <XIcon className="w-3.5 h-3.5 mr-1" />
                  Close
                </Button>
              </div>
              <YouTubePlayer videoId={embeddedVideoId} title="Pasted video" />
            </div>
          )}

          {/* Saved recipe videos */}
          {recipesWithVideo.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-3">
                From your saved recipes
              </p>
              {activeRecipeVideo ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">
                      {activeRecipeVideo.title}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground"
                      onClick={() => setActiveRecipeVideo(null)}
                    >
                      <XIcon className="w-3.5 h-3.5 mr-1" />
                      Close
                    </Button>
                  </div>
                  <YouTubePlayer
                    videoId={extractVideoId(activeRecipeVideo.youtubeUrl)}
                    title={activeRecipeVideo.title}
                  />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recipesWithVideo.map((recipe) => (
                    <button
                      key={`yt-thumb-${recipe.id}`}
                      type="button"
                      className="group relative rounded-lg overflow-hidden border hover:border-orange-300 transition-colors text-left"
                      onClick={() => setActiveRecipeVideo(recipe)}
                    >
                      <img
                        src={`https://img.youtube.com/vi/${extractVideoId(recipe.youtubeUrl)}/mqdefault.jpg`}
                        alt={recipe.title}
                        className="w-full aspect-video object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <PlayCircleIcon className="w-10 h-10 text-white drop-shadow-lg" />
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium line-clamp-1">
                          {recipe.title}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
