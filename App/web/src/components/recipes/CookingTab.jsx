import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CookingTimers, YouTubePlayer, extractVideoId, formatTime } from "./YouTubeSection";
import {
  PlayCircleIcon,
  LinkIcon,
  PlusIcon,
  XIcon,
  FileTextIcon,
  PencilIcon,
  Trash2Icon,
  SaveIcon,
  CookingPotIcon,
  ChefHatIcon,
} from "lucide-react";
import { toast } from "sonner";

// ── Cooking Notes persistence ───────────────────────────────────────

const NOTES_KEY = "cooking_notes_v1";

function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function generateNoteId() {
  return "note_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

// ── Note Editor ─────────────────────────────────────────────────────

function NoteCard({ note, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(!note.title && !note.content);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);

  const handleSave = () => {
    onUpdate(note.id, { title: title.trim(), content });
    setEditing(false);
    toast.success("Note saved");
  };

  const handleCancel = () => {
    setTitle(note.title);
    setContent(note.content);
    setEditing(false);
  };

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      {editing ? (
        <>
          <Input
            placeholder="Note title (e.g. Pasta Instructions)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="font-medium"
            autoFocus
          />
          <textarea
            className="w-full min-h-[160px] rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            placeholder="Write your cooking instructions, notes, or steps here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex items-center gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5"
            >
              <SaveIcon className="w-3.5 h-3.5" />
              Save
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-sm truncate">
                {note.title || "Untitled Note"}
              </h4>
              {note.updatedAt && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {new Date(note.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setEditing(true)}
              >
                <PencilIcon className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(note.id)}
              >
                <Trash2Icon className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          {note.content ? (
            <div
              className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed cursor-pointer rounded-lg hover:bg-muted/30 p-2 -m-2 transition-colors"
              onClick={() => setEditing(true)}
            >
              {note.content}
            </div>
          ) : (
            <div
              className="text-sm text-muted-foreground/50 italic cursor-pointer rounded-lg hover:bg-muted/30 p-2 -m-2 transition-colors"
              onClick={() => setEditing(true)}
            >
              Click to add cooking instructions...
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Cooking Notes Section ───────────────────────────────────────────

function CookingNotes() {
  const [notes, setNotes] = useState(loadNotes);

  useEffect(() => {
    persistNotes(notes);
  }, [notes]);

  const addNote = useCallback(() => {
    const newNote = {
      id: generateNoteId(),
      title: "",
      content: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setNotes((prev) => [newNote, ...prev]);
  }, []);

  const updateNote = useCallback((id, updates) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, ...updates, updatedAt: new Date().toISOString() }
          : n
      )
    );
  }, []);

  const deleteNote = useCallback((id) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    toast("Note deleted");
  }, []);

  return (
    <Card className="border-orange-100">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-orange-500" />
            <CardTitle className="text-xl">Cooking Notes</CardTitle>
            {notes.length > 0 && (
              <Badge variant="secondary" className="text-[11px]">
                {notes.length}
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={addNote}
            className="gap-1.5"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            New Note
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Write down your own instructions, cooking steps, or modifications.
          Notes are saved automatically in your browser.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {notes.length === 0 && (
          <div
            className="rounded-lg border-2 border-dashed border-orange-200 p-8 text-center cursor-pointer hover:bg-orange-50/30 transition-colors"
            onClick={addNote}
          >
            <FileTextIcon className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground font-medium">
              No cooking notes yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Click here to create your first note for recipes, instructions, or
              cooking tips.
            </p>
          </div>
        )}
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onUpdate={updateNote}
            onDelete={deleteNote}
          />
        ))}
      </CardContent>
    </Card>
  );
}

// ── YouTube Section (for Cooking Tab) ───────────────────────────────

function CookingYouTube({ savedRecipes = [] }) {
  const [pasteUrl, setPasteUrl] = useState("");
  const [embeddedVideoId, setEmbeddedVideoId] = useState(null);
  const [activeRecipeVideo, setActiveRecipeVideo] = useState(null);

  const recipesWithVideo = savedRecipes.filter((r) =>
    extractVideoId(r.youtubeUrl)
  );

  const handlePaste = () => {
    const id = extractVideoId(pasteUrl);
    if (id) {
      setEmbeddedVideoId(id);
      setPasteUrl("");
    }
  };

  return (
    <Card className="border-orange-100">
      <CardHeader>
        <div className="flex items-center gap-2">
          <PlayCircleIcon className="w-5 h-5 text-red-500" />
          <CardTitle className="text-xl">Cook Along Videos</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Watch cooking tutorials and follow along while you cook. Paste a
          video link to get started.
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
              <p className="text-xs font-medium text-muted-foreground">
                Pasted video
              </p>
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
                    key={`cook-yt-${recipe.id}`}
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

        {!activeRecipeVideo &&
          !embeddedVideoId &&
          recipesWithVideo.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <PlayCircleIcon className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              Paste a YouTube link above to start watching while you cook.
            </div>
          )}
      </CardContent>
    </Card>
  );
}

// ── Main Export ──────────────────────────────────────────────────────

export function CookingTab({ savedRecipes = [] }) {
  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 via-amber-50 to-white p-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shrink-0 shadow-md">
          <CookingPotIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Cooking Workspace</h2>
          <p className="text-sm text-muted-foreground">
            Your all-in-one cooking station. Set timers, write notes, and follow
            along with YouTube videos — all without leaving the app.
          </p>
        </div>
      </div>

      {/* Two-column layout on large screens */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Timers */}
        <CookingTimers />

        {/* Notes */}
        <CookingNotes />
      </div>

      {/* YouTube full width */}
      <CookingYouTube savedRecipes={savedRecipes} />
    </div>
  );
}
