import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { inventoryRestApi } from "@/api/inventoryRest";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CameraIcon,
  CameraOffIcon,
  CheckIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  MicIcon,
  MicOffIcon,
  MinusIcon,
  PackagePlusIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ScanBarcodeIcon,
  TriangleAlertIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

const CATEGORIES = [
  "Produce", "Dairy", "Meat", "Seafood", "Grains", "Beverages",
  "Snacks", "Condiments", "Frozen", "Baking", "Canned", "Other",
];

function useBarcodeDetectorSupported() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
  }, []);
  return supported;
}

function useSpeechRecognitionSupported() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        !!(window.SpeechRecognition || window.webkitSpeechRecognition)
    );
  }, []);
  return supported;
}

// --- Thumbnail ---

function ItemThumbnail({ imageUrl, alt, scanCount }) {
  const count = scanCount || 1;
  return (
    <div className="relative shrink-0">
      {imageUrl ? (
        <img src={imageUrl} alt={alt} className="w-12 h-12 rounded-lg object-contain bg-gray-50" />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center">
          <PackagePlusIcon className="w-5 h-5 text-gray-300" />
        </div>
      )}
      {count > 1 && (
        <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold shadow-sm">
          {count}
        </span>
      )}
    </div>
  );
}

// --- Inline edit fields ---

function EditFields({ draft, setDraft, onSave, onCancel }) {
  return (
    <div className="space-y-2 pt-2 border-t border-gray-100 mt-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Name</label>
          <Input
            value={draft.product_name}
            onChange={(e) => setDraft((d) => ({ ...d, product_name: e.target.value }))}
            className="h-7 text-xs mt-0.5"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Brand</label>
          <Input
            value={draft.brand || ""}
            onChange={(e) => setDraft((d) => ({ ...d, brand: e.target.value }))}
            className="h-7 text-xs mt-0.5"
            placeholder="Optional"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Qty</label>
          <Input
            type="number"
            step="any"
            value={draft.quantity}
            onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
            className="h-7 text-xs mt-0.5"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Unit</label>
          <Input
            value={draft.quantity_unit}
            onChange={(e) => setDraft((d) => ({ ...d, quantity_unit: e.target.value }))}
            className="h-7 text-xs mt-0.5"
            placeholder="g, mL, unit..."
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Category</label>
          <select
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            className="mt-0.5 w-full h-7 text-xs rounded-md border border-input bg-background px-2"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-6 px-2 text-[11px]">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!draft.product_name.trim()}
          className="h-6 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
        >
          <CheckIcon className="w-3 h-3" />
          Save
        </Button>
      </div>
    </div>
  );
}

// --- Voice recorder ---

function VoiceDescriptionInput({ onSave, onCancel }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef(null);
  const speechSupported = useSpeechRecognitionSupported();

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const parts = [];
      for (let i = 0; i < event.results.length; i++) {
        parts.push(event.results[i][0].transcript);
      }
      setTranscript(parts.join(" "));
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        toast.error("Voice recognition error", { description: event.error });
      }
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  const handleSave = () => {
    if (!transcript.trim()) return;
    onSave(transcript.trim());
  };

  return (
    <div className="space-y-2 pt-2 border-t border-gray-100 mt-2">
      <div className="flex items-start gap-2">
        {speechSupported && (
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              listening
                ? "bg-red-100 text-red-500 animate-pulse"
                : "bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-600"
            }`}
            title={listening ? "Stop recording" : "Start recording"}
          >
            {listening ? <MicOffIcon className="w-4 h-4" /> : <MicIcon className="w-4 h-4" />}
          </button>
        )}
        <div className="flex-1">
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={listening ? "Listening..." : "Describe this product (e.g. \"Large bag of organic quinoa, about 500g\")..."}
            rows={2}
            className="w-full text-xs rounded-md border border-input bg-background px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {listening && (
            <p className="text-[10px] text-red-500 mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              Recording... speak now
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-6 px-2 text-[11px]">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={!transcript.trim()}
          className="h-6 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
        >
          <CheckIcon className="w-3 h-3" />
          Save
        </Button>
      </div>
    </div>
  );
}

// --- Card variants ---

function PendingCard({ code }) {
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50/60 to-white p-3">
      <div className="w-12 h-12 rounded-lg bg-emerald-100/80 flex items-center justify-center shrink-0">
        <LoaderCircleIcon className="w-5 h-5 text-emerald-500 animate-spin" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <Skeleton className="h-3.5 w-32 rounded-full" />
        <span className="text-[11px] text-emerald-600 font-medium">
          Looking up {code}...
        </span>
      </div>
    </div>
  );
}

function FoundCard({ item, onRemove, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const count = item.scanCount || 1;

  const startEdit = () => {
    setDraft({
      product_name: item.product_name || "",
      brand: item.brand || "",
      quantity: item.quantity ?? 1,
      quantity_unit: item.quantity_unit || "unit",
      category: item.category || "Other",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    onUpdate({
      ...item,
      product_name: draft.product_name.trim(),
      brand: draft.brand.trim() || undefined,
      quantity: Number(draft.quantity) || 1,
      quantity_unit: draft.quantity_unit.trim() || "unit",
      category: draft.category,
    });
    setEditing(false);
  };

  const increment = () => onUpdate({ ...item, scanCount: count + 1 });
  const decrement = () => {
    if (count <= 1) {
      onRemove();
    } else {
      onUpdate({ ...item, scanCount: count - 1 });
    }
  };

  return (
    <div className="group rounded-xl border border-gray-200/80 bg-white hover:shadow-sm transition-shadow p-3">
      <div className="flex items-center gap-3">
        <ItemThumbnail imageUrl={item.image_url} alt={item.product_name} scanCount={count} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[13px] text-foreground leading-tight">
            {item.brand && (
              <span className="text-muted-foreground font-normal">{item.brand} &mdash; </span>
            )}
            {item.product_name}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 rounded-md">
              {item.category}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {count > 1 ? `${count} \u00d7 ` : ""}
              {item.quantity} {item.quantity_unit}
            </span>
            <span className="text-[10px] text-muted-foreground/40 font-mono">
              {item.code}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center border rounded-lg h-7 overflow-hidden">
            <button
              type="button"
              onClick={decrement}
              className="px-1.5 h-full hover:bg-gray-100 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title={count <= 1 ? "Remove item" : "Decrease count"}
            >
              {count <= 1 ? <Trash2Icon className="w-3 h-3 text-red-400" /> : <MinusIcon className="w-3 h-3" />}
            </button>
            <span className="px-1.5 text-xs font-medium tabular-nums min-w-[1.5rem] text-center">{count}</span>
            <button
              type="button"
              onClick={increment}
              className="px-1.5 h-full hover:bg-gray-100 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Increase count"
            >
              <PlusIcon className="w-3 h-3" />
            </button>
          </div>
          <button
            type="button"
            onClick={startEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-gray-100 text-gray-300 hover:text-gray-500 cursor-pointer"
          >
            <PencilIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {editing && (
        <EditFields
          draft={draft}
          setDraft={setDraft}
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function VoiceCard({ item, onRemove, onEdit }) {
  const count = item.scanCount || 1;
  return (
    <div className="group rounded-xl border border-blue-200/60 bg-blue-50/30 p-3">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="w-12 h-12 rounded-lg bg-blue-100/60 flex items-center justify-center">
            <MicIcon className="w-5 h-5 text-blue-400" />
          </div>
          {count > 1 && (
            <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] font-bold shadow-sm">
              {count}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[13px] text-foreground leading-tight">
            Voice description{count > 1 ? ` (\u00d7${count})` : ""}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 italic line-clamp-2">
            &ldquo;{item.voiceDescription}&rdquo;
          </p>
          <span className="text-[10px] text-muted-foreground/40 font-mono mt-0.5 block">
            {item.code}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-blue-100 text-gray-300 hover:text-blue-500 cursor-pointer"
          >
            <PencilIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-50 text-gray-300 hover:text-red-400 cursor-pointer"
          >
            <Trash2Icon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ code, message, scanCount, onRemove, onResolve }) {
  // "idle" | "form" | "voice"
  const [mode, setMode] = useState("idle");
  const count = scanCount || 1;
  const [draft, setDraft] = useState({
    product_name: "",
    brand: "",
    quantity: 1,
    quantity_unit: "unit",
    category: "Other",
  });

  const handleFormSave = () => {
    if (!draft.product_name.trim()) return;
    onResolve({
      status: "found",
      product_name: draft.product_name.trim(),
      brand: draft.brand.trim() || undefined,
      quantity: Number(draft.quantity) || 1,
      quantity_unit: draft.quantity_unit.trim() || "unit",
      category: draft.category,
      code,
      source: "manual",
      scanCount: count,
    });
  };

  const handleVoiceSave = (transcript) => {
    onResolve({
      status: "voice",
      voiceDescription: transcript,
      code,
      source: "voice",
      scanCount: count,
    });
  };

  return (
    <div className="group rounded-xl border border-amber-200/60 bg-amber-50/30 p-3">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="w-12 h-12 rounded-lg bg-amber-100/60 flex items-center justify-center">
            <TriangleAlertIcon className="w-5 h-5 text-amber-400" />
          </div>
          {count > 1 && (
            <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold shadow-sm">
              {count}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[13px] text-foreground">
            Not found{count > 1 ? ` (\u00d7${count})` : ""}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {message || `Code ${code} not recognized`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {mode === "idle" && (
            <>
              <button
                type="button"
                onClick={() => setMode("voice")}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                title="Describe by voice"
              >
                <MicIcon className="w-3 h-3" />
                Voice
              </button>
              <button
                type="button"
                onClick={() => setMode("form")}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer"
              >
                <PlusIcon className="w-3 h-3" />
                Manual
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-amber-100 text-gray-300 hover:text-amber-500 cursor-pointer"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {mode === "form" && (
        <EditFields
          draft={draft}
          setDraft={setDraft}
          onSave={handleFormSave}
          onCancel={() => setMode("idle")}
        />
      )}
      {mode === "voice" && (
        <VoiceDescriptionInput
          onSave={handleVoiceSave}
          onCancel={() => setMode("idle")}
        />
      )}
    </div>
  );
}

// --- Main component ---

let nextId = 0;

/**
 * @param {{ onAddViaChat?: (structuredItems: Array, voiceDescriptions: Array) => void }} props
 */
export function BarcodeScannerPanel({ onAddViaChat }) {
  const cameraSupported = useBarcodeDetectorSupported();
  const [manualCode, setManualCode] = useState("");
  const [entries, setEntries] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanMode, setScanMode] = useState("unique");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const scanLoopRef = useRef(null);
  const scannedCodesRef = useRef(new Set());
  const scanModeRef = useRef(scanMode);
  const stopCameraRef = useRef(null);

  useEffect(() => {
    scanModeRef.current = scanMode;
  }, [scanMode]);

  const stopCamera = useCallback(() => {
    setScanning(false);
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  stopCameraRef.current = stopCamera;

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const updateEntry = useCallback((id, data) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...data } : e)));
  }, []);

  const doLookup = useCallback(async (code, { fromCamera = false } = {}) => {
    const trimmed = (code || "").trim();
    if (!trimmed) return;

    const isBatch = scanModeRef.current === "batch";

    if (isBatch && scannedCodesRef.current.has(trimmed)) {
      setEntries((prev) => {
        const existing = prev.find((e) => e.code === trimmed && (e.status === "found" || e.status === "voice" || e.status === "error"));
        if (!existing) return prev;
        if (existing.status === "found") {
          toast.success(`+1 ${existing.brand ? existing.brand + " " : ""}${existing.product_name}`);
          return prev.map((e) =>
            e.id === existing.id ? { ...e, scanCount: (e.scanCount || 1) + 1 } : e
          );
        }
        // For error/voice entries, increment scanCount too
        const label = existing.status === "voice" ? "voice item" : `code ${trimmed}`;
        toast.info(`+1 ${label}`);
        return prev.map((e) =>
          e.id === existing.id ? { ...e, scanCount: (e.scanCount || 1) + 1 } : e
        );
      });
      return;
    }

    if (!isBatch && scannedCodesRef.current.has(trimmed)) {
      toast.info(`Already scanned: ${trimmed}`);
      return;
    }

    scannedCodesRef.current.add(trimmed);

    const entryId = ++nextId;
    setEntries((prev) => [{ id: entryId, status: "pending", code: trimmed }, ...prev]);

    if (fromCamera && !isBatch) {
      stopCameraRef.current?.();
    }

    try {
      const res = await inventoryRestApi.lookupBarcode(trimmed);
      if (res.status === "found") {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId ? { ...res, id: entryId, status: "found", scanCount: 1 } : e
          )
        );
      } else {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { id: entryId, status: "error", code: trimmed, message: res.message || `Code ${trimmed} not found` }
              : e
          )
        );
      }
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? { id: entryId, status: "error", code: trimmed, message: err.message }
            : e
        )
      );
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (scanning) {
      stopCamera();
      return;
    }
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setScanning(true);

      await new Promise((r) => requestAnimationFrame(r));

      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play().then(resolve).catch(resolve);
        };
      });

      detectorRef.current = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"],
      });

      let cooldownUntil = 0;

      const detect = async () => {
        if (!videoRef.current || !detectorRef.current || !streamRef.current) return;
        if (videoRef.current.readyState < 2) {
          scanLoopRef.current = requestAnimationFrame(detect);
          return;
        }
        const now = Date.now();
        if (now < cooldownUntil) {
          scanLoopRef.current = requestAnimationFrame(detect);
          return;
        }
        try {
          const barcodes = await detectorRef.current.detect(videoRef.current);
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            cooldownUntil = now + 2000;
            doLookup(code, { fromCamera: true });
          }
        } catch {}
        scanLoopRef.current = requestAnimationFrame(detect);
      };
      scanLoopRef.current = requestAnimationFrame(detect);
    } catch (err) {
      toast.error("Camera access denied", { description: err.message });
    }
  }, [scanning, stopCamera, doLookup]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    doLookup(manualCode);
    setManualCode("");
  };

  const handleRemoveEntry = (id) => {
    setEntries((prev) => {
      const entry = prev.find((e) => e.id === id);
      if (entry?.code) scannedCodesRef.current.delete(entry.code);
      return prev.filter((e) => e.id !== id);
    });
  };

  const handleResolveError = (id, data) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...data } : e)));
  };

  const foundEntries = entries.filter((e) => e.status === "found");
  const voiceEntries = entries.filter((e) => e.status === "voice");
  const addableCount = foundEntries.length + voiceEntries.length;
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const totalItemCount = foundEntries.reduce((sum, e) => sum + (e.scanCount || 1), 0);

  const handleAddToInventory = () => {
    if (addableCount === 0) return;
    const structured = foundEntries.map((it) => ({
      product_name: it.brand ? `${it.brand} ${it.product_name}` : it.product_name,
      quantity: (it.quantity || 1) * (it.scanCount || 1),
      quantity_unit: it.quantity_unit || "unit",
      category: it.category || "Other",
    }));
    const voice = voiceEntries.map((it) => ({
      description: it.voiceDescription,
      code: it.code,
      count: it.scanCount || 1,
    }));
    if (onAddViaChat) {
      onAddViaChat(structured, voice);
    }
    setEntries([]);
    scannedCodesRef.current.clear();
  };

  const hasEntries = entries.length > 0;

  return (
    <div className="space-y-5">
      {/* Top controls row */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        {cameraSupported && (
          <div className="flex items-center gap-2">
            <Button
              variant={scanning ? "default" : "outline"}
              size="sm"
              onClick={startCamera}
              className={`gap-1.5 ${scanning ? "bg-red-500 hover:bg-red-600 text-white" : ""}`}
            >
              {scanning ? <CameraOffIcon className="w-3.5 h-3.5" /> : <CameraIcon className="w-3.5 h-3.5" />}
              {scanning ? "Stop" : "Camera"}
            </Button>
            <div className="flex items-center h-8 rounded-lg border bg-muted/30 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setScanMode("unique")}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  scanMode === "unique" ? "bg-white text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ScanBarcodeIcon className="w-3 h-3 inline mr-1 -mt-px" />
                Unique
              </button>
              <button
                type="button"
                onClick={() => setScanMode("batch")}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  scanMode === "batch" ? "bg-white text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <CameraIcon className="w-3 h-3 inline mr-1 -mt-px" />
                Batch
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleManualSubmit} className="flex gap-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <ScanBarcodeIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Enter UPC or PLU code..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={!manualCode.trim()} className="h-8 px-3 text-xs">
            <SearchIcon className="w-3 h-3 mr-1" />
            Lookup
          </Button>
        </form>
      </div>

      {/* Camera + items */}
      <div className={scanning ? "grid grid-cols-1 md:grid-cols-2 gap-4 items-start" : ""}>
        {scanning && (
          <div className="space-y-1.5">
            <div className="relative rounded-xl overflow-hidden border-2 border-emerald-200 bg-black aspect-[4/3]">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-2/3 h-2/5 rounded-xl relative">
                  <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-emerald-400 rounded-tl-md" />
                  <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-emerald-400 rounded-tr-md" />
                  <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-emerald-400 rounded-bl-md" />
                  <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-emerald-400 rounded-br-md" />
                  <div className="absolute inset-x-2 top-0 h-0.5 bg-emerald-400/80 animate-[scan_2s_ease-in-out_infinite]" />
                </div>
              </div>
              <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white text-[11px] px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {scanMode === "batch" ? "Batch \u2014 duplicates count" : "Unique \u2014 one per item"}
              </div>
              {pendingCount > 0 && (
                <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm text-white text-[11px] px-2.5 py-1 rounded-full flex items-center gap-1.5">
                  <LoaderCircleIcon className="w-3 h-3 animate-spin" />
                  Looking up {pendingCount}...
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              {scanMode === "batch"
                ? "Scan the same barcode multiple times to increase quantity"
                : "Each barcode is scanned once \u2014 duplicates are skipped"}
            </p>
          </div>
        )}

        {hasEntries && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">Scanned Items</h4>
                {addableCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
                    {totalItemCount + voiceEntries.length > addableCount
                      ? `${addableCount} \u00d7 ${totalItemCount + voiceEntries.length}`
                      : addableCount}
                  </span>
                )}
                {pendingCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <LoaderCircleIcon className="w-3 h-3 animate-spin" />
                    {pendingCount} loading
                  </span>
                )}
              </div>
              {addableCount > 0 && (
                <Button
                  size="sm"
                  onClick={handleAddToInventory}
                  disabled={pendingCount > 0}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs rounded-lg"
                >
                  <MessageCircleIcon className="w-3.5 h-3.5" />
                  Add to Inventory
                </Button>
              )}
            </div>

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {entries.map((entry) => {
                if (entry.status === "pending") {
                  return <PendingCard key={entry.id} code={entry.code} />;
                }
                if (entry.status === "found") {
                  return (
                    <FoundCard
                      key={entry.id}
                      item={entry}
                      onRemove={() => handleRemoveEntry(entry.id)}
                      onUpdate={(data) => updateEntry(entry.id, data)}
                    />
                  );
                }
                if (entry.status === "voice") {
                  return (
                    <VoiceCard
                      key={entry.id}
                      item={entry}
                      onRemove={() => handleRemoveEntry(entry.id)}
                      onEdit={() => {
                        // Revert to error so user can re-describe
                        updateEntry(entry.id, {
                          status: "error",
                          message: `Code ${entry.code} not found \u2014 re-describe it`,
                          voiceDescription: undefined,
                        });
                      }}
                    />
                  );
                }
                return (
                  <ErrorCard
                    key={entry.id}
                    code={entry.code}
                    message={entry.message}
                    scanCount={entry.scanCount}
                    onRemove={() => handleRemoveEntry(entry.id)}
                    onResolve={(data) => handleResolveError(entry.id, data)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {!hasEntries && !scanning && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
            <ScanBarcodeIcon className="w-7 h-7 text-emerald-300" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No items scanned yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Use the camera or enter a barcode manually to get started
          </p>
        </div>
      )}

      <style>{`
        @keyframes scan {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(calc(100% + 8rem)); }
        }
      `}</style>
    </div>
  );
}
