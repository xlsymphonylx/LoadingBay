import { useRef, useState, useCallback } from "react";
import { enqueueImage } from "../utils/imageQueue";

/**
 * Like useInViewSrc but triggers only on mouse hover.
 * Once loaded, the src is kept (won't unload on mouse-out).
 */
export function useHoverSrc(src: string) {
  const [activeSrc, setActiveSrc] = useState<string | null>(null);
  const loading = useRef(false);

  const onMouseEnter = useCallback(() => {
    if (activeSrc || loading.current || !src) return;
    loading.current = true;
    enqueueImage(src).then((s: string) => { setActiveSrc(s); loading.current = false; });
  }, [src, activeSrc]);

  return { activeSrc, onMouseEnter };
}
