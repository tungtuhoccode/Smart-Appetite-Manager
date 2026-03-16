import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { inventoryRestApi } from "@/api/inventoryRest";
import { extractItems } from "@/lib/parseResponse";

/**
 * Manages inventory items: fetching, polling, CRUD operations, and sorting.
 *
 * @param {ReturnType<import("@/api/agents").createAgentAPI>} api - Agent API instance
 * @param {() => void} persistSession - Callback to persist gateway session
 */
export function useInventory(api, persistSession) {
  const [items, setItems] = useState([]);
  const [sortField, setSortField] = useState("updated_at");
  const [sortDirection, setSortDirection] = useState("desc");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [deleteProgress, setDeleteProgress] = useState(null);
  const [newItemKeys, setNewItemKeys] = useState(new Set());
  const fetchingRef = useRef(false);
  const newItemTimerRef = useRef(null);

  const fetchItems = useCallback(async ({ background = false } = {}) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    if (!background) {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await inventoryRestApi.list();
      setItems(extractItems(result));
      setLastSyncedAt(new Date());
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      setError(normalized);
    } finally {
      fetchingRef.current = false;
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch + polling + focus refetch
  useEffect(() => {
    void fetchItems();
    const intervalId = window.setInterval(() => {
      void fetchItems({ background: true });
    }, 5000);
    const onFocus = () => {
      void fetchItems({ background: true });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      if (newItemTimerRef.current) clearTimeout(newItemTimerRef.current);
    };
  }, [fetchItems]);

  const itemKey = useCallback(
    (item) => `${item.product_name}::${item.quantity_unit || ""}::${item.unit || ""}`,
    []
  );

  const highlightNewItems = useCallback(
    (previousItems, currentItems) => {
      const prevKeys = new Set(previousItems.map(itemKey));
      const added = new Set();
      for (const item of currentItems) {
        const key = itemKey(item);
        if (!prevKeys.has(key)) added.add(key);
      }
      if (added.size > 0) {
        setNewItemKeys(added);
        if (newItemTimerRef.current) clearTimeout(newItemTimerRef.current);
        newItemTimerRef.current = setTimeout(() => setNewItemKeys(new Set()), 4000);
      }
    },
    [itemKey]
  );

  const handleAdd = useCallback(
    async (description) => {
      setMutating(true);
      const snapshotBefore = [...items];
      try {
        await api.inventory.addItems(description);
        persistSession();
        toast.success("Items added successfully");
        const result = await inventoryRestApi.list();
        const updated = extractItems(result);
        setItems(updated);
        setLastSyncedAt(new Date());
        highlightNewItems(snapshotBefore, updated);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to add items", { description: message });
        return false;
      } finally {
        setMutating(false);
      }
    },
    [api, persistSession, items, highlightNewItems]
  );

  const handleIncrease = useCallback(
    async (item, amount) => {
      setMutating(true);
      try {
        const quantityUnit = item.quantity_unit || item.unit || "unit";
        const unit = item.unit || item.quantity_unit || "unit";
        await api.inventory.increaseStock(item.product_name, amount, quantityUnit, unit);
        persistSession();
        toast.success(`Increased ${item.product_name} stock`);
        await fetchItems({ background: true });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to increase stock", { description: message });
        return false;
      } finally {
        setMutating(false);
      }
    },
    [api, persistSession, fetchItems]
  );

  const handleDecrease = useCallback(
    async (item, amount) => {
      setMutating(true);
      try {
        const quantityUnit = item.quantity_unit || item.unit || "unit";
        const unit = item.unit || item.quantity_unit || "unit";
        await api.inventory.decreaseStock(item.product_name, amount, quantityUnit, unit);
        persistSession();
        toast.success(`Decreased ${item.product_name} stock`);
        await fetchItems({ background: true });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Failed to decrease stock", { description: message });
        return false;
      } finally {
        setMutating(false);
      }
    },
    [api, persistSession, fetchItems]
  );

  const handleDelete = useCallback(
    async (item) => {
      setMutating(true);
      setDeleteProgress({ phase: "deleting", message: "Sending delete request to backend..." });
      try {
        const response = await api.inventory.deleteItem(item.product_name, item.quantity_unit, item.unit);
        persistSession();
        setDeleteProgress({
          phase: "syncing",
          message: "Item deleted. Refreshing inventory...",
          backendResponse: response.text,
        });
        await fetchItems({ background: true });
        setDeleteProgress({
          phase: "done",
          message: `${item.product_name} has been removed from your inventory.`,
          backendResponse: response.text,
        });
        toast.success(`Deleted ${item.product_name}`);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDeleteProgress({ phase: "error", message });
        toast.error("Failed to delete item", { description: message });
        return false;
      } finally {
        setMutating(false);
      }
    },
    [api, persistSession, fetchItems]
  );

  const clearDeleteProgress = useCallback(() => {
    setDeleteProgress(null);
  }, []);

  const sortedItems = useMemo(() => {
    let filtered = categoryFilter === "All"
      ? [...items]
      : items.filter((item) => (item.category || "Other") === categoryFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((item) =>
        (item.product_name || "").toLowerCase().includes(q)
      );
    }
    const next = [...filtered];
    next.sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case "product_name":
          aVal = (a.product_name || "").toLowerCase();
          bVal = (b.product_name || "").toLowerCase();
          break;
        case "quantity":
          aVal = Number(a.quantity) || 0;
          bVal = Number(b.quantity) || 0;
          break;
        case "quantity_unit":
          aVal = (a.quantity_unit || "").toLowerCase();
          bVal = (b.quantity_unit || "").toLowerCase();
          break;
        case "unit":
          aVal = (a.unit || "").toLowerCase();
          bVal = (b.unit || "").toLowerCase();
          break;
        case "category":
          aVal = (a.category || "Other").toLowerCase();
          bVal = (b.category || "Other").toLowerCase();
          break;
        case "expires_at":
          aVal = a.expires_at || "9999-12-31";
          bVal = b.expires_at || "9999-12-31";
          break;
        case "updated_at":
        default:
          aVal = String(a?.updated_at || a?.created_at || "");
          bVal = String(b?.updated_at || b?.created_at || "");
          break;
      }
      if (aVal === bVal) return 0;
      if (sortDirection === "desc") {
        return aVal < bVal ? 1 : -1;
      }
      return aVal > bVal ? 1 : -1;
    });
    return next;
  }, [items, sortField, sortDirection, categoryFilter, searchQuery]);

  const toggleSort = useCallback((field) => {
    setSortField((prevField) => {
      if (prevField === field) {
        setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
      } else {
        setSortDirection(field === "updated_at" ? "desc" : "asc");
      }
      return field;
    });
  }, []);

  return {
    items: sortedItems,
    loading,
    error,
    mutating,
    lastSyncedAt,
    sortField,
    sortDirection,
    toggleSort,
    fetchItems,
    handleAdd,
    handleIncrease,
    handleDecrease,
    handleDelete,
    deleteProgress,
    clearDeleteProgress,
    newItemKeys,
    itemKey,
    categoryFilter,
    setCategoryFilter,
    searchQuery,
    setSearchQuery,
    allItems: items,
  };
}
