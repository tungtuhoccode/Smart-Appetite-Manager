/**
 * Shared response parsing utilities.
 * Used by inventory and recipe pages to normalize agent responses.
 */

/**
 * Convert an agent result to displayable chat text.
 */
export function responseToChatText(result) {
  if (typeof result?.text === "string" && result.text.trim()) {
    return result.text.trim();
  }
  if (result?.data && typeof result.data === "string") {
    return result.data;
  }
  // Try to humanize raw JSON tool results instead of dumping JSON
  const rawObj = result?.raw ?? result?.data;
  if (rawObj && typeof rawObj === "object") {
    const friendly = humanizeToolResult(rawObj);
    if (friendly) return friendly;
    return JSON.stringify(rawObj, null, 2);
  }
  return "Done.";
}

/**
 * Attempt to convert a raw JSON tool result into a friendly sentence.
 * Returns null if the shape is unrecognized.
 */
function humanizeToolResult(obj) {
  // Flatten nested response wrappers
  const data = obj?.result?.status?.message?.parts?.[0]?.data ?? obj;

  if (typeof data !== "object" || data === null) return null;

  const status = data.status;
  const item = data.item;
  const name = item?.product_name || item?.name || "";

  if (status === "success" && data.deleted && name) {
    return `Done! I've removed **${name}** from your inventory.`;
  }
  if (status === "success" && data.added && name) {
    return `Done! I've added **${name}** to your inventory.`;
  }
  if (status === "success" && data.updated && name) {
    return `Done! I've updated **${name}** in your inventory.`;
  }
  if (status === "success" && typeof data.count === "number") {
    return `Done! Found **${data.count}** items in your inventory.`;
  }
  if (status === "success") {
    return "Done! The operation completed successfully.";
  }
  if (status === "error" && data.message) {
    return `Something went wrong: ${data.message}`;
  }

  return null;
}

/**
 * Extract an array of items from various response shapes.
 */
export function extractItems(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  const { data, type } = result;
  if (type === "json") {
    if (Array.isArray(data)) return data;
    if (data?.rows && Array.isArray(data.rows)) return data.rows;
    if (data?.data && Array.isArray(data.data)) return data.data;
  }
  if (type === "table" && Array.isArray(data)) return data;
  return [];
}

/**
 * Try to parse JSON from text, including markdown code blocks.
 */
export function tryParseJSON(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // not valid JSON in code block
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Extract a ```recipe_data JSON block from agent response text.
 * Returns { recipes: Array | null, cleanText: string }.
 */
export function extractRecipeData(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { recipes: null, cleanText: text || "" };
  }

  // Require closing ``` to be at the start of a line (\n```) to avoid
  // stopping early at triple-backticks embedded inside a JSON string value
  // (e.g. inside an instructions field like "Add ```flour``` and mix").
  const match = text.match(/```recipe_data[^\n]*\n([\s\S]*?)\n```/);
  if (!match) {
    return { recipes: null, cleanText: text };
  }

  let recipes = null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      recipes = parsed;
    }
  } catch {
    // invalid JSON in recipe_data block
  }

  // Remove the recipe_data block from the displayed text
  const cleanText = text.replace(/```recipe_data[^\n]*\n[\s\S]*?\n```/, "").trim();

  return { recipes, cleanText };
}

/**
 * Extract a ```route_plan_data JSON block from agent response text.
 * Returns { routeData: object | null, cleanText: string }.
 */
export function extractRoutePlanData(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { routeData: null, cleanText: text || "" };
  }

  const match = text.match(/```route_plan_data[^\n]*\n([\s\S]*?)\n```/);
  if (!match) {
    return { routeData: null, cleanText: text };
  }

  let routeData = null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.top_routes)) {
      routeData = parsed;
    }
  } catch {
    // invalid JSON in route_plan_data block
  }

  const cleanText = routeData
    ? text.replace(/```route_plan_data[^\n]*\n[\s\S]*?\n```/, "").trim()
    : text;

  return { routeData, cleanText };
}

/**
 * Extract a ```shopper_map_data JSON block from agent response text.
 * Returns { mapData: object | null, cleanText: string }.
 */
export function extractShopperMapData(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { mapData: null, cleanText: text || "" };
  }

  const match = text.match(/```shopper_map_data[^\n]*\n([\s\S]*?)\n```/);
  if (!match) {
    return { mapData: null, cleanText: text };
  }

  let mapData = null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.stores)) {
      mapData = parsed;
    }
  } catch {
    // invalid JSON in shopper_map_data block
  }

  // Only strip the block from text when we successfully parsed map data.
  // If parsing failed, leave the block so MarkdownRenderer can attempt to render it.
  const cleanText = mapData
    ? text.replace(/```shopper_map_data[^\n]*\n[\s\S]*?\n```/, "").trim()
    : text;

  return { mapData, cleanText };
}
