import React, { useState, useRef, useEffect, useMemo } from "react";
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { getCategoryStyle } from "@/lib/categoryConfig";
import { FilterIcon, MoreHorizontal, Pencil, Trash2, SearchIcon } from "lucide-react";

function formatUpdatedAt(value) {
  if (!value) return "\u2014";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function SortableHeader({ field, label, sortField, sortDirection, onToggleSort, className = "" }) {
  const isActive = sortField === field;
  return (
    <button
      type="button"
      className={`font-medium text-left hover:underline cursor-pointer inline-flex items-center gap-1 ${className}`}
      onClick={() => onToggleSort(field)}
      title={`Sort by ${label}`}
    >
      {label}
      {isActive ? (sortDirection === "desc" ? " \u2193" : " \u2191") : ""}
    </button>
  );
}

function CategoryFilterHeader({
  sortField,
  sortDirection,
  onToggleSort,
  categoryFilter,
  onCategoryFilterChange,
  allItems = [],
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const isFiltered = categoryFilter !== "All";
  const existingCategories = useMemo(() => {
    const cats = new Set(allItems.map((item) => item.category || "Other"));
    return [...cats].sort();
  }, [allItems]);
  const allOptions = [{ value: "All", label: "All Categories" }, ...existingCategories.map((c) => ({ value: c, label: c }))];

  return (
    <div className="inline-flex items-center gap-1 relative">
      <SortableHeader
        field="category"
        label="Category"
        sortField={sortField}
        sortDirection={sortDirection}
        onToggleSort={onToggleSort}
      />
      <button
        type="button"
        className={`p-0.5 rounded hover:bg-muted transition-colors cursor-pointer ${isFiltered ? "text-emerald-600" : "text-muted-foreground"}`}
        onClick={() => setOpen((prev) => !prev)}
        title="Filter by category"
      >
        <FilterIcon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-1 z-50 w-44 rounded-md border bg-popover text-popover-foreground shadow-md py-1 max-h-64 overflow-y-auto"
        >
          {allOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer flex items-center justify-between ${
                categoryFilter === opt.value ? "font-semibold text-emerald-700 bg-emerald-50" : ""
              }`}
              onClick={() => {
                onCategoryFilterChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
              {categoryFilter === opt.value && <span className="text-emerald-600">&#10003;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FreshnessBadge({ expiresAt }) {
  if (!expiresAt) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expiresAt + "T00:00:00");
  const diffMs = exp - now;
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (days < 0) {
    const ago = Math.abs(days);
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
        {ago === 0 ? "Expired" : `${ago}d ago`}
      </span>
    );
  }
  if (days <= 3) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">
        {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
      {days}d
    </span>
  );
}

export function InventoryTable({
  items,
  loading,
  onEdit,
  onDelete,
  sortField = "updated_at",
  sortDirection = "desc",
  onToggleSort,
  newItemKeys = new Set(),
  itemKey,
  categoryFilter = "All",
  onCategoryFilterChange,
  allItems = [],
  searchQuery = "",
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
    const hasFilter = searchQuery.trim() || categoryFilter !== "All";
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">{hasFilter ? <SearchIcon className="w-10 h-10 text-muted-foreground" /> : "📦"}</div>
        <h3 className="text-lg font-semibold text-foreground">
          {hasFilter ? "No matching items" : "No items in inventory"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {hasFilter ? "Try adjusting your search or filter" : "Add your first items to get started"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[260px]">
              <SortableHeader field="product_name" label="Product" sortField={sortField} sortDirection={sortDirection} onToggleSort={onToggleSort} />
            </TableHead>
            <TableHead>
              <CategoryFilterHeader
                sortField={sortField}
                sortDirection={sortDirection}
                onToggleSort={onToggleSort}
                categoryFilter={categoryFilter}
                onCategoryFilterChange={onCategoryFilterChange}
                allItems={allItems}
              />
            </TableHead>
            <TableHead className="text-right">
              <SortableHeader field="quantity" label="Quantity" sortField={sortField} sortDirection={sortDirection} onToggleSort={onToggleSort} className="justify-end" />
            </TableHead>
            <TableHead>
              <SortableHeader field="quantity_unit" label="Unit" sortField={sortField} sortDirection={sortDirection} onToggleSort={onToggleSort} />
            </TableHead>
            <TableHead>
              <SortableHeader field="unit" label="Package" sortField={sortField} sortDirection={sortDirection} onToggleSort={onToggleSort} />
            </TableHead>
            <TableHead>
              <SortableHeader field="expires_at" label="Freshness" sortField={sortField} sortDirection={sortDirection} onToggleSort={onToggleSort} />
            </TableHead>
            <TableHead>
              <SortableHeader field="updated_at" label="Last Updated" sortField={sortField} sortDirection={sortDirection} onToggleSort={onToggleSort} />
            </TableHead>
            <TableHead className="text-right w-[80px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => {
            const key = item.id || `${item.product_name}-${index}`;
            const isNew = itemKey && newItemKeys.size > 0 && newItemKeys.has(itemKey(item));
            return (
              <TableRow
                key={key}
                className={isNew ? "animate-highlight-fade bg-emerald-50" : ""}
              >
                <TableCell className="font-medium">
                  {item.product_name}
                  {isNew && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      New
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getCategoryStyle(item.category)}`}>
                    {item.category || "Other"}
                  </span>
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
                  {item.quantity_unit || "\u2014"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.unit || "\u2014"}
                </TableCell>
                <TableCell>
                  <FreshnessBadge expiresAt={item.expires_at} />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatUpdatedAt(item.updated_at || item.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(item)}>
                        <Pencil className="h-4 w-4" />
                        Edit stock
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete item
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
