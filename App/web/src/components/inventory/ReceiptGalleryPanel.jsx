import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CameraIcon, Trash2Icon, XIcon, ImageIcon } from "lucide-react";
import { deleteReceiptImage, clearReceiptImages } from "@/lib/receiptStore";

export function ReceiptGalleryPanel({ receipts, onRefresh, onScanClick }) {
  const [viewReceipt, setViewReceipt] = useState(null);

  const handleDelete = (id) => {
    deleteReceiptImage(id);
    onRefresh();
    if (viewReceipt?.id === id) setViewReceipt(null);
  };

  const handleClearAll = () => {
    clearReceiptImages();
    onRefresh();
  };

  if (!receipts.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
          <ImageIcon className="w-8 h-8 text-emerald-300" />
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">No receipts yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Scan a grocery receipt to see it here
          </p>
        </div>
        {onScanClick && (
          <Button variant="outline" onClick={onScanClick} className="gap-1.5 mt-2">
            <CameraIcon className="w-3.5 h-3.5" />
            Scan Receipt
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {receipts.map((r) => (
          <div
            key={r.id}
            className="group relative rounded-lg border overflow-hidden bg-gray-50 cursor-pointer hover:ring-2 hover:ring-emerald-400 transition-all"
            onClick={() => setViewReceipt(r)}
          >
            <img
              src={r.dataUrl}
              alt={r.filename}
              className="w-full h-32 object-cover"
            />
            <div className="px-2 py-1.5">
              <p className="text-[11px] font-medium truncate">{r.filename}</p>
              <p className="text-[10px] text-muted-foreground">
                {new Date(r.savedAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(r.id);
              }}
              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-black/60 text-white rounded-full p-1 hover:bg-red-600 transition-all"
              title="Delete"
            >
              <Trash2Icon className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          {receipts.length} receipt{receipts.length !== 1 ? "s" : ""}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearAll}
          className="text-xs text-destructive hover:text-destructive"
        >
          Clear All
        </Button>
      </div>

      {/* Fullscreen viewer */}
      <Dialog open={!!viewReceipt} onOpenChange={(open) => !open && setViewReceipt(null)}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm truncate">
              {viewReceipt?.filename}
            </DialogTitle>
          </DialogHeader>
          {viewReceipt && (
            <div className="space-y-3">
              <img
                src={viewReceipt.dataUrl}
                alt={viewReceipt.filename}
                className="w-full rounded-lg border"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Scanned {new Date(viewReceipt.savedAt).toLocaleString()}
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(viewReceipt.id)}
                  className="gap-1.5"
                >
                  <Trash2Icon className="w-3 h-3" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
