import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChefHatIcon, ExternalLinkIcon } from "lucide-react";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] max-h-[92vh] w-[calc(100%-1.5rem)] overflow-hidden p-0 sm:max-w-[920px] md:h-[85vh]">
        <div className="grid h-full min-h-0 grid-rows-[auto,minmax(0,1fr)] gap-0 md:grid-cols-[340px,minmax(0,1fr)] md:grid-rows-1">
          <div className="min-h-0 border-b bg-muted/30 md:border-r md:border-b-0">
            {imageUrl ? (
              <img src={imageUrl} alt={title} className="h-56 w-full object-cover md:h-full" />
            ) : (
              <div className="flex h-56 w-full items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100 md:h-full">
                <ChefHatIcon className="h-10 w-10 text-orange-500" />
              </div>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain p-5 md:p-6">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>MealDB recipe details.</DialogDescription>
            </DialogHeader>

            {detailLoading && <p className="mt-4 text-sm text-muted-foreground">Loading details...</p>}

            {detailError && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {detailError}
              </div>
            )}

            {!detailLoading && !detailError && (
              <div className="mt-4 space-y-5 pb-1">
                {recipeDetails?.ingredients?.length > 0 && (
                  <section className="rounded-lg border bg-muted/20 p-4">
                    <h4 className="mb-2 font-semibold">Ingredients</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {recipeDetails.ingredients.map((item, index) => (
                        <li key={`ingredient-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </section>
                )}

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
