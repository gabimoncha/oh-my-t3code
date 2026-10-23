import { useEffect, useRef, useState } from "react";

type State = "idle" | "copied" | "blocked";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// When the browser blocks the clipboard, select the command so that the shortcut copies it.
function selectCommand(button: HTMLButtonElement) {
  const code = button.closest("[data-copy-root]")?.querySelector("code");
  const selection = window.getSelection();
  if (!code || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
}

function useCopy(text: string) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(button: HTMLButtonElement) {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("blocked");
      selectCommand(button);
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  const label = state === "copied" ? "Copied" : state === "blocked" ? (isMac() ? "Press ⌘C" : "Press Ctrl+C") : "Copy";
  return { state, label, copy };
}

type CopyProps = {
  text: string;
  variant: "plate" | "outline" | "solid";
};

export function CopyButton({ text, variant }: CopyProps) {
  const { state, label, copy } = useCopy(text);
  return (
    <>
      <button type="button" className={`copy copy-${variant}`} data-state={state} onClick={(event) => copy(event.currentTarget)} aria-label={`Copy ${text}`}>
        {label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? `Copied ${text}` : state === "blocked" ? `The browser blocked the copy. ${label} to copy.` : ""}
      </span>
    </>
  );
}

export function CommandPlate({ command }: { command: string }) {
  return (
    <div className="plate" data-copy-root>
      <code>{command}</code>
      <CopyButton text={command} variant="plate" />
    </div>
  );
}
