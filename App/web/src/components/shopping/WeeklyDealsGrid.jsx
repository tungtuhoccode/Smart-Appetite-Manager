import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const pricePerUnit = deal.pre_price_text || deal.post_price_text;
  const locations = storeLocations?.[deal.store] || [];

  return (
    <div className="flex gap-3 p-3 rounded-lg border border-gray-100 bg-white hover:shadow-sm transition-shadow">
      {deal.image_url && (
        <img
          src={deal.image_url}
          alt={deal.item}
          className="w-16 h-16 object-contain rounded-md bg-gray-50 shrink-0"
          loading="lazy"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium truncate">{deal.item}</p>
          <div className="text-right shrink-0">
            <span className="text-sm font-bold text-emerald-700">
              {deal.price}
            </span>
            {pricePerUnit && (
              <p className="text-[10px] text-muted-foreground">{pricePerUnit}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <StoreIcon className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{deal.store}</span>
        </div>
        <StoreLocationsList locations={locations} />
        {deal.sale_story && (
          <Badge
            variant="outline"
            className="mt-1.5 text-[10px] text-orange-700 border-orange-200 bg-orange-50"
          >
            {deal.sale_story}
          </Badge>
        )}
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
            <h3 className="font-semibold text-base capitalize">{itemName}</h3>
            {inventory && (
              <Badge variant="outline" className="text-[10px] text-gray-500 border-gray-200">
                <PackageIcon className="w-3 h-3 mr-0.5" />
                {formatInventory(inventory)} left
              </Badge>
            )}
          </div>
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
            {data.options.length} deal{data.options.length !== 1 ? "s" : ""}
          </Badge>
        </button>
        {expanded && (
          <div className="space-y-2 mt-3">
            {data.options.map((deal, i) => (
              <DealOption key={`${itemName}-deal-${i}`} deal={deal} storeLocations={storeLocations} />
            ))}
          </div>
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

export function WeeklyDealsGrid({ deals, loading, error, onRefresh, freshness, checking }) {
  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <LoaderCircleIcon className="w-4 h-4 animate-spin text-blue-500" />
          <p className="text-sm text-muted-foreground">
            Searching flyers for your inventory items...
          </p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="p-8 text-center">
          <AlertCircleIcon className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-sm text-red-700">{error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRefresh}>
            <RefreshCwIcon className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summary = deals?.summary;
  const inventory = deals?.inventory || {};
  const storeLocations = deals?.store_locations || {};

  if (!summary || Object.keys(summary).length === 0) {
    return (
      <Card className="border-dashed border-blue-200">
        <CardContent className="p-12 text-center">
          <PackageOpenIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No inventory items to search deals for. Add items to your inventory first!
          </p>
        </CardContent>
      </Card>
    );
  }

  const entries = Object.entries(summary);
  const withDeals = entries.filter(([, v]) => v.found);
  const withoutDeals = entries.filter(([, v]) => !v.found);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TagIcon className="w-5 h-5 text-blue-500" />
          <p className="text-sm text-muted-foreground">
            Found deals for <strong>{withDeals.length}</strong> of{" "}
            <strong>{entries.length}</strong> inventory items
            {deals.postal_code && (
              <span className="ml-1">near <strong>{deals.postal_code}</strong></span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading || checking}>
          <RefreshCwIcon className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {freshness === "stale" && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
          <AlertTriangleIcon className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Your inventory has changed since these deals were loaded.{" "}
            <button onClick={onRefresh} className="underline font-medium hover:text-amber-950">
              Refresh
            </button>{" "}
            to see updated deals.
          </span>
        </div>
      )}
      {freshness === "fresh" && deals && (
        <p className="text-xs text-emerald-600 flex items-center gap-1">
          <CheckCircle2Icon className="w-3.5 h-3.5" />
          Deals match your current inventory.
        </p>
      )}

      {withDeals.map(([itemName, data], index) => (
        <ItemDealsGroup
          key={itemName}
          itemName={itemName}
          data={data}
          inventory={inventory[itemName]}
          defaultExpanded={index === 0}
          storeLocations={storeLocations}
        />
      ))}

      {withoutDeals.length > 0 && (
        <Card className="border-gray-200 bg-gray-50/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              <strong>No deals this week:</strong>{" "}
              {withoutDeals.map(([name]) => name).join(", ")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
