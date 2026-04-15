/**
 * Full-page screenshot capture. Two strategies:
 *
 * 1. **scroll-stitch** (default): ask the content script to scroll the page
 *    in viewport-sized steps, call chrome.tabs.captureVisibleTab after each
 *    step, then stitch the tiles together into a single PNG using
 *    OffscreenCanvas inside the service worker. Works without any extra
 *    permissions and is good enough for most D365FO forms.
 *
 * 2. **debugger**: if the user opted in to high-fidelity capture, attach
 *    chrome.debugger to the tab, issue Page.captureScreenshot with
 *    captureBeyondViewport=true, and detach. Requires the `debugger`
 *    permission and shows a yellow bar, so it is off by default.
 *
 * Either strategy returns a Blob that the caller stores exactly like a
 * regular snapshot.
 */

export interface CaptureOptions {
  tabId: number;
  /** 'stitch' is always supported; 'debugger' requires the optional
   *  `debugger` permission and a user opt-in. */
  strategy: 'stitch' | 'debugger';
}

const MIN_GAP_MS = 700;
let lastCaptureAt = 0;

async function throttle(): Promise<void> {
  const gap = Date.now() - lastCaptureAt;
  if (gap < MIN_GAP_MS) await new Promise((r) => setTimeout(r, MIN_GAP_MS - gap));
  lastCaptureAt = Date.now();
}

interface PageMetrics {
  totalHeight: number;
  viewportHeight: number;
  viewportWidth: number;
  devicePixelRatio: number;
}

async function getPageMetrics(tabId: number): Promise<PageMetrics> {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      totalHeight: Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight,
      ),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio || 1,
    }),
  });
  return result as PageMetrics;
}

async function scrollTo(tabId: number, y: number, hideSticky: boolean): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [y, hideSticky],
    func: (offset: number, hide: boolean) => {
      if (hide) {
        // Temporarily hide elements that are fixed/sticky so they don't appear
        // as duplicates on every tile. Store the original display so we can
        // restore it after the capture.
        const w = window as unknown as { __reproStickyHidden?: HTMLElement[] };
        if (!w.__reproStickyHidden) {
          w.__reproStickyHidden = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
            const pos = getComputedStyle(el).position;
            return pos === 'fixed' || pos === 'sticky';
          });
          for (const el of w.__reproStickyHidden) {
            el.dataset.reproOrigDisplay = el.style.display || '';
            el.style.display = 'none';
          }
        }
      }
      window.scrollTo(0, offset);
    },
  });
  // small settle time for layout
  await new Promise((r) => setTimeout(r, 120));
}

async function restoreSticky(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const w = window as unknown as { __reproStickyHidden?: HTMLElement[] };
      if (!w.__reproStickyHidden) return;
      for (const el of w.__reproStickyHidden) {
        el.style.display = el.dataset.reproOrigDisplay ?? '';
        delete el.dataset.reproOrigDisplay;
      }
      delete w.__reproStickyHidden;
    },
  });
}

async function captureStitch(tabId: number): Promise<Blob> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId == null) throw new Error('tab has no window');
  const metrics = await getPageMetrics(tabId);
  const tiles: Array<{ y: number; dataUrl: string }> = [];
  const steps = Math.ceil(metrics.totalHeight / metrics.viewportHeight);

  try {
    for (let i = 0; i < steps; i++) {
      const y = i * metrics.viewportHeight;
      await scrollTo(tabId, y, /* hideSticky */ i > 0);
      await throttle();
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      tiles.push({ y, dataUrl });
    }
  } finally {
    await restoreSticky(tabId).catch(() => undefined);
    // Restore original scroll position
    await scrollTo(tabId, 0, false).catch(() => undefined);
  }

  // Stitch tiles into one image using OffscreenCanvas in the service worker.
  const firstBlob = await (await fetch(tiles[0]!.dataUrl)).blob();
  const firstBitmap = await createImageBitmap(firstBlob);
  const tileWidth = firstBitmap.width;
  const tileHeight = firstBitmap.height;
  firstBitmap.close();

  const dpr = metrics.devicePixelRatio;
  const fullHeight = Math.ceil(metrics.totalHeight * dpr);
  const fullWidth = tileWidth;
  const canvas = new OffscreenCanvas(fullWidth, fullHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  for (const tile of tiles) {
    const blob = await (await fetch(tile.dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const yPx = Math.round(tile.y * dpr);
    const remaining = fullHeight - yPx;
    const drawHeight = Math.min(tileHeight, remaining);
    ctx.drawImage(bitmap, 0, 0, fullWidth, drawHeight, 0, yPx, fullWidth, drawHeight);
    bitmap.close();
  }

  return canvas.convertToBlob({ type: 'image/png' });
}

async function captureDebugger(tabId: number): Promise<Blob> {
  const target: chrome.debugger.Debuggee = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    const result = (await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
    })) as { data: string } | undefined;
    if (!result?.data) throw new Error('empty captureScreenshot result');
    const bin = atob(result.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes as BlobPart], { type: 'image/png' });
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

export async function captureFullPage(opts: CaptureOptions): Promise<Blob> {
  if (opts.strategy === 'debugger') return captureDebugger(opts.tabId);
  return captureStitch(opts.tabId);
}
