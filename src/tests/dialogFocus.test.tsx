import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useDialogFocus } from "../components/useDialogFocus";

function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children?: React.ReactNode }) {
  const ref = useDialogFocus<HTMLElement>(true, onClose);
  return (
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" onClick={onClose}>Close {label}</button>
      <input aria-label={`${label} field`} />
      {children}
    </section>
  );
}

function Page() {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>Open</button>
      <button type="button">Behind</button>
      {outer ? (
        <Dialog label="Outer" onClose={() => setOuter(false)}>
          <button type="button" onClick={() => setInner(true)}>Open inner</button>
          {inner ? <Dialog label="Inner" onClose={() => setInner(false)} /> : null}
        </Dialog>
      ) : null}
    </>
  );
}

const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey });

describe("modal dialog keyboard focus", () => {
  it("moves focus in, keeps Tab inside, closes on Escape, and restores focus", () => {
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Outer" });
    expect(document.activeElement).toBe(dialog);
    // Shift+Tab from the dialog wraps to its last control, Tab from there to its first.
    tab(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open inner" }));
    tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close Outer" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("lets only the innermost dialog handle Escape", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const openInner = screen.getByRole("button", { name: "Open inner" });
    openInner.focus();
    fireEvent.click(openInner);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Inner" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inner" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
    expect(document.activeElement).toBe(openInner);
  });
});
