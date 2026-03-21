import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { inventoryRestApi } from "@/api/inventoryRest";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ShoppingCartIcon,
  PlusIcon,
  CheckIcon,
  ExternalLinkIcon,
  SearchIcon,
  PackageIcon,
  StoreIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";

function ProductTile({ product, store, storeInfo, onAdd, added }) {
  const hasDiscount = product.was_price || product.deal || product.member_price;
  const [justAdded, setJustAdded] = useState(false);

  const handleAdd = () => {
    if (added) return;
    setJustAdded(true);
    onAdd(product);
    setTimeout(() => setJustAdded(false), 600);
  };

  return (
    <div
      className="rounded-xl border border-gray-100 bg-white hover:shadow-md transition-shadow overflow-hidden flex flex-col"
    >
      {/* Image area */}
      <div className="relative bg-gray-50 flex items-center justify-center h-32">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <PackageIcon className="w-10 h-10 text-gray-300" />
        )}
        {hasDiscount && (
          <Badge className="absolute top-2 left-2 text-[10px] bg-orange-500 text-white border-0 shadow-sm">
            {product.deal || "Sale"}
          </Badge>
        )}
        {/* Add to list button overlaid on image */}
        <button
          onClick={handleAdd}
          disabled={added}
          className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-sm border transition-all duration-200 cursor-pointer ${
            added
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "bg-white/90 border-gray-200 text-gray-500 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-600"
          } ${justAdded ? "scale-125" : ""}`}
          title={added ? "Added to list" : "Add to shopping list"}
        >
          {added ? (
            <CheckIcon className="w-3.5 h-3.5" />
          ) : (
            <PlusIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Info area */}
      <div className="p-3 flex flex-col flex-1">
        <p className="text-xs font-semibold leading-tight line-clamp-2 min-h-[2rem]">
          {product.name}
        </p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {storeInfo?.store_logo ? (
            <img
              src={storeInfo.store_logo}
              alt={store}
              className="w-4 h-4 rounded-sm object-contain shrink-0"
              loading="lazy"
            />
          ) : (
            <StoreIcon className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-[11px] text-muted-foreground truncate">{store}</span>
        </div>
        {(product.brand || product.package_sizing) && (
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            {[product.brand, product.package_sizing].filter(Boolean).join(" · ")}
          </p>
        )}
        <div className="mt-auto pt-2">
          <span className="text-lg font-extrabold text-emerald-700">{product.price}</span>
          {product.was_price && (
            <span className="text-xs text-muted-foreground line-through ml-1.5">
              {product.was_price}
            </span>
          )}
          {product.member_price && (
            <div className="text-[10px] text-purple-600 font-medium mt-0.5">
              Member: {product.member_price}
            </div>
          )}
          {(product.price_per_kg || product.price_per_lb || product.price_per_unit) && (
            <div className="text-[10px] text-blue-600 font-medium mt-0.5">
              {product.price_per_kg
                ? `$${product.price_per_kg}/kg`
                : product.price_per_lb
                ? `$${product.price_per_lb}/lb`
                : product.price_per_unit
                ? `$${product.price_per_unit}/ea`
                : ""}
            </div>
          )}
        </div>
        {product.link && (
          <a
            href={product.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 mt-1.5"
          >
            <ExternalLinkIcon className="w-3 h-3" />
            View on {store}
          </a>
        )}
      </div>
    </div>
  );
}

function StoreSection({ storeName, storeInfo, queries, stores, addedIds, onAdd }) {
  const [expanded, setExpanded] = useState(true);
  const productCount = Array.from(queries.values()).reduce((s, items) => s + items.length, 0);

  return (
    <Card className="border-gray-200">
      <CardContent className="p-4">
        {/* Store header — collapsible */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-between w-full cursor-pointer"
        >
          <div className="flex items-center gap-2">
            {storeInfo?.store_logo ? (
              <img src={storeInfo.store_logo} alt="" className="w-6 h-6 rounded-sm object-contain" />
            ) : (
              <StoreIcon className="w-5 h-5 text-muted-foreground" />
            )}
            <h3 className="font-semibold text-sm">{storeName}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
              <PackageIcon className="w-3 h-3 mr-0.5" />
              {productCount} items
            </Badge>
            {expanded ? (
              <ChevronDownIcon className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Product tiles */}
        {expanded && (
          <div className="mt-4 space-y-4">
            {Array.from(queries.entries()).map(([query, items]) => (
              <div key={query}>
                {stores.length <= 1 && (
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {query} ({items.length})
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {items.map((product, i) => (
                    <ProductTile
                      key={`${storeName}-${query}-${i}`}
                      product={product}
                      store={storeName}
                      storeInfo={storeInfo}
                      onAdd={onAdd}
                      added={addedIds.has(`${product.name}-${product.price}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Grid of products from a pricing artifact with "Add to Shopping List" buttons.
 * Design matches the WeeklyDealsGrid style.
 */
export function DealProductsGrid({ pricingData }) {
  const [addedIds, setAddedIds] = useState(new Set());
  const [filter, setFilter] = useState("");

  const stores = pricingData.stores || (pricingData.store ? [{ store: pricingData.store, store_logo: pricingData.store_logo, store_url: pricingData.store_url }] : []);
  const products = pricingData.products || [];

  // Group products by store, then by query
  const storeGroups = useMemo(() => {
    const map = new Map();
    for (const p of products) {
      const s = p.store || stores[0]?.store || "Store";
      if (!map.has(s)) map.set(s, new Map());
      const queries = map.get(s);
      const q = p.query || "Other";
      if (!queries.has(q)) queries.set(q, []);
      queries.get(q).push(p);
    }
    return map;
  }, [products, stores]);

  // Filter
  const filteredStoreGroups = useMemo(() => {
    if (!filter.trim()) return storeGroups;
    const term = filter.toLowerCase();
    const filtered = new Map();
    for (const [storeName, queries] of storeGroups) {
      const fq = new Map();
      for (const [q, items] of queries) {
        const matching = items.filter(
          (p) =>
            p.name?.toLowerCase().includes(term) ||
            p.brand?.toLowerCase().includes(term) ||
            q.toLowerCase().includes(term) ||
            storeName.toLowerCase().includes(term)
        );
        if (matching.length > 0) fq.set(q, matching);
      }
      if (fq.size > 0) filtered.set(storeName, fq);
    }
    return filtered;
  }, [storeGroups, filter]);

  const totalFiltered = useMemo(() => {
    let count = 0;
    for (const queries of filteredStoreGroups.values())
      for (const items of queries.values()) count += items.length;
    return count;
  }, [filteredStoreGroups]);

  const handleAdd = useCallback(
    async (product) => {
      const key = `${product.name}-${product.price}`;
      if (addedIds.has(key)) return;
      try {
        await inventoryRestApi.addShoppingListItems([
          { product_name: product.name, quantity: 1, quantity_unit: "unit", unit: "unit" },
        ]);
        setAddedIds((prev) => new Set(prev).add(key));
        toast.success(`Added "${product.name}" to shopping list`);
      } catch (err) {
        toast.error("Failed to add to shopping list", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [addedIds]
  );

  const handleAddAll = useCallback(async () => {
    const items = products
      .filter((p) => !addedIds.has(`${p.name}-${p.price}`))
      .map((p) => ({ product_name: p.name, quantity: 1, quantity_unit: "unit", unit: "unit" }));
    if (items.length === 0) { toast.info("All products already added"); return; }
    try {
      await inventoryRestApi.addShoppingListItems(items);
      const newAdded = new Set(addedIds);
      products.forEach((p) => newAdded.add(`${p.name}-${p.price}`));
      setAddedIds(newAdded);
      toast.success(`Added ${items.length} item${items.length !== 1 ? "s" : ""} to shopping list`);
    } catch (err) {
      toast.error("Failed to add items", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [products, addedIds]);

  if (!products.length) return null;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShoppingCartIcon className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-semibold">
            Live Prices
          </h2>
          <Badge variant="outline" className="text-xs">
            {products.length} products
            {stores.length > 1 && ` at ${stores.length} stores`}
          </Badge>
        </div>
        <Button
          size="sm"
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white transition-transform hover:scale-105 active:scale-95"
          onClick={handleAddAll}
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Add All to List
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search items, brands, or stores..."
          className="pl-9 h-9"
        />
      </div>

      {/* Store groups */}
      {Array.from(filteredStoreGroups.entries()).map(([storeName, queries]) => {
        const storeInfo = stores.find((s) => s.store === storeName);
        return (
          <StoreSection
            key={storeName}
            storeName={storeName}
            storeInfo={storeInfo}
            queries={queries}
            stores={stores}
            addedIds={addedIds}
            onAdd={handleAdd}
          />
        );
      })}

      {totalFiltered === 0 && filter && (
        <p className="text-center text-sm text-muted-foreground py-6">
          No products match "{filter}"
        </p>
      )}
    </div>
  );
}
