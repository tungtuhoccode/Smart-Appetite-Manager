import { useEffect, useRef } from "react";

/**
 * Wraps a markdown <table> and adds column-resize drag handles to each <th>
 * using DOM refs (works regardless of how React tree is structured).
 */
export function ResizableTable({ children }) {
  const tableRef = useRef(null);
  const widthsRef = useRef(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const ths = Array.from(table.querySelectorAll("thead th"));
    if (ths.length === 0) return;

    // Initialize widths once, preserve across re-renders
    if (!widthsRef.current || widthsRef.current.length !== ths.length) {
      widthsRef.current = ths.map((th) => th.offsetWidth);
    }

    table.style.tableLayout = "fixed";
    const widths = widthsRef.current;

    ths.forEach((th, i) => {
      th.style.width = widths[i] + "px";
      th.style.position = "relative";

      // Skip if handle already exists
      if (th.querySelector("[data-resize-handle]")) return;

      const handle = document.createElement("div");
      handle.setAttribute("data-resize-handle", "true");
      Object.assign(handle.style, {
        position: "absolute",
        right: "0",
        top: "0",
        bottom: "0",
        width: "6px",
        cursor: "col-resize",
        zIndex: "1",
        userSelect: "none",
      });

      handle.addEventListener("mouseenter", () => {
        if (!handle._dragging) handle.style.background = "hsl(var(--primary) / 0.15)";
      });
      handle.addEventListener("mouseleave", () => {
        if (!handle._dragging) handle.style.background = "";
      });

      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        handle._dragging = true;
        handle.style.background = "hsl(var(--primary) / 0.3)";

        const startX = e.clientX;
        const startW = widths[i];

        const onMove = (ev) => {
          const newW = Math.max(40, startW + (ev.clientX - startX));
          widths[i] = newW;
          ths[i].style.width = newW + "px";
        };

        const onUp = () => {
          handle._dragging = false;
          handle.style.background = "";
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });

      th.appendChild(handle);
    });
  });

  return (
    <div className="my-2 overflow-x-auto rounded-md border">
      <table ref={tableRef} className="w-full text-xs border-collapse">
        {children}
      </table>
    </div>
  );
}
