import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function EditItemDialog({
  item,
  open,
  onOpenChange,
  onIncrease,
  onDecrease,
  loading,
}) {
  const [amount, setAmount] = useState("");

  if (!item) return null;

  const unit = item.quantity_unit || item.unit || "";
  const parsedAmount = parseFloat(amount);
  const isValid = !isNaN(parsedAmount) && parsedAmount > 0;

  const handleIncrease = () => {
    if (!isValid) return;
    onIncrease(item, parsedAmount);
    setAmount("");
  };

  const handleDecrease = () => {
    if (!isValid) return;
    onDecrease(item, parsedAmount);
    setAmount("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Update Stock</DialogTitle>
          <DialogDescription>
            Adjust the quantity for{" "}
            <span className="font-semibold text-foreground">
              {item.product_name}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <span className="text-sm text-muted-foreground">
              Current stock:
            </span>
            <Badge variant="secondary" className="text-base">
              {item.quantity} {unit}
            </Badge>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount to change</Label>
            <Input
              id="amount"
              type="number"
              min="0.01"
              step="any"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDecrease}
            disabled={loading || !isValid}
          >
            {loading ? "..." : `- Decrease`}
          </Button>
          <Button onClick={handleIncrease} disabled={loading || !isValid}>
            {loading ? "..." : `+ Increase`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
