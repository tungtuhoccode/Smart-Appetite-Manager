import React, { useState, useRef, useCallback, useMemo } from "react";
import { RecipeCard } from "./RecipeCard";
import { getRecipeCategoryColor, RECIPE_CATEGORY_COLORS } from "@/lib/recipeCategoryColors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BookmarkIcon,
  LayoutDashboardIcon,
  Grid3x3Icon,
  ListIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  ChefHatIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  SearchIcon,
  FilterIcon,
  CheckCircle2Icon,
  XCircleIcon,
} from "lucide-react";

// ─── Toolbar ────────────────────────────────────────────────────────
function Toolbar({ viewMode, setViewMode, onAddCategory }) {
  const views = [
    { mode: "board", icon: LayoutDashboardIcon, label: "Board" },
    { mode: "grid", icon: Grid3x3Icon, label: "Grid" },
    { mode: "list", icon: ListIcon, label: "List" },
  ];
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-1 rounded-lg border p-0.5">
        {views.map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === mode
                ? "bg-orange-500 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={onAddCategory} className="gap-1.5">
        <PlusIcon className="w-3.5 h-3.5" />
        Add Category
      </Button>
    </div>
  );
}

// ─── Add / Rename Category Dialog ──────────────────────────────────
function CategoryDialog({ open, onOpenChange, onSubmit, initialName = "", initialColor = "orange", title: dialogTitle }) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  // Reset when opened
  const prevOpen = useRef(open);
  if (open && !prevOpen.current) {
    // using assignment in render is fine for resetting on open
    prevOpen.current = true;
  }
  if (!open && prevOpen.current) {
    prevOpen.current = false;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle || "New Category"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Input
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                onSubmit(name.trim(), color);
                onOpenChange(false);
              }
            }}
          />
          <div>
            <p className="text-xs text-muted-foreground mb-2">Color</p>
            <div className="flex flex-wrap gap-2">
              {RECIPE_CATEGORY_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-7 h-7 rounded-full ${c.dot} transition-all ${
                    color === c.value
                      ? "ring-2 ring-offset-2 ring-orange-400 scale-110"
                      : "hover:scale-105"
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (name.trim()) {
                onSubmit(name.trim(), color);
                onOpenChange(false);
              }
            }}
            disabled={!name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {dialogTitle === "Rename Category" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Category Column Header (used in board & grid) ──────────────────
function CategoryHeader({ category, recipeCount, onRename, onDelete, onColorChange, isUncategorized }) {
  const colorCfg = getRecipeCategoryColor(category.color);
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-t-lg ${colorCfg.bg}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorCfg.dot}`} />
        <span className={`text-sm font-semibold truncate ${colorCfg.text}`}>
          {category.name}
        </span>
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">
          {recipeCount}
        </Badge>
      </div>
      {!isUncategorized && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`p-1 rounded hover:bg-black/5 ${colorCfg.text}`}>
              <MoreHorizontalIcon className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onRename}>
              <PencilIcon className="w-3.5 h-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PaletteIcon className="w-3.5 h-3.5" />
                Change color
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {RECIPE_CATEGORY_COLORS.map((c) => (
                  <DropdownMenuItem key={c.value} onClick={() => onColorChange(c.value)}>
                    <span className={`w-3 h-3 rounded-full ${c.dot}`} />
                    {c.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon className="w-3.5 h-3.5" />
              Delete category
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ─── Draggable Recipe Card Wrapper ─────────────────────────────────
function DraggableRecipeCard({ recipe, onView, onToggleSave, isSaved, categories, onMoveRecipe }) {
  const handleDragStart = (e) => {
    e.dataTransfer.setData("text/plain", String(recipe.id));
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  };
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = "1";
  };

  return (
    <div draggable="true" onDragStart={handleDragStart} onDragEnd={handleDragEnd} className="relative group/drag">
      <div className="absolute top-2 left-2 z-10 opacity-0 group-hover/drag:opacity-60 transition-opacity cursor-grab">
        <GripVerticalIcon className="w-4 h-4 text-white drop-shadow" />
      </div>
      <RecipeCard
        recipe={recipe}
        onView={onView}
        isSaved={isSaved}
        onToggleSave={onToggleSave}
      />
      {/* Mobile fallback: move menu */}
      <div className="absolute top-2 left-2 z-10 sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded bg-white/80 backdrop-blur-sm shadow-sm">
              <FolderIcon className="w-3.5 h-3.5 text-gray-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {categories.map((cat) => (
              <DropdownMenuItem
                key={cat.id}
                disabled={cat.id === recipe.categoryId}
                onClick={() => onMoveRecipe(recipe.id, cat.id)}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${getRecipeCategoryColor(cat.color).dot}`} />
                {cat.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Board View (Kanban) ────────────────────────────────────────────
function BoardView({
  categories,
  recipesByCategory,
  onView,
  onToggleSave,
  isRecipeSaved,
  moveRecipe,
  onRenameCategory,
  onDeleteCategory,
  onColorChange,
}) {
  const [dropTarget, setDropTarget] = useState(null);

  const handleDragOver = (e, catId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(catId);
  };
  const handleDragLeave = (e, catId) => {
    // Only clear if leaving the actual column
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDropTarget(null);
    }
  };
  const handleDrop = (e, catId) => {
    e.preventDefault();
    setDropTarget(null);
    const recipeId = e.dataTransfer.getData("text/plain");
    if (recipeId) moveRecipe(recipeId, catId);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x">
      {categories.map((cat) => {
        const recipes = recipesByCategory.get(cat.id) || [];
        const isOver = dropTarget === cat.id;
        const isUncategorized = cat.id === "cat_uncategorized";
        return (
          <div
            key={cat.id}
            className={`flex-shrink-0 w-[300px] rounded-lg border bg-white transition-all snap-start ${
              isOver ? "ring-2 ring-orange-400 bg-orange-50/30" : ""
            }`}
            onDragOver={(e) => handleDragOver(e, cat.id)}
            onDragLeave={(e) => handleDragLeave(e, cat.id)}
            onDrop={(e) => handleDrop(e, cat.id)}
          >
            <CategoryHeader
              category={cat}
              recipeCount={recipes.length}
              onRename={() => onRenameCategory(cat)}
              onDelete={() => onDeleteCategory(cat)}
              onColorChange={(c) => onColorChange(cat.id, c)}
              isUncategorized={isUncategorized}
            />
            <div className="p-3 space-y-3 min-h-[120px]">
              {recipes.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center text-xs text-muted-foreground">
                  Drag recipes here
                </div>
              ) : (
                recipes.map((recipe) => (
                  <DraggableRecipeCard
                    key={`board-${recipe.id}`}
                    recipe={recipe}
                    onView={onView}
                    isSaved={true}
                    onToggleSave={onToggleSave}
                    categories={categories}
                    onMoveRecipe={moveRecipe}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Grid View (Grouped) ────────────────────────────────────────────
function GridView({
  categories,
  recipesByCategory,
  onView,
  onToggleSave,
  isRecipeSaved,
  moveRecipe,
  onRenameCategory,
  onDeleteCategory,
  onColorChange,
}) {
  const [collapsed, setCollapsed] = useState({});
  const [dropTarget, setDropTarget] = useState(null);

  const toggleCollapsed = (catId) => {
    setCollapsed((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  const handleDragOver = (e, catId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(catId);
  };
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null);
  };
  const handleDrop = (e, catId) => {
    e.preventDefault();
    setDropTarget(null);
    const recipeId = e.dataTransfer.getData("text/plain");
    if (recipeId) moveRecipe(recipeId, catId);
  };

  return (
    <div className="space-y-4">
      {categories.map((cat) => {
        const recipes = recipesByCategory.get(cat.id) || [];
        const isCollapsed = !!collapsed[cat.id];
        const isOver = dropTarget === cat.id;
        const isUncategorized = cat.id === "cat_uncategorized";
        const colorCfg = getRecipeCategoryColor(cat.color);

        return (
          <div
            key={cat.id}
            className={`rounded-lg border bg-white overflow-hidden transition-all ${
              isOver ? "ring-2 ring-orange-400" : ""
            }`}
            onDragOver={(e) => handleDragOver(e, cat.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, cat.id)}
          >
            <div className={`flex items-center gap-2 ${colorCfg.bg}`}>
              <button
                onClick={() => toggleCollapsed(cat.id)}
                className="flex items-center gap-2 flex-1 px-3 py-2.5 text-left"
              >
                {isCollapsed ? (
                  <ChevronRightIcon className={`w-4 h-4 ${colorCfg.text}`} />
                ) : (
                  <ChevronDownIcon className={`w-4 h-4 ${colorCfg.text}`} />
                )}
                <span className={`w-2.5 h-2.5 rounded-full ${colorCfg.dot}`} />
                <span className={`text-sm font-semibold ${colorCfg.text}`}>
                  {cat.name}
                </span>
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {recipes.length}
                </Badge>
              </button>
              {!isUncategorized && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className={`p-1 rounded hover:bg-black/5 mr-2 ${colorCfg.text}`}>
                      <MoreHorizontalIcon className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => onRenameCategory(cat)}>
                      <PencilIcon className="w-3.5 h-3.5" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <PaletteIcon className="w-3.5 h-3.5" />
                        Change color
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {RECIPE_CATEGORY_COLORS.map((c) => (
                          <DropdownMenuItem key={c.value} onClick={() => onColorChange(cat.id, c.value)}>
                            <span className={`w-3 h-3 rounded-full ${c.dot}`} />
                            {c.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => onDeleteCategory(cat)}>
                      <Trash2Icon className="w-3.5 h-3.5" />
                      Delete category
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {!isCollapsed && (
              <div className="p-4">
                {recipes.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center text-xs text-muted-foreground">
                    No recipes in this category
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {recipes.map((recipe) => (
                      <DraggableRecipeCard
                        key={`grid-${recipe.id}`}
                        recipe={recipe}
                        onView={onView}
                        isSaved={true}
                        onToggleSave={onToggleSave}
                        categories={categories}
                        onMoveRecipe={moveRecipe}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Sortable Column Header ─────────────────────────────────────────
function SortableHead({ label, field, sortField, sortDir, onSort, className = "" }) {
  const active = sortField === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 py-0.5 rounded"
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUpIcon className="w-3 h-3 text-orange-500" />
          ) : (
            <ArrowDownIcon className="w-3 h-3 text-orange-500" />
          )
        ) : (
          <ArrowUpDownIcon className="w-3 h-3 opacity-30" />
        )}
      </button>
    </TableHead>
  );
}

// ─── List View (Table) ──────────────────────────────────────────────
function ListView({
  categories,
  savedRecipes,
  onView,
  onToggleSave,
  moveRecipe,
}) {
  const [searchText, setSearchText] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortField, setSortField] = useState("match");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedRow, setExpandedRow] = useState(null);

  const handleDragStart = (e, recipeId) => {
    e.dataTransfer.setData("text/plain", String(recipeId));
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  };
  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = "1";
  };

  const getCategoryForRecipe = (recipe) => {
    return categories.find((c) => c.id === recipe.categoryId) || categories[0];
  };

  const getMatchPercent = (recipe) => {
    const hasScore = recipe.scores?.final_score != null;
    if (hasScore) return Math.round(recipe.scores.final_score * 100);
    const total = recipe.usedIngredients.length + recipe.missingIngredients.length;
    return total > 0 ? Math.round((recipe.usedIngredients.length / total) * 100) : 0;
  };

  const handleSort = useCallback((field) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(field === "title" ? "asc" : "desc");
      return field;
    });
  }, []);

  const filteredAndSorted = useMemo(() => {
    let list = [...savedRecipes];

    // Text filter
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.usedIngredients.some((i) => i.toLowerCase().includes(q)) ||
          r.missingIngredients.some((i) => i.toLowerCase().includes(q)) ||
          (r.diets || []).some((d) => d.toLowerCase().includes(q))
      );
    }

    // Category filter
    if (filterCategory !== "all") {
      list = list.filter(
        (r) => (r.categoryId || "cat_uncategorized") === filterCategory
      );
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "match":
          cmp = getMatchPercent(a) - getMatchPercent(b);
          break;
        case "used":
          cmp = a.usedIngredients.length - b.usedIngredients.length;
          break;
        case "missing":
          cmp = a.missingIngredients.length - b.missingIngredients.length;
          break;
        default:
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [savedRecipes, searchText, filterCategory, sortField, sortDir]);

  const activeFilters = (searchText.trim() ? 1 : 0) + (filterCategory !== "all" ? 1 : 0);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <SearchIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs bg-white"
            placeholder="Search recipes, ingredients, diets..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 text-xs w-[160px] bg-white">
            <FilterIcon className="w-3 h-3 mr-1 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {filterCategory === "all"
                ? "All categories"
                : (categories.find((c) => c.id === filterCategory)?.name || filterCategory)}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => {
              const cc = getRecipeCategoryColor(c.color);
              return (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${cc.dot}`} />
                    {c.name}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => { setSearchText(""); setFilterCategory("all"); }}
          >
            Clear filters
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {activeFilters}
            </Badge>
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredAndSorted.length} of {savedRecipes.length} recipes
        </span>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]"></TableHead>
              <SortableHead label="Recipe" field="title" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              <SortableHead label="Match" field="match" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="w-[80px] text-center" />
              <SortableHead label="Have" field="used" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="w-[70px] text-center" />
              <SortableHead label="Need" field="missing" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="w-[70px] text-center" />
              <TableHead>Diets</TableHead>
              <TableHead className="w-[160px]">Category</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                  No recipes match your filters.
                </TableCell>
              </TableRow>
            )}
            {filteredAndSorted.map((recipe) => {
              const cat = getCategoryForRecipe(recipe);
              const colorCfg = getRecipeCategoryColor(cat.color);
              const matchPct = getMatchPercent(recipe);
              const isExpanded = expandedRow === recipe.id;
              return (
                <React.Fragment key={`list-${recipe.id}`}>
                  <TableRow
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, recipe.id)}
                    onDragEnd={handleDragEnd}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => onView(recipe)}
                  >
                    <TableCell className="p-2">
                      {recipe.imageUrl ? (
                        <img
                          src={recipe.imageUrl}
                          alt={recipe.title}
                          className="w-12 h-12 rounded-md object-cover border"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center border">
                          <ChefHatIcon className="w-5 h-5 text-orange-400" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-sm line-clamp-1">{recipe.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{recipe.summary}</p>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={`text-[10px] ${
                          matchPct >= 70
                            ? "bg-emerald-100 text-emerald-700"
                            : matchPct >= 40
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {matchPct}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : recipe.id); }}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                        title="Click to expand ingredients"
                      >
                        <CheckCircle2Icon className="w-3 h-3" />
                        {recipe.usedIngredients.length}
                      </button>
                    </TableCell>
                    <TableCell className="text-center" onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : recipe.id); }}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                        title="Click to expand ingredients"
                      >
                        <XCircleIcon className="w-3 h-3" />
                        {recipe.missingIngredients.length}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(recipe.diets || []).slice(0, 2).map((diet) => (
                          <Badge
                            key={`list-diet-${recipe.id}-${diet}`}
                            className="bg-violet-50 text-violet-700 border-violet-200/60 text-[10px] px-1.5 py-0"
                          >
                            {diet}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={recipe.categoryId || "cat_uncategorized"}
                        onValueChange={(val) => moveRecipe(recipe.id, val)}
                      >
                        <SelectTrigger className="h-7 text-xs w-full">
                          <span className="flex items-center gap-1.5 truncate">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${colorCfg.dot}`} />
                            {cat.name}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => {
                            const cc = getRecipeCategoryColor(c.color);
                            return (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-1.5">
                                  <span className={`w-2 h-2 rounded-full ${cc.dot}`} />
                                  {c.name}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontalIcon className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onView(recipe)}>
                            <ChefHatIcon className="w-3.5 h-3.5" />
                            View recipe
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => onToggleSave(recipe)}>
                            <Trash2Icon className="w-3.5 h-3.5" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {/* Expanded ingredient detail row */}
                  {isExpanded && (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell />
                      <TableCell colSpan={7} className="py-3">
                        <div className="flex flex-col sm:flex-row gap-4">
                          {recipe.usedIngredients.length > 0 && (
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                                <CheckCircle2Icon className="w-3 h-3" />
                                In pantry ({recipe.usedIngredients.length})
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {recipe.usedIngredients.map((ing) => (
                                  <Badge
                                    key={`exp-used-${recipe.id}-${ing}`}
                                    className="bg-emerald-50 text-emerald-700 border-emerald-200/60 text-[10px] font-medium px-1.5 py-0"
                                  >
                                    {ing}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {recipe.missingIngredients.length > 0 && (
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-semibold text-red-600 mb-1.5 flex items-center gap-1">
                                <XCircleIcon className="w-3 h-3" />
                                Missing ({recipe.missingIngredients.length})
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {recipe.missingIngredients.map((ing) => (
                                  <Badge
                                    key={`exp-miss-${recipe.id}-${ing}`}
                                    variant="outline"
                                    className="text-[10px] text-muted-foreground border-dashed px-1.5 py-0"
                                  >
                                    {ing}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {recipe.usedIngredients.length === 0 && recipe.missingIngredients.length === 0 && (
                            <p className="text-xs text-muted-foreground">No ingredient data available.</p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────
export function SavedRecipesGrid({
  savedRecipes,
  onView,
  onToggleSave,
  isRecipeSaved,
  // New props
  categories,
  recipesByCategory,
  moveRecipe,
  viewMode,
  setViewMode,
  addCategory,
  renameCategory,
  deleteCategory,
  updateCategoryColor,
}) {
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [renameCat, setRenameCat] = useState(null); // { id, name, color }
  const [deleteCat, setDeleteCat] = useState(null); // category to confirm delete

  const handleAddCategory = useCallback(
    (name, color) => {
      addCategory(name, color);
    },
    [addCategory]
  );

  const handleRenameCategory = useCallback(
    (name, color) => {
      if (renameCat) {
        renameCategory(renameCat.id, name);
        if (color !== renameCat.color) updateCategoryColor(renameCat.id, color);
        setRenameCat(null);
      }
    },
    [renameCat, renameCategory, updateCategoryColor]
  );

  // Empty state
  if (savedRecipes.length === 0 && (!categories || categories.length <= 1)) {
    return (
      <div className="rounded-xl border-2 border-dashed border-orange-200 p-12 text-center">
        <BookmarkIcon className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No saved recipes yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Browse the Discover tab and tap the bookmark icon on any recipe card to save it here.
        </p>
      </div>
    );
  }

  return (
    <>
      <Toolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        onAddCategory={() => setAddCatOpen(true)}
      />

      {viewMode === "board" && (
        <BoardView
          categories={categories}
          recipesByCategory={recipesByCategory}
          onView={onView}
          onToggleSave={onToggleSave}
          isRecipeSaved={isRecipeSaved}
          moveRecipe={moveRecipe}
          onRenameCategory={(cat) => setRenameCat(cat)}
          onDeleteCategory={(cat) => setDeleteCat(cat)}
          onColorChange={updateCategoryColor}
        />
      )}

      {viewMode === "grid" && (
        <GridView
          categories={categories}
          recipesByCategory={recipesByCategory}
          onView={onView}
          onToggleSave={onToggleSave}
          isRecipeSaved={isRecipeSaved}
          moveRecipe={moveRecipe}
          onRenameCategory={(cat) => setRenameCat(cat)}
          onDeleteCategory={(cat) => setDeleteCat(cat)}
          onColorChange={updateCategoryColor}
        />
      )}

      {viewMode === "list" && (
        <ListView
          categories={categories}
          savedRecipes={savedRecipes}
          onView={onView}
          onToggleSave={onToggleSave}
          moveRecipe={moveRecipe}
        />
      )}

      {/* Add Category Dialog */}
      <CategoryDialog
        open={addCatOpen}
        onOpenChange={setAddCatOpen}
        onSubmit={handleAddCategory}
        title="New Category"
      />

      {/* Rename Category Dialog */}
      <CategoryDialog
        open={!!renameCat}
        onOpenChange={(open) => { if (!open) setRenameCat(null); }}
        onSubmit={handleRenameCategory}
        initialName={renameCat?.name || ""}
        initialColor={renameCat?.color || "orange"}
        title="Rename Category"
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteCat} onOpenChange={(open) => { if (!open) setDeleteCat(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteCat?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              All recipes in this category will be moved to Uncategorized. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteCat) deleteCategory(deleteCat.id);
                setDeleteCat(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
