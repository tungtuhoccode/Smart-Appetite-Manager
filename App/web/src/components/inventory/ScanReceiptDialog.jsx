import React, { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CameraIcon,
  UploadIcon,
  Loader2Icon,
  CheckCircle2Icon,
  XIcon,
} from "lucide-react";

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Scan Receipt dialog — upload image, show scanning spinner, then open chat with results.
 *
 * Flow:
 * 1. User picks/drops image → clicks "Scan Receipt"
 * 2. Dialog uploads image as artifact, sends chat message, shows scanning spinner
 * 3. When chat response arrives → dialog closes, chat panel opens with full conversation
 */
export function ScanReceiptDialog({ open, onOpenChange, client, onScanViaChat }) {
  const [step, setStep] = useState("upload"); // upload | scanning | complete
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const reset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setError(null);
  }, []);

  const handleClose = (isOpen) => {
    // Don't allow closing while scanning or showing completion
    if (!isOpen && (step === "scanning" || step === "complete")) return;
    if (!isOpen) reset();
    onOpenChange(isOpen);
  };

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(selectedFile.type)) {
      setError("Please select a JPG, PNG, or WebP image.");
      return;
    }
    setError(null);
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  };

  const handleScan = async () => {
    if (!file || !client) return;
    setStep("scanning");
    setError(null);
    try {
      const minDisplayMs = Math.random() * 10000 + 10000; // 10-20s
      const dataUrl = await fileToDataUrl(file);

      // Upload the artifact immediately (fast), but don't await chat response
      const result = await client.uploadArtifact(file, file.name);
      const uploadedFilename = result.filename || file.name;

      // Wait for the scanning animation timer to finish
      await new Promise((r) => setTimeout(r, minDisplayMs));

      // Show green checkmark for 1s
      setStep("complete");
      await new Promise((r) => setTimeout(r, 1000));

      // Close dialog, then fire chat send in background
      reset();
      onOpenChange(false);
      onScanViaChat?.(uploadedFilename, dataUrl);
    } catch (err) {
      setError(err.message || "Failed to scan receipt.");
      setStep("upload");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CameraIcon className="w-5 h-5" />
            Scan Receipt
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload a grocery receipt photo to extract items."}
            {step === "scanning" && "Analyzing your receipt with AI..."}
            {step === "complete" && "Receipt scanned successfully!"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Scanning spinner */}
        {step === "scanning" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2Icon className="w-10 h-10 animate-spin text-emerald-500" />
            <p className="text-sm font-medium text-muted-foreground">Scanning your receipt...</p>
            <p className="text-xs text-muted-foreground">This may take 10-20 seconds</p>
          </div>
        )}

        {/* Success checkmark */}
        {step === "complete" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="animate-[scale-in_0.4s_ease-out]">
              <CheckCircle2Icon className="w-14 h-14 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-emerald-600">Receipt scanned successfully!</p>
            <p className="text-xs text-muted-foreground">Opening chat...</p>
          </div>
        )}

        {/* Upload step */}
        {step === "upload" && (
          <div className="space-y-4">
            {!preview ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors"
              >
                <UploadIcon className="w-10 h-10 text-muted-foreground/50" />
                <div className="text-center">
                  <p className="text-sm font-medium">Drop receipt image here</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse (JPG, PNG, WebP)</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files[0])}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden border">
                  <img src={preview} alt="Receipt" className="w-full max-h-64 object-contain bg-gray-50" />
                  <button
                    onClick={() => { setFile(null); setPreview(null); }}
                    className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground truncate">{file?.name}</p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={handleScan} disabled={!file} className="gap-1.5">
                <CameraIcon className="w-4 h-4" />
                Scan Receipt
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
