export const RECIPE_CATEGORY_COLORS = [
  { value: "gray", label: "Gray", bg: "bg-gray-100", text: "text-gray-700", border: "border-gray-200", dot: "bg-gray-400", ring: "ring-gray-300", bgHover: "bg-gray-50" },
  { value: "orange", label: "Orange", bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200", dot: "bg-orange-400", ring: "ring-orange-300", bgHover: "bg-orange-50" },
  { value: "emerald", label: "Green", bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-400", ring: "ring-emerald-300", bgHover: "bg-emerald-50" },
  { value: "blue", label: "Blue", bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200", dot: "bg-blue-400", ring: "ring-blue-300", bgHover: "bg-blue-50" },
  { value: "violet", label: "Violet", bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-400", ring: "ring-violet-300", bgHover: "bg-violet-50" },
  { value: "rose", label: "Rose", bg: "bg-rose-100", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-400", ring: "ring-rose-300", bgHover: "bg-rose-50" },
  { value: "amber", label: "Amber", bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-400", ring: "ring-amber-300", bgHover: "bg-amber-50" },
  { value: "cyan", label: "Cyan", bg: "bg-cyan-100", text: "text-cyan-700", border: "border-cyan-200", dot: "bg-cyan-400", ring: "ring-cyan-300", bgHover: "bg-cyan-50" },
];

const colorMap = Object.fromEntries(
  RECIPE_CATEGORY_COLORS.map((c) => [c.value, c])
);

export function getRecipeCategoryColor(colorValue) {
  return colorMap[colorValue] || colorMap["gray"];
}
