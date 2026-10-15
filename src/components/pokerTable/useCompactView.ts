import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Switches the table to the player-list view on phone-sized screens or when
 * the panel is too narrow for the seating layout.
 */
export function useCompactView(
  minWidthPx: number,
  onCompactViewChange: ((compactView: boolean) => void) | undefined
) {
  const [compactView, setCompactView] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.innerWidth <= 600 ||
      (window.innerWidth <= 960 &&
        window.innerHeight <= 600 &&
        window.innerWidth > window.innerHeight)
    );
  });
  const panelRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const updateCompactView = () => {
      const phoneSized =
        window.innerWidth <= 600 ||
        (window.innerWidth <= 960 &&
          window.innerHeight <= 600 &&
          window.innerWidth > window.innerHeight);
      const tableWouldOverflow =
        panel.clientWidth > 0 && panel.clientWidth < minWidthPx + 44;

      setCompactView(phoneSized || tableWouldOverflow);
    };

    updateCompactView();
    window.addEventListener("resize", updateCompactView);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateCompactView);
    resizeObserver?.observe(panel);

    return () => {
      window.removeEventListener("resize", updateCompactView);
      resizeObserver?.disconnect();
    };
  }, [minWidthPx]);

  useEffect(() => {
    onCompactViewChange?.(compactView);
  }, [compactView, onCompactViewChange]);

  return { compactView, panelRef };
}
