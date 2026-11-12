"use client";

import { useEffect, useRef, useState } from "react";

/** Copies `value` to the clipboard; label flips to "Copied" briefly. */
export function CopyButton({
  value,
  label = "Copy",
  className = "link text-[13px]",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // Fallback for non-secure contexts.
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  }

  return (
    <button type="button" onClick={copy} className={className} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </button>
  );
}
