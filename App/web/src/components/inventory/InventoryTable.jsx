import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function formatUpdatedAt(value) {
  if (!value) return "—";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

export function InventoryTable({
  items,
  loading,
  onEdit,
  onDelete,
  sortDirection = "desc",
  onToggleSort,
}) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">📦</div>
        <h3 className="text-lg font-semibold text-foreground">
          No items in inventory
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Add your first items to get started
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">Product</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead>Package</TableHead>
            <TableHead>
              <button
                type="button"
                className="font-medium text-left hover:underline cursor-pointer"
                onClick={onToggleSort}
                title="Sort by last updated"
              >
                Last Updated {sortDirection === "desc" ? "↓" : "↑"}
              </button>
            </TableHead>
            <TableHead className="text-right w-[120px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => {
            const key = item.id || `${item.product_name}-${index}`;
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">
                  {item.product_name}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Badge
                    variant={
                      Number(item.quantity) <= 0 ? "destructive" : "secondary"
                    }
                  >
                    {item.quantity}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.quantity_unit || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.unit || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatUpdatedAt(item.updated_at || item.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(item)}
                      title="Edit stock"
                    >
                      ✏️
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(item)}
                      title="Delete item"
                      className="text-destructive hover:text-destructive"
                    >
                      🗑️
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
