import { useCallback, useEffect, useState } from "react";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function useResizableSidebar({
  storageKey = "assistant_sidebar_width",
  defaultWidth = 420,
  minWidth = 360,
  maxWidth = 760,
} = {}) {
  const [panelWidth, setPanelWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    setPanelWidth(clamp(parsed, minWidth, maxWidth));
  }, [maxWidth, minWidth, storageKey]);

  const startResize = useCallback(
    (event) => {
      if (typeof window === "undefined") return;
      if (window.innerWidth < 640) return;

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panelWidth;
      const viewportMax = Math.max(minWidth, Math.min(maxWidth, window.innerWidth - 40));

      setIsResizing(true);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMouseMove = (moveEvent) => {
        const delta = startX - moveEvent.clientX;
        const next = clamp(startWidth + delta, minWidth, viewportMax);
        setPanelWidth(next);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        localStorage.setItem(storageKey, String(panelWidth));
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [maxWidth, minWidth, panelWidth, storageKey]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(storageKey, String(panelWidth));
  }, [panelWidth, storageKey]);

  return { panelWidth, isResizing, startResize };
}
