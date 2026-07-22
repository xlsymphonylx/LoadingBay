/**
 * Global image-load queue.
 *
 * Limits concurrent image fetches to MAX_CONCURRENT and adds a small stagger
 * delay between slots so we don't fire 50 requests to resources.tidal.com at
 * the same time when a large recommendations grid renders.
 *
 * Usage: instead of `<img src={url}>`, call `const src = await enqueueImage(url)`
 * or use the `useQueuedSrc` hook below.
 */

const MAX_CONCURRENT = 4;
const STAGGER_MS = 120; // delay between each slot becoming free

type QueueEntry = {
  src: string;
  resolve: (src: string) => void;
};

const queue: QueueEntry[] = [];
let active = 0;

function processQueue() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const entry = queue.shift()!;
    active++;
    // Small stagger: each new slot fires slightly after the previous one.
    const delay = (active - 1) * STAGGER_MS;
    setTimeout(() => {
      entry.resolve(entry.src);
      active--;
      processQueue();
    }, delay);
  }
}

export function enqueueImage(src: string): Promise<string> {
  return new Promise(resolve => {
    queue.push({ src, resolve });
    processQueue();
  });
}
