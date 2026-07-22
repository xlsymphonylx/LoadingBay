import { useEffect, useRef, useState } from "react";
import { enqueueImage } from "../utils/imageQueue";

/**
 * Returns an `imgRef` to attach to any element and an `activeSrc` that is
 * null until the element enters the viewport. This prevents firing hundreds
 * of image requests simultaneously when a large grid renders — requests only
 * go out for cards actually visible on screen.
 *
 * rootMargin: "200px" starts loading slightly before the card is fully visible
 * so images appear ready as the user scrolls naturally.
 *
 * Images are passed through a global queue (max 4 concurrent, 120 ms stagger)
 * so that bulk renders (e.g. 50 recs covers all in view) don't hammer the CDN
 * or the backend cover proxy simultaneously.
 */
export function useInViewSrc(src: string) {
  const ref = useRef<HTMLElement | null>(null);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (activeSrc === src) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          obs.disconnect();
          // Go through the global queue instead of firing immediately.
          enqueueImage(src).then(setActiveSrc);
        }
      },
      { rootMargin: "200px" },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ref, activeSrc };
}
