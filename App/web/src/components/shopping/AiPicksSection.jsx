import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { inventoryRestApi } from "@/api/inventoryRest";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SparklesIcon,
  PlusIcon,
  CheckIcon,
  PackageIcon,
  StoreIcon,
  ExternalLinkIcon,
  ChevronDownIcon,
} from "lucide-react";

function staggerStyle(index) {
  return { animation: `dealCardIn 400ms ease-out ${index * 60}ms both` };
}

/**
 * Extract per-unit price from package_sizing string.
 * e.g. "12 ea, $0.33/1ea" → { sizing: "12 ea", unitPrice: "$0.33/1ea" }
 *      "2 kg" → { sizing: "2 kg", unitPrice: null }
 */
function parseUnitPrice(packageSizing) {
  if (!packageSizing) return { sizing: null, unitPrice: null };
  const parts = packageSizing.split(",").map((s) => s.trim());
  const unitPart = parts.find((p) => /\$[\d.]+\//.test(p));
  const sizingParts = parts.filter((p) => p !== unitPart);
  return {
    sizing: sizingParts.length > 0 ? sizingParts.join(", ") : null,
    unitPrice: unitPart || null,
  };
}

function AiPickCard({ pick, onAdd, added, index }) {
  const [justAdded, setJustAdded] = useState(false);
  const { sizing, unitPrice } = parseUnitPrice(pick.package_sizing);

  const handleAdd = () => {
    if (added) return;
    setJustAdded(true);
    onAdd(pick);
    setTimeout(() => setJustAdded(false), 600);
  };

  return (
    <div
      className="rounded-xl border border-blue-100 bg-white hover:shadow-md transition-shadow overflow-hidden flex flex-col"
      style={staggerStyle(index)}
    >
      {/* Image area */}
      <div className="relative bg-gray-50 flex items-center justify-center h-32">
        {pick.image_url ? (
          <img
            src={pick.image_url}
            alt={pick.name}
            className="w-full h-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <PackageIcon className="w-10 h-10 text-gray-300" />
        )}
        <Badge className="absolute top-2 left-2 text-[10px] bg-sky-600 text-white border-0 shadow-sm gap-0.5">
          <SparklesIcon className="w-3 h-3" />
          AI Pick
        </Badge>
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
          {added ? <CheckIcon className="w-3.5 h-3.5" /> : <PlusIcon className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Info area */}
      <div className="p-3 flex flex-col flex-1">
        <p className="text-sm font-semibold leading-tight line-clamp-2 min-h-[2.25rem]">
          {pick.name}
        </p>

        {/* Store pill */}
        <div className="flex items-center gap-1.5 mt-2 px-2 py-1 bg-gray-50 rounded-full w-fit">
          {pick.store_logo ? (
            <img src={pick.store_logo} alt={pick.store} className="w-4 h-4 rounded-sm object-contain shrink-0" loading="lazy" />
          ) : (
            <StoreIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-[11px] font-medium text-gray-600">{pick.store}</span>
        </div>

        {/* Brand / sizing detail */}
        {(pick.brand || sizing) && (
          <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
            {[pick.brand, sizing].filter(Boolean).join(" · ")}
          </p>
        )}

        {/* Price + unit price */}
        <div className="mt-auto pt-2">
          <span className="text-xl font-extrabold text-emerald-700">{pick.price}</span>
          {unitPrice && (
            <span className="ml-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              {unitPrice}
            </span>
          )}
        </div>

        {/* Reason */}
        {pick.reason && (
          <p className="text-xs text-sky-700 bg-sky-50 rounded-md px-2.5 py-1.5 mt-2.5 leading-snug">
            {pick.reason}
          </p>
        )}

        {/* Store link */}
        {pick.link && (
          <a
            href={pick.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 mt-2"
          >
            <ExternalLinkIcon className="w-3 h-3" />
            View on {pick.store}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * AI Picks section — renders the LLM's curated product recommendations
 * with reasons, styled as a distinct section above the full product grid.
 */
export function AiPicksSection({ aiPicks, prompt, stores }) {
  const [expanded, setExpanded] = useState(true);
  const [addedIds, setAddedIds] = useState(new Set());
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleAdd = useCallback(
    async (pick) => {
      const key = `${pick.name}-${pick.price}`;
      if (addedIds.has(key)) return;
      try {
        await inventoryRestApi.addShoppingListItems([
          { product_name: pick.name, quantity: 1, quantity_unit: "unit", unit: "unit" },
        ]);
        setAddedIds((prev) => new Set(prev).add(key));
        toast.success(`Added "${pick.name}" to shopping list`);
      } catch (err) {
        toast.error("Failed to add to shopping list", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [addedIds]
  );

  if (!aiPicks || aiPicks.length === 0) return null;

  return (
    <div
      className={`transition-all duration-700 ease-out ${
        revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
    >
      <Card className="border-blue-100 bg-gradient-to-r from-sky-50/40 to-white">
        <CardContent className="p-4">
          {/* Collapsible header */}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-between w-full cursor-pointer"
          >
            <div className="flex items-start gap-2.5">
              <SparklesIcon className="w-5 h-5 text-sky-500 mt-0.5 shrink-0" />
              <div>
                {prompt && (
                  <p className="text-sm text-muted-foreground text-left">{prompt}</p>
                )}
                <h2 className="text-lg font-semibold text-left">
                  {aiPicks.length} AI Pick{aiPicks.length !== 1 ? "s" : ""}
                </h2>
              </div>
            </div>
            <ChevronDownIcon
              className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 ${
                !expanded ? "-rotate-90" : ""
              }`}
            />
          </button>

          {/* Pick cards grid */}
          {expanded && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {aiPicks.map((pick, i) => (
                <AiPickCard
                  key={`ai-pick-${i}`}
                  pick={pick}
                  onAdd={handleAdd}
                  added={addedIds.has(`${pick.name}-${pick.price}`)}
                  index={i}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
