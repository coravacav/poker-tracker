import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

/** Open dialogs, innermost last; only the innermost one handles keys. */
const openDialogs: HTMLElement[] = [];

/**
 * Keyboard behaviour for a modal dialog: focus moves into it when it opens
 * (onto the dialog itself unless something inside already took focus, so
 * phones do not pop up a keyboard), Tab and Shift+Tab stay inside, Escape
 * calls onClose, and focus returns to where it was when the dialog closes.
 * Attach the returned ref to the element with role="dialog" and give it
 * tabIndex={-1}.
 */
export function useDialogFocus<T extends HTMLElement>(active: boolean, onClose?: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialogs.push(dialog);
    if (!dialog.contains(document.activeElement)) dialog.focus();

    // Skips controls that are not rendered (e.g. inside a closed <details>) where the browser can tell.
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => typeof element.checkVisibility !== "function" || element.checkVisibility()
      );

    function onKeyDown(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== dialog || event.defaultPrevented) return;
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (current === first || current === dialog || !dialog!.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog!.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [active]);

  return ref;
}
