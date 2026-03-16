import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { NavigationIcon, StarIcon } from "lucide-react";

/**
 * Card showing a store's deals summary.
 *
 * @param {object} props
 * @param {object} props.store - Store object from shopper_map_data
 */
export function StoreDealCard({ store }) {
  return (
    <Card
      className={`transition-shadow hover:shadow-md ${
        store.is_recommended
          ? "border-emerald-300 bg-emerald-50/30"
          : "border-gray-200"
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {store.logo_url && (
                <img
                  src={store.logo_url}
                  alt=""
                  className="w-5 h-5 rounded-sm object-contain shrink-0"
                />
              )}
              <h3 className="font-semibold text-base truncate">{store.store}</h3>
              {store.is_recommended && (
                <Badge className="bg-emerald-500 text-white text-[10px] shrink-0">
                  <StarIcon className="w-3 h-3 mr-0.5" />
                  Best Pick
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {store.items?.length || 0} item{(store.items?.length || 0) !== 1 ? "s" : ""} available
            </p>
            {store.address && (
              <p className="text-xs text-muted-foreground truncate">{store.address}</p>
            )}
          </div>
          {store.total > 0 && (
            <span className="text-lg font-bold text-emerald-700 whitespace-nowrap">
              ${store.total.toFixed(2)}
            </span>
          )}
        </div>

        {store.items && store.items.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {store.items.map((item, i) => (
              <div
                key={`deal-item-${i}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate text-muted-foreground">
                  {item.name}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {item.sale_story && (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-orange-700 border-orange-200 bg-orange-50"
                    >
                      {item.sale_story}
                    </Badge>
                  )}
                  <span className="font-medium">{item.price}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 pt-2 border-t">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.store)}&near=${store.lat},${store.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
          >
            <NavigationIcon className="w-3 h-3" />
            Get Directions
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
