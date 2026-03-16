import React, { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { inventoryRestApi } from "@/api/inventoryRest";
import {
  TagIcon,
  RefreshCwIcon,
  PackageOpenIcon,
  LoaderCircleIcon,
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  StoreIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PackageIcon,
  MapPinIcon,
  NavigationIcon,
  SearchIcon,
  XIcon,
  LayoutListIcon,
  ArrowUpDownIcon,
} from "lucide-react";

function StoreLocationsList({ locations }) {
  const [expanded, setExpanded] = useState(false);

  if (!locations || locations.length === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 cursor-pointer"
      >
        <MapPinIcon className="w-3 h-3" />
        {locations.length} location{locations.length !== 1 ? "s" : ""} near you
        {expanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 pl-4">
          {locations.map((loc, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate flex-1">
                {loc.address || loc.name}
              </span>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 flex items-center gap-0.5 text-blue-600 hover:text-blue-800"
              >
                <NavigationIcon className="w-3 h-3" />
                Directions
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DealOption({ deal, storeLocations }) {
  const locations = storeLocations?.[deal.store] || [];

  return (
    <div className="rounded-xl border border-gray-100 bg-white hover:shadow-md transition-shadow overflow-hidden flex flex-col">
      {/* Image area */}
      <div className="relative bg-gray-50 flex items-center justify-center h-32">
        {deal.image_url ? (
          <img
            src={deal.image_url}
            alt={deal.item}
            className="w-full h-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <PackageIcon className="w-10 h-10 text-gray-300" />
        )}
        {deal.sale_story && (
          <Badge className="absolute top-2 left-2 text-[10px] bg-orange-500 text-white border-0 shadow-sm">
            {deal.sale_story}
          </Badge>
        )}
        {deal.weight && (
          <Badge
            variant="outline"
            className={`absolute bottom-2 right-2 text-[10px] shadow-sm ${
              deal.weight_source === "ocr"
                ? "bg-amber-50 text-amber-700 border-amber-300"
                : "bg-white/90 text-gray-700 border-gray-200"
            }`}
            title={deal.weight_source === "ocr" ? "Extracted via OCR from flyer image" : "Extracted from item text"}
          >
            {deal.weight_source === "ocr" && <span className="mr-0.5">🔍</span>}
            {deal.weight}
          </Badge>
        )}
      </div>

      {/* Info area */}
      <div className="p-3 flex flex-col flex-1">
        <p className="text-xs font-semibold leading-tight line-clamp-2 min-h-[2rem]">{deal.item}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {deal.merchant_logo ? (
            <img src={deal.merchant_logo} alt={deal.store} className="w-4 h-4 rounded-sm object-contain shrink-0" loading="lazy" />
          ) : (
            <StoreIcon className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-[11px] text-muted-foreground truncate">{deal.store}</span>
        </div>
        <StoreLocationsList locations={locations} />
        <div className="mt-auto pt-2">
          {deal.pre_price_text && (
            <span className="text-[10px] text-muted-foreground mr-1">{deal.pre_price_text}</span>
          )}
          <span className="text-lg font-extrabold text-emerald-700">{deal.price}</span>
          {deal.post_price_text && (
            <span className="text-[10px] text-muted-foreground ml-1">{deal.post_price_text}</span>
          )}
          {deal.unit_price_display && (
            <div className="text-[10px] text-blue-600 font-medium mt-0.5">
              {deal.unit_price_display}
            </div>
          )}
        </div>
        {(deal.valid_from || deal.valid_to) && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {deal.valid_from && `From ${new Date(deal.valid_from).toLocaleDateString()}`}
            {deal.valid_from && deal.valid_to && " — "}
            {deal.valid_to && `Until ${new Date(deal.valid_to).toLocaleDateString()}`}
          </p>
        )}
      </div>
    </div>
  );
}

function formatInventory(inv) {
  if (!inv) return null;
  const qty = inv.quantity ?? 0;
  const unit = inv.quantity_unit || inv.unit || "unit";
  return `${qty} ${unit}`;
}

function ItemDealsGroup({ itemName, data, inventory, defaultExpanded, storeLocations }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!data.found) {
    return (
      <Card className="border-gray-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm capitalize">{itemName}</h3>
              {inventory && (
                <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
                  <PackageIcon className="w-3 h-3 mr-0.5" />
                  {formatInventory(inventory)} left
                </Badge>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            No flyer deals found this week.
          </p>
        </CardContent>
      </Card>
    );
  }

  const allImages = data.options.map((d) => d.image_url).filter(Boolean);
  const previewImages = allImages.slice(0, 3);
  const extraCount = allImages.length - previewImages.length;

  return (
    <div className="hover:bg-blue-50/30 transition-colors">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between cursor-pointer py-3 px-4"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDownIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRightIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <h3 className="font-semibold text-sm capitalize">{itemName}</h3>
          {inventory && (
            <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
              <PackageIcon className="w-3 h-3 mr-0.5" />
              {formatInventory(inventory)} left
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
            {data.options.length} deal{data.options.length !== 1 ? "s" : ""}
          </Badge>
          {previewImages.length > 0 && (
            <div className="hidden sm:flex -space-x-2">
              {previewImages.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt=""
                  className="w-7 h-7 rounded-md object-contain bg-gray-50 border border-white ring-1 ring-gray-100"
                  loading="lazy"
                />
              ))}
              {extraCount > 0 && (
                <div className="w-7 h-7 rounded-md bg-gray-100 border border-white ring-1 ring-gray-100 flex items-center justify-center">
                  <span className="text-[10px] font-semibold text-gray-500">+{extraCount}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </button>
      {expanded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 px-4 pb-3">
          {data.options.map((deal, i) => (
            <DealOption key={`${itemName}-deal-${i}`} deal={deal} storeLocations={storeLocations} />
          ))}
        </div>
      )}
    </div>
  );
}

function StoreDealsGroup({ storeName, deals, inventoryItems, logo, storeLocations, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const locations = storeLocations?.[storeName] || [];

  const allImages = deals.map((d) => d.image_url).filter(Boolean);
  const previewImages = allImages.slice(0, 3);
  const extraCount = allImages.length - previewImages.length;

  return (
    <Card className="border-blue-100 transition-shadow">
      <CardContent className="p-4">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDownIcon className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            {logo ? (
              <img src={logo} alt={storeName} className="w-6 h-6 rounded object-contain shrink-0" loading="lazy" />
            ) : (
              <StoreIcon className="w-4 h-4 text-blue-500 shrink-0" />
            )}
            <h3 className="font-semibold text-base">{storeName}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
              <PackageIcon className="w-3 h-3 mr-0.5" />
              {inventoryItems.length} item{inventoryItems.length !== 1 ? "s" : ""}
            </Badge>
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
              {deals.length} deal{deals.length !== 1 ? "s" : ""}
            </Badge>
            {!expanded && previewImages.length > 0 && (
              <div className="flex -space-x-2">
                {previewImages.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt=""
                    className="w-8 h-8 rounded-md object-contain bg-gray-50 border border-white ring-1 ring-gray-100"
                    loading="lazy"
                  />
                ))}
                {extraCount > 0 && (
                  <div className="w-8 h-8 rounded-md bg-gray-100 border border-white ring-1 ring-gray-100 flex items-center justify-center">
                    <span className="text-[10px] font-semibold text-gray-500">+{extraCount}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </button>
        {!expanded && (
          <div className="ml-6 mt-1.5 flex flex-wrap gap-1">
            {inventoryItems.map((name) => (
              <span key={name} className="text-[11px] text-muted-foreground bg-gray-100 rounded-full px-2 py-0.5 capitalize">
                {name}
              </span>
            ))}
          </div>
        )}
        {!expanded && locations.length > 0 && (
          <div className="ml-6 mt-1">
            <StoreLocationsList locations={locations} />
          </div>
        )}
        {expanded && (
          <>
            <div className="ml-6 mt-1.5 flex flex-wrap gap-1">
              {inventoryItems.map((name) => (
                <span key={name} className="text-[11px] text-muted-foreground bg-gray-100 rounded-full px-2 py-0.5 capitalize">
                  {name}
                </span>
              ))}
            </div>
            {locations.length > 0 && (
              <div className="ml-6 mt-1 mb-3">
                <StoreLocationsList locations={locations} />
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3">
              {deals.map((deal, i) => (
                <DealOption key={`${storeName}-deal-${i}`} deal={deal} storeLocations={storeLocations} />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="border-gray-100 animate-pulse">
          <CardContent className="p-4 space-y-3">
            <div className="h-5 w-32 bg-gray-200 rounded" />
            <div className="h-16 bg-gray-100 rounded-lg" />
            <div className="h-16 bg-gray-100 rounded-lg" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const CATEGORY_OPTIONS = [
  { key: "all", label: "All" },
  { key: "food", label: "Food Items" },
  { key: "beverages", label: "Beverages" },
];

const LIMIT_OPTIONS = [5, 10, 20, 40, 60, 100];

const SORT_OPTIONS = [
  { key: "default", label: "Default" },
  { key: "price-asc", label: "Price: Low to High" },
  { key: "price-desc", label: "Price: High to Low" },
  { key: "unit-price-asc", label: "Unit Price: Low to High" },
  { key: "store-az", label: "Store: A-Z" },
  { key: "name-az", label: "Name: A-Z" },
];

function _parsePrice(deal) {
  try {
    return parseFloat(deal.price.replace("$", "").split(/\s/)[0]);
  } catch {
    return Infinity;
  }
}

function _sortDeals(deals, sortKey) {
  if (sortKey === "default" || !deals) return deals;
  const sorted = [...deals];
  switch (sortKey) {
    case "price-asc":
      sorted.sort((a, b) => _parsePrice(a) - _parsePrice(b));
      break;
    case "price-desc":
      sorted.sort((a, b) => _parsePrice(b) - _parsePrice(a));
      break;
    case "unit-price-asc":
      sorted.sort((a, b) => (a.unit_price ?? Infinity) - (b.unit_price ?? Infinity));
      break;
    case "store-az":
      sorted.sort((a, b) => (a.store || "").localeCompare(b.store || ""));
      break;
    case "name-az":
      sorted.sort((a, b) => (a.item || "").localeCompare(b.item || ""));
      break;
  }
  return sorted;
}

function SingleItemSearch() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState("default");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");

  const doSearch = useCallback(async (q, cat, lim) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearching(true);
    setResults(null);
    setSearchedQuery(trimmed);
    try {
      let data;
      if (cat === "food") {
        data = await inventoryRestApi.searchFoodDeals(trimmed, undefined, undefined, undefined, undefined, lim);
      } else if (cat === "beverages") {
        data = await inventoryRestApi.searchBeverageDeals(trimmed, undefined, undefined, undefined, undefined, lim);
      } else {
        data = await inventoryRestApi.searchDeal(trimmed, undefined, undefined, undefined, undefined, lim);
      }
      setResults(data);
    } catch (err) {
      setResults({ found: false, error: err.message });
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearch = useCallback(() => {
    doSearch(query, category, limit);
  }, [query, category, limit, doSearch]);

  const handleCategoryChange = useCallback((newCat) => {
    setCategory(newCat);
    if (query.trim()) {
      doSearch(query, newCat, limit);
    }
  }, [query, limit, doSearch]);

  const handleLimitChange = useCallback((newLimit) => {
    setLimit(newLimit);
    if (query.trim()) {
      doSearch(query, category, newLimit);
    }
  }, [query, category, doSearch]);

  const sortedOptions = useMemo(
    () => _sortDeals(results?.options, sortBy),
    [results?.options, sortBy],
  );

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search any item (e.g. chicken breast, bananas, milk)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2.5 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 placeholder:text-muted-foreground/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setResults(null); setSearchedQuery(""); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={!query.trim() || searching} className="shrink-0">
          {searching ? <LoaderCircleIcon className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
          Search
        </Button>
      </form>

      {/* Controls row: category toggle, limit, sort */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Category filter */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleCategoryChange(opt.key)}
              className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors border-r border-gray-200 last:border-r-0 ${
                category === opt.key
                  ? "bg-blue-50 text-blue-700"
                  : "bg-white text-muted-foreground hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Limit selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Show</span>
          <select
            value={limit}
            onChange={(e) => handleLimitChange(Number(e.target.value))}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 cursor-pointer"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {/* Sort selector */}
        <div className="flex items-center gap-1.5">
          <ArrowUpDownIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 cursor-pointer"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {searching && (
        <div className="flex items-center gap-2">
          <LoaderCircleIcon className="w-4 h-4 animate-spin text-blue-500" />
          <p className="text-sm text-muted-foreground">Searching flyers for "{searchedQuery}"...</p>
        </div>
      )}

      {results && !searching && (
        <>
          {results.found && sortedOptions?.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Found <strong>{sortedOptions.length}</strong> deal{sortedOptions.length !== 1 ? "s" : ""} for "<strong>{searchedQuery}</strong>"
                {category !== "all" && (
                  <span> in <strong>{CATEGORY_OPTIONS.find((o) => o.key === category)?.label}</strong></span>
                )}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {sortedOptions.map((deal, i) => (
                  <DealOption key={`search-deal-${i}`} deal={deal} storeLocations={results.store_locations || {}} />
                ))}
              </div>
            </div>
          ) : (
            <Card className="border-dashed border-gray-200">
              <CardContent className="p-8 text-center">
                <SearchIcon className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {results.error
                    ? `Search failed: ${results.error}`
                    : `No flyer deals found for "${searchedQuery}"${category !== "all" ? ` in ${CATEGORY_OPTIONS.find((o) => o.key === category)?.label}` : ""}`}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!results && !searching && (
        <Card className="border-dashed border-gray-200">
          <CardContent className="p-10 text-center">
            <SearchIcon className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Search for any grocery item to find current flyer deals near you.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function WeeklyDealsGrid({ deals, loading, error, onRefresh, freshness, checking }) {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("item"); // "item" | "store"
  const [tab, setTab] = useState("inventory"); // "inventory" | "single"

  const summary = deals?.summary;
  const inventory = deals?.inventory || {};
  const storeLocations = deals?.store_locations || {};

  const entries = useMemo(() => (summary ? Object.entries(summary) : []), [summary]);
  const withDeals = useMemo(() => entries.filter(([, v]) => v.found), [entries]);
  const withoutDeals = useMemo(() => entries.filter(([, v]) => !v.found), [entries]);

  // Aggregate deals by store, tracking inventory items and logos
  const storeGroups = useMemo(() => {
    const map = {};
    for (const [itemName, data] of withDeals) {
      if (!data.options) continue;
      for (const deal of data.options) {
        const store = deal.store || "Unknown Store";
        if (!map[store]) map[store] = { deals: [], items: new Set(), logo: "" };
        map[store].deals.push(deal);
        map[store].items.add(itemName);
        if (!map[store].logo && deal.merchant_logo) {
          map[store].logo = deal.merchant_logo;
        }
      }
    }
    return Object.entries(map)
      .map(([store, { deals, items, logo }]) => ({ store, deals, items: [...items], logo }))
      .sort((a, b) => b.deals.length - a.deals.length);
  }, [withDeals]);

  // Inventory tab state flags
  const inventoryLoading = loading;
  const inventoryError = error;
  const inventoryEmpty = !summary || entries.length === 0;

  const query = search.toLowerCase().trim();
  const filteredWithDeals = query
    ? withDeals.filter(([name, data]) =>
        name.toLowerCase().includes(query) ||
        data.options?.some((d) =>
          d.item?.toLowerCase().includes(query) ||
          d.store?.toLowerCase().includes(query)
        )
      )
    : withDeals;
  const filteredWithoutDeals = query
    ? withoutDeals.filter(([name]) => name.toLowerCase().includes(query))
    : withoutDeals;

  const filteredStoreGroups = query
    ? storeGroups
        .map((group) => {
          if (group.store.toLowerCase().includes(query)) return group;
          const matched = group.deals.filter((d) =>
            d.item?.toLowerCase().includes(query)
          );
          if (matched.length > 0) return { ...group, deals: matched };
          return null;
        })
        .filter(Boolean)
    : storeGroups;

  return (
    <div className="space-y-4">
      {/* Tab toggle: Inventory Deals vs Single Item Search */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab("inventory")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
            tab === "inventory"
              ? "bg-blue-500 text-white shadow-sm"
              : "bg-white/70 text-muted-foreground hover:bg-blue-100"
          }`}
        >
          <TagIcon className="w-3.5 h-3.5" />
          Inventory Deals
        </button>
        <button
          onClick={() => setTab("single")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
            tab === "single"
              ? "bg-blue-500 text-white shadow-sm"
              : "bg-white/70 text-muted-foreground hover:bg-blue-100"
          }`}
        >
          <SearchIcon className="w-3.5 h-3.5" />
          Single Item Search
        </button>
      </div>

      {tab === "single" ? (
        <SingleItemSearch />
      ) : inventoryLoading ? (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <LoaderCircleIcon className="w-4 h-4 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">
              Searching flyers for your inventory items...
            </p>
          </div>
          <LoadingSkeleton />
        </div>
      ) : inventoryError ? (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-8 text-center">
            <AlertCircleIcon className="w-8 h-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-700">{inventoryError.message}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onRefresh}>
              <RefreshCwIcon className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : inventoryEmpty ? (
        <Card className="border-dashed border-blue-200">
          <CardContent className="p-12 text-center">
            <PackageOpenIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No inventory items to search deals for. Add items to your inventory first!
            </p>
          </CardContent>
        </Card>
      ) : (
      <>
      <section className="rounded-xl border border-blue-100 bg-white p-4 space-y-3">
        {/* Row 1: Stats + Refresh */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-blue-100 p-1.5 rounded-lg">
              <TagIcon className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium">
                Found deals for <strong>{withDeals.length}</strong> of{" "}
                <strong>{entries.length}</strong> items
                {deals.postal_code && (
                  <span className="ml-1">near <strong>{deals.postal_code}</strong></span>
                )}
              </p>
              {freshness === "fresh" && deals && (
                <p className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                  <CheckCircle2Icon className="w-3 h-3" />
                  Deals match your current inventory.
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading || checking}>
            <RefreshCwIcon className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Stale warning */}
        {freshness === "stale" && (
          <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-2.5 text-sm text-amber-900 flex gap-2">
            <AlertTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Your inventory has changed since these deals were loaded.{" "}
              <button onClick={onRefresh} className="underline font-medium hover:text-amber-950 cursor-pointer">
                Refresh
              </button>{" "}
              to see updated deals.
            </span>
          </div>
        )}

        {/* Row 2: Search bar + View toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search items, deals, or stores..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 placeholder:text-muted-foreground/60"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <XIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setViewMode("item")}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                viewMode === "item"
                  ? "bg-blue-500 text-white shadow-sm"
                  : "bg-white/70 text-muted-foreground hover:bg-blue-100"
              }`}
            >
              <LayoutListIcon className="w-3.5 h-3.5" />
              By Item
            </button>
            <button
              onClick={() => setViewMode("store")}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                viewMode === "store"
                  ? "bg-blue-500 text-white shadow-sm"
                  : "bg-white/70 text-muted-foreground hover:bg-blue-100"
              }`}
            >
              <StoreIcon className="w-3.5 h-3.5" />
              By Store
            </button>
          </div>
        </div>
      </section>

      {viewMode === "item" ? (
        <>
          {query && filteredWithDeals.length === 0 && filteredWithoutDeals.length === 0 && (
            <Card className="border-dashed border-gray-200">
              <CardContent className="p-8 text-center">
                <SearchIcon className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No results for "<strong>{search}</strong>"
                </p>
              </CardContent>
            </Card>
          )}

          {filteredWithDeals.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
              {filteredWithDeals.map(([itemName, data], index) => (
                <ItemDealsGroup
                  key={itemName}
                  itemName={itemName}
                  data={data}
                  inventory={inventory[itemName]}
                  defaultExpanded={index === 0}
                  storeLocations={storeLocations}
                />
              ))}
            </div>
          )}

          {filteredWithoutDeals.length > 0 && (
            <p className="text-sm text-muted-foreground px-1">
              <strong>No deals this week:</strong>{" "}
              {filteredWithoutDeals.map(([name]) => name).join(", ")}
            </p>
          )}
        </>
      ) : (
        <>
          {query && filteredStoreGroups.length === 0 && (
            <Card className="border-dashed border-gray-200">
              <CardContent className="p-8 text-center">
                <SearchIcon className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No results for "<strong>{search}</strong>"
                </p>
              </CardContent>
            </Card>
          )}

          {filteredStoreGroups.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Deals available at <strong>{filteredStoreGroups.length}</strong> store{filteredStoreGroups.length !== 1 ? "s" : ""}
            </p>
          )}

          {filteredStoreGroups.map((group, index) => (
            <StoreDealsGroup
              key={group.store}
              storeName={group.store}
              deals={group.deals}
              inventoryItems={group.items}
              logo={group.logo}
              storeLocations={storeLocations}
              defaultExpanded={index === 0}
            />
          ))}
        </>
      )}
      </>
      )}
    </div>
  );
}
