/**
 * Agent API Layer
 *
 * Prompt-based API functions for each agent. Instead of REST endpoints,
 * each function crafts a natural language prompt, sends it to the appropriate
 * agent via the gateway, and parses the structured response for the frontend.
 *
 * Usage:
 *   const api = createAgentAPI(gatewayClient);
 *   const items = await api.inventory.list();
 *   const recipes = await api.recipes.searchByIngredients(["rice", "chicken"]);
 */

// Agent name constants
export const AGENTS = {
  INVENTORY: "InventoryManager",
  ORCHESTRATOR: "OrchestratorAgent",
  RECIPE: "RecipeLookup",
  SHOPPER: "ShopperAgent",
  RECIPE_RESEARCH: "RecipeResearchAgent",
};

/**
 * Parse structured data from agent text responses.
 * Agents may return JSON blocks, markdown tables, or plain text.
 */
function tryParseJSON(text) {
  // Try to extract JSON from markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // not valid JSON in code block
    }
  }

  // Try to parse the entire text as JSON
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Parse a markdown table into an array of objects.
 */
function parseMarkdownTable(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  const tableLines = lines.filter((l) => l.includes("|"));

  if (tableLines.length < 2) return null;

  const headerLine = tableLines[0];
  const headers = headerLine
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);

  // Skip separator line (---|---|---)
  const dataLines = tableLines.slice(1).filter((l) => !l.match(/^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)*\|?\s*$/));

  if (dataLines.length === 0) return null;

  return dataLines.map((line) => {
    const values = line
      .split("|")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    const row = {};
    headers.forEach((header, i) => {
      const key = header.toLowerCase().replace(/\s+/g, "_");
      const val = values[i] || "";
      // Try to parse numbers
      const num = Number(val);
      row[key] = val !== "" && !isNaN(num) ? num : val;
    });
    return row;
  });
}

/**
 * Best-effort extraction of structured data from agent response text.
 */
function parseResponse(text) {
  const json = tryParseJSON(text);
  if (json) return { type: "json", data: json };

  const table = parseMarkdownTable(text);
  if (table) return { type: "table", data: table };

  return { type: "text", data: text };
}

/**
 * Creates the agent API bound to a gateway client instance.
 */
export function createAgentAPI(client) {
  /**
   * Helper: send a prompt to an agent and return parsed response.
   */
  async function query(agentName, prompt, options = {}) {
    const response = await client.send(prompt, agentName, options);
    const parsed = parseResponse(response.text);
    return {
      ...parsed,
      text: response.text,
      raw: response.raw,
      taskId: response.taskId,
    };
  }

  // ── Inventory Agent API ──────────────────────────────────────────────

  const inventory = {
    /**
     * List all inventory items.
     * @returns {Promise<{ data: Array<{product_name, quantity, quantity_unit, unit}>, text, raw }>}
     */
    async list(options = {}) {
      return query(
        AGENTS.INVENTORY,
        "List all current inventory items. Return the data as a JSON array with fields: product_name, quantity, quantity_unit, unit. Only respond with the JSON, no extra text.",
        options
      );
    },

    /**
     * Add items to inventory.
     * @param {string} description - Natural language description, e.g. "2 kg rice, 1 liter milk, 6 eggs"
     */
    async addItems(description, options = {}) {
      return query(
        AGENTS.INVENTORY,
        `Add the following items to inventory: ${description}. After adding, return the updated list of all inventory items as a JSON array with fields: product_name, quantity, quantity_unit, unit. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Increase stock of an existing item.
     * @param {string} productName
     * @param {number} amount
     * @param {string} unit - e.g. "kg", "L", "unit"
     */
    async increaseStock(productName, amount, unit, options = {}) {
      return query(
        AGENTS.INVENTORY,
        `Increase the stock of "${productName}" by ${amount} ${unit}. After updating, return the updated item as JSON with fields: product_name, quantity, quantity_unit, unit. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Decrease stock of an existing item.
     * @param {string} productName
     * @param {number} amount
     * @param {string} unit - e.g. "kg", "L", "unit"
     */
    async decreaseStock(productName, amount, unit, options = {}) {
      return query(
        AGENTS.INVENTORY,
        `Decrease the stock of "${productName}" by ${amount} ${unit}. After updating, return the updated item as JSON with fields: product_name, quantity, quantity_unit, unit. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Delete an item from inventory entirely.
     * @param {string} productName
     */
    async deleteItem(productName, options = {}) {
      return query(
        AGENTS.INVENTORY,
        `Delete the item "${productName}" completely from the inventory. Remove the entire row. After deleting, return a JSON response: {"status": "success", "deleted": "${productName}"}. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Free-form inventory prompt for complex operations.
     * @param {string} prompt - Any natural language request about inventory
     */
    async prompt(prompt, options = {}) {
      return query(AGENTS.INVENTORY, prompt, options);
    },
  };

  // ── Recipe Agent API ─────────────────────────────────────────────────

  const recipes = {
    /**
     * Search recipes by available ingredients.
     * @param {string[]} ingredients - List of ingredient names
     */
    async searchByIngredients(ingredients, options = {}) {
      const ingredientList = ingredients.join(", ");
      return query(
        AGENTS.ORCHESTRATOR,
        `Find the top 3 recipes I can make with these ingredients: ${ingredientList}. Return as a JSON array where each recipe has: id, title, used_ingredients (array of strings), missing_ingredients (array of strings), image_url. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Get detailed recipe instructions.
     * @param {string} recipeQuery - Recipe name or ID
     */
    async getDetails(recipeQuery, options = {}) {
      return query(
        AGENTS.ORCHESTRATOR,
        `Get the full recipe details for: ${recipeQuery}. Return as JSON with fields: title, ingredients (array of {name, measure}), instructions (string), image_url, source_url. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Get a random recipe suggestion.
     */
    async getRandom(options = {}) {
      return query(
        AGENTS.ORCHESTRATOR,
        "Suggest a random recipe. Return as JSON with fields: title, ingredients (array of {name, measure}), instructions (string), image_url. Only respond with the JSON.",
        options
      );
    },

    /**
     * Suggest recipes based on current inventory.
     */
    async suggestFromInventory(options = {}) {
      return query(
        AGENTS.ORCHESTRATOR,
        "Look at my current inventory and suggest the top 3 recipes I can make with those ingredients. Return as a JSON array where each recipe has: id, title, used_ingredients, missing_ingredients, image_url. Only respond with the JSON.",
        options
      );
    },

    /**
     * Free-form recipe prompt.
     */
    async prompt(prompt, options = {}) {
      return query(AGENTS.ORCHESTRATOR, prompt, options);
    },
  };

  // ── Shopper Agent API ────────────────────────────────────────────────

  const shopper = {
    /**
     * Find best deals for a grocery item.
     * @param {string} itemName
     * @param {string} location - e.g. "Ottawa"
     */
    async findDeals(itemName, location = "Ottawa", options = {}) {
      return query(
        AGENTS.ORCHESTRATOR,
        `Find the best local grocery deals for "${itemName}" in ${location}. Return as a JSON array where each deal has: store_name, price, unit, address. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Find deals for multiple items (batch).
     * @param {string[]} items - List of item names
     * @param {string} location
     */
    async findDealsBatch(items, location = "Ottawa", options = {}) {
      const itemList = items.join(", ");
      return query(
        AGENTS.ORCHESTRATOR,
        `Find the best local grocery deals for these items in ${location}: ${itemList}. For each item, return the store, price, and address. Return as JSON. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Get a shopping plan based on missing ingredients for a recipe.
     * @param {string[]} missingIngredients
     * @param {string} location
     */
    async shoppingPlan(missingIngredients, location = "Ottawa", options = {}) {
      const items = missingIngredients.join(", ");
      return query(
        AGENTS.ORCHESTRATOR,
        `I need to buy these ingredients: ${items}. Find the best deals in ${location} and suggest a one-stop shop recommendation. Return as JSON with fields: items (array of {name, store, price, address}), recommended_store, total_estimated_cost. Only respond with the JSON.`,
        options
      );
    },

    /**
     * Free-form shopper prompt.
     */
    async prompt(prompt, options = {}) {
      return query(AGENTS.ORCHESTRATOR, prompt, options);
    },
  };

  // ── Orchestrator (general-purpose) ───────────────────────────────────

  const orchestrator = {
    /**
     * Send any free-form prompt to the orchestrator, which routes
     * to the appropriate agent(s) automatically.
     */
    async prompt(prompt, options = {}) {
      return query(AGENTS.ORCHESTRATOR, prompt, options);
    },
  };

  return {
    inventory,
    recipes,
    shopper,
    orchestrator,
    // Direct access for custom prompts
    query,
  };
}
