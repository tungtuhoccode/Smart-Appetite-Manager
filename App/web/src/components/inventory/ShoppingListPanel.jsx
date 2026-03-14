import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { getCategoryStyle } from "@/lib/categoryConfig";
import {
  CheckCircle2Icon,
  CircleIcon,
  Trash2Icon,
  PlusIcon,
  ListChecksIcon,
} from "lucide-react";

function QuickAddBar({ onAdd }) {
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;

    setAdding(true);
    // Parse simple format: "2 kg chicken breast" or just "chicken breast"
    const items = text.split(",").map((part) => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s+(.+)$/);
      if (match) {
        return {
          product_name: match[3],
          quantity: parseFloat(match[1]),
          quantity_unit: match[2],
          unit: match[2],
        };
      }
      const countMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      if (countMatch) {
        return {
          product_name: countMatch[2],
          quantity: parseFloat(countMatch[1]),
          quantity_unit: "unit",
          unit: "unit",
        };
      }
      return { product_name: trimmed, quantity: 1, quantity_unit: "unit", unit: "unit" };
    });

    const success = await onAdd(items);
    if (success) setValue("");
    setAdding(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. 2 kg chicken, 1 L milk, eggs"
        className="flex-1"
        disabled={adding}
      />
      <Button type="submit" size="sm" disabled={adding || !value.trim()} className="gap-1.5">
        <PlusIcon className="w-4 h-4" />
        Add
      </Button>
    </form>
  );
}

export function ShoppingListPanel({
  items,
  loading,
  onToggle,
  onDelete,
  onAdd,
  onClearChecked,
  checkedCount,
}) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <QuickAddBar onAdd={onAdd} />

      {items.length === 0 ? (
        <div className="text-center py-10">
          <ListChecksIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Your shopping list is empty. Add items above or ask SAM.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {items.map((item) => {
            const catStyle = getCategoryStyle(item.category || "Other");
            const isChecked = !!item.checked;
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  isChecked ? "bg-muted/40" : "hover:bg-muted/20"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggle(item.id)}
                  className="shrink-0 text-muted-foreground hover:text-emerald-600 transition-colors"
                  title={isChecked ? "Uncheck" : "Check"}
                >
                  {isChecked ? (
                    <CheckCircle2Icon className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <CircleIcon className="w-5 h-5" />
                  )}
                </button>

                <div className={`flex-1 min-w-0 ${isChecked ? "opacity-50" : ""}`}>
                  <p
                    className={`text-sm font-medium truncate ${
                      isChecked ? "line-through text-muted-foreground" : ""
                    }`}
                  >
                    {item.product_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.quantity} {item.quantity_unit || item.unit || ""}
                  </p>
                </div>

                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium shrink-0 ${catStyle}`}>
                  {item.category || "Other"}
                </span>

                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="shrink-0 text-muted-foreground/50 hover:text-destructive transition-colors"
                  title="Remove"
                >
                  <Trash2Icon className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {checkedCount > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClearChecked} className="gap-1.5 text-xs">
            <Trash2Icon className="w-3.5 h-3.5" />
            Clear {checkedCount} checked item{checkedCount !== 1 ? "s" : ""}
          </Button>
        </div>
      )}
    </div>
  );
}
