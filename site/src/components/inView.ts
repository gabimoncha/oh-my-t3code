import { useEffect, useRef } from "react";

// Starts the animations of a host when it first comes into view (data-play), and pauses them while
// it is out of view (data-paused). "In view" means in the upper 80% of the window, with no minimum
// share of the host, so that a host taller than the window also plays.
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) node.dataset.play = "";
        node.dataset.paused = entry?.isIntersecting ? "false" : "true";
      },
      { rootMargin: "0px 0px -20% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return ref;
}
