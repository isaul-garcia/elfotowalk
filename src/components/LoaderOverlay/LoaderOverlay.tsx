// LoaderOverlay.tsx
import * as React from "react";
import { getGateState } from "./LoadingGate";
import loadingGif from "../../assets/loading.gif";

type LoaderOverlayProps = { onDone?: () => void };

export default function LoaderOverlay({ onDone }: LoaderOverlayProps) {
  const [done, setDone] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const emittedRef = React.useRef(false);

  // A: One-shot event when everything finished
  React.useEffect(() => {
    const finish = () => setDone(true);
    window.addEventListener("assets:loaded", finish);
    return () => window.removeEventListener("assets:loaded", finish);
  }, []);

  // B: Optional slow polling every 3s (no reactivity to progress bursts)
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const g = getGateState();
      if (g.done || (g.total > 0 && g.loaded >= g.total)) setDone(true);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // After we mark done, fade out; when transition ends, call onDone once and unmount.
  React.useEffect(() => {
    if (!done || hidden || emittedRef.current) return;

    const el = rootRef.current;
    const emit = () => {
      if (emittedRef.current) return;
      emittedRef.current = true;
      onDone?.();
      setHidden(true);
    };

    if (!el) { emit(); return; }

    const cs = getComputedStyle(el);
    const hasTransition = cs.transitionDuration !== "0s" && cs.transitionProperty !== "none";
    if (!hasTransition) { emit(); return; }

    const onEnd = (e: TransitionEvent) => {
      if (e.target !== el) return;
      el.removeEventListener("transitionend", onEnd);
      emit();
    };
    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, [done, hidden, onDone]);

  if (hidden) return null;

  return (
    <div ref={rootRef} className={`loading-overlay ${done ? "is-done" : ""}`} aria-hidden={done}>
      <img
        className="loading-gif"
        src={loadingGif}
        alt="Loading…"
      />
    </div>
  );
}
