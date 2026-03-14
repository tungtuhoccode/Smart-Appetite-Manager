import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChefHatIcon,
  ExternalLinkIcon,
  ClockIcon,
  UsersIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from "lucide-react";
import { normalizeText } from "@/lib/mealdb";

/**
 * Classify each ingredient in the full list as "in pantry" or "missing"
 * by fuzzy-matching against the used/missing ingredient name lists.
 */
function classifyIngredients(allIngredients, usedNames, missingNames) {
  const usedSet = new Set(usedNames.map(normalizeText));
  const missingSet = new Set(missingNames.map(normalizeText));

  const inPantry = [];
  const missing = [];
  const unknown = [];

  for (const item of allIngredients) {
    const norm = normalizeText(item);
    const inUsed = usedSet.has(norm) || [...usedSet].some((u) => norm.includes(u) || u.includes(norm));
    const inMissing = missingSet.has(norm) || [...missingSet].some((m) => norm.includes(m) || m.includes(norm));

    if (inUsed) {
      inPantry.push(item);
    } else if (inMissing) {
      missing.push(item);
    } else {
      unknown.push(item);
    }
  }

  return { inPantry, missing, unknown };
}

export function RecipeDetailsDialog({
  open,
  onOpenChange,
  selectedRecipe,
  recipeDetails,
  detailLoading,
  detailError,
}) {
  const title = recipeDetails?.title || selectedRecipe?.title || "Recipe details";
  const imageUrl = recipeDetails?.imageUrl || selectedRecipe?.imageUrl;
  const sourceUrl = recipeDetails?.sourceUrl || selectedRecipe?.sourceUrl;
  const readyInMinutes = recipeDetails?.readyInMinutes || selectedRecipe?.readyInMinutes;
  const servings = recipeDetails?.servings || selectedRecipe?.servings;
  const diets = recipeDetails?.diets || selectedRecipe?.diets || [];
  const cuisines = recipeDetails?.cuisines || selectedRecipe?.cuisines || [];
  const scores = recipeDetails?.scores || selectedRecipe?.scores;

  const usedIngredients = recipeDetails?.usedIngredients || selectedRecipe?.usedIngredients || [];
  const missingIngredients = recipeDetails?.missingIngredients || selectedRecipe?.missingIngredients || [];

  const hasGrouping = usedIngredients.length > 0 || missingIngredients.length > 0;
  const allIngredients = recipeDetails?.ingredients || [];

  const classified = hasGrouping && allIngredients.length > 0
    ? classifyIngredients(allIngredients, usedIngredients, missingIngredients)
    : null;

  const matchPercent = scores?.final_score != null
    ? Math.round(scores.final_score * 100)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1.5rem)] overflow-hidden p-0 sm:max-w-[720px]">
        <div className="overflow-y-auto overscroll-contain max-h-[92vh]">
          <div className="bg-muted/40 border-b p-4 rounded-t-lg">
            {imageUrl ? (
              <img src={imageUrl} alt={title} className="w-full max-h-96 object-contain rounded-lg" />
            ) : (
              <div className="flex h-48 w-full items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100 rounded-lg">
                <ChefHatIcon className="h-10 w-10 text-orange-500" />
              </div>
            )}
          </div>

          <div className="p-5 md:p-6">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {scores?.explanation || "Recipe details."}
              </DialogDescription>
            </DialogHeader>

            {/* Metadata badges */}
            <div className="mt-3 flex flex-wrap gap-2">
              {matchPercent != null && (
                <Badge
                  className={`text-xs ${
                    matchPercent >= 70
                      ? "bg-emerald-500 text-white"
                      : matchPercent >= 40
                        ? "bg-amber-500 text-white"
                        : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {matchPercent}% match
                </Badge>
              )}
              {readyInMinutes > 0 && (
                <Badge variant="outline" className="text-xs gap-1">
                  <ClockIcon className="w-3 h-3" />
                  {readyInMinutes} min
                </Badge>
              )}
              {servings > 0 && (
                <Badge variant="outline" className="text-xs gap-1">
                  <UsersIcon className="w-3 h-3" />
                  {servings} servings
                </Badge>
              )}
              {diets.map((diet) => (
                <Badge key={diet} className="bg-violet-50 text-violet-700 border-violet-200 text-xs">
                  {diet}
                </Badge>
              ))}
              {cuisines.map((cuisine) => (
                <Badge key={cuisine} variant="outline" className="text-xs">
                  {cuisine}
                </Badge>
              ))}
            </div>

            {detailLoading && <p className="mt-4 text-sm text-muted-foreground">Loading details...</p>}

            {detailError && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {detailError}
              </div>
            )}

            {!detailLoading && !detailError && (
              <div className="mt-4 space-y-5 pb-1">
                {/* Grouped ingredients: In Pantry vs Need to Buy */}
                {classified ? (
                  <section className="space-y-3">
                    {classified.inPantry.length > 0 && (
                      <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/50 p-4">
                        <h4 className="mb-2 font-semibold text-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2Icon className="w-4 h-4" />
                          In Pantry ({classified.inPantry.length})
                        </h4>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-emerald-900">
                          {classified.inPantry.map((item, i) => (
                            <li key={`pantry-${i}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(classified.missing.length > 0 || classified.unknown.length > 0) && (
                      <div className="rounded-lg border border-amber-200/60 bg-amber-50/50 p-4">
                        <h4 className="mb-2 font-semibold text-amber-800 flex items-center gap-1.5">
                          <AlertCircleIcon className="w-4 h-4" />
                          Need to Buy ({classified.missing.length + classified.unknown.length})
                        </h4>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                          {classified.missing.map((item, i) => (
                            <li key={`missing-${i}`}>{item}</li>
                          ))}
                          {classified.unknown.map((item, i) => (
                            <li key={`unknown-${i}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                ) : allIngredients.length > 0 ? (
                  <section className="rounded-lg border bg-muted/20 p-4">
                    <h4 className="mb-2 font-semibold">Ingredients</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {allIngredients.map((item, index) => (
                        <li key={`ingredient-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="rounded-lg border bg-muted/20 p-4">
                  <h4 className="mb-2 font-semibold">Instructions</h4>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {recipeDetails?.instructions || "Instructions were not returned for this recipe."}
                  </div>
                </section>

                {sourceUrl && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      window.open(sourceUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                    Open source
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
