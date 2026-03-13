import { useCallback, useEffect, useRef, useState } from "react";
import { inventoryRestApi } from "@/api/inventoryRest";

export function useWeeklyDeals() {
  const [deals, setDeals] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const result = await inventoryRestApi.deals();
      setDeals(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { deals, loading, error, refresh };
}
