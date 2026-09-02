import type { Browser, Page } from "@playwright/test";

/**
 * Largest Contentful Paint and Cumulative Layout Shift, measured on a real
 * served page through a throttled Chrome — with no dependency added.
 *
 * **Why not Lighthouse.** It is the obvious door and it is a dependency, in a
 * repository whose budget doctrine (`docs/adr/0009-le-poids-est-un-budget-mesure.md`)
 * says to weigh a tool against the budget it serves. Everything below is the two
 * browser APIs the metrics are *defined* by — `PerformanceObserver` over
 * `largest-contentful-paint` and `layout-shift` — plus two Chrome DevTools
 * Protocol calls for the throttling, through a session Playwright already knows
 * how to open. Zero packages, and the numbers are the browser's own rather than a
 * simulation of them.
 *
 * What that gives up, said plainly rather than discovered later: Lighthouse's
 * *simulated* throttling (it loads unthrottled and models a slow link) is more
 * reproducible than the *applied* throttling used here, and it produces a score
 * with an opinion in it. Applied throttling measures the page as a browser really
 * experiences it, which is what the acceptance criterion asks about, and it is
 * noisier — hence the median of several runs rather than a single number.
 */

/**
 * The throttling profile, and it is the one Lighthouse calls "mobile / Slow 4G".
 *
 * Stated as a value rather than left to a preset name, because a Largest
 * Contentful Paint without its profile means nothing: the same page on the same
 * commit answers in 300 ms unthrottled and 1.8 s here.
 *
 * - CPU ×4 — DevTools' "mid-tier mobile", and Lighthouse's mobile default.
 * - 150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up — Lighthouse's Slow 4G.
 *   The CDP call wants bytes per second, hence the division by 8.
 */
export const MOBILE_SLOW_4G = {
  label: "mobile, CPU ×4, Slow 4G (1,6 Mbit/s ↓ · 750 kbit/s ↑ · 150 ms RTT)",
  cpuThrottlingRate: 4,
  latencyMs: 150,
  downloadBytesPerSecond: Math.round((1.6 * 1000 * 1000) / 8),
  uploadBytesPerSecond: Math.round((750 * 1000) / 8),
} as const;

/**
 * How long to keep watching after `load`.
 *
 * LCP is not final until the first interaction or until the page is hidden, and a
 * layout shift caused by hydration arrives after `load` by definition. Under CPU
 * ×4 hydration of this site takes a few hundred milliseconds; three seconds is
 * comfortably past it and is what makes a CLS of 0 mean "nothing moved" rather
 * than "we stopped looking".
 */
const SETTLE_MS = 3_000;

export type Vitals = {
  /** Milliseconds from navigation start, the browser's own LCP timestamp. */
  readonly lcpMs: number;
  /** The element LCP settled on, so a measurement cannot be about the wrong box. */
  readonly lcpElement: string;
  /** The LCP resource, empty for a text element. */
  readonly lcpUrl: string;
  readonly cls: number;
  readonly fcpMs: number;
  /**
   * How long the document itself took, `responseEnd - requestStart`.
   *
   * **And not `responseStart`, which is the natural choice and is wrong here.**
   * Measured against a 50 KB local page with `latency: 1000` emulated: unthrottled
   * gives `responseStart` 3.3 ms / `responseEnd` 3.6 ms, throttled gives
   * `responseStart` **0.9 ms** / `responseEnd` **1252 ms**. Chromium applies the
   * emulated round trip to the delivery of the body, not to the first byte — so a
   * time-to-first-byte assertion "proving" that throttling is on fails on a
   * correctly throttled run, which is how the first version of this suite went red
   * on a green site.
   */
  readonly documentMs: number;
};

declare global {
  interface Window {
    __vitals?: {
      lcpMs: number;
      lcpElement: string;
      lcpUrl: string;
      cls: number;
    };
  }
}

/**
 * Installs the two observers before any of the page's own script runs.
 *
 * `addInitScript` and not an `evaluate` after navigation: `buffered: true` would
 * recover the entries either way, but a `layout-shift` that happened before the
 * observer existed is only in the buffer if the buffer was already collecting —
 * and the buffer for `layout-shift` is not guaranteed to hold the whole session.
 * Registering first removes the question.
 */
async function observeVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { lcpMs: 0, lcpElement: "", lcpUrl: "", cls: 0 };
    window.__vitals = state;

    type LcpEntry = PerformanceEntry & { element?: Element | null; url?: string };
    type ShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };

    new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const entry = raw as LcpEntry;
        state.lcpMs = entry.startTime;
        state.lcpUrl = entry.url ?? "";

        const element = entry.element ?? null;
        if (element === null) {
          state.lcpElement = "(élément retiré du document)";
        } else {
          const firstClass = element.classList.item(0);
          state.lcpElement =
            element.tagName.toLowerCase() + (firstClass === null ? "" : `.${firstClass}`);
        }
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const entry = raw as ShiftEntry;
        // A shift a reader caused by tapping is not a layout instability, and the
        // metric excludes it by definition.
        if (!entry.hadRecentInput) {
          state.cls += entry.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Applies the profile through CDP. Must happen before the navigation. */
async function throttle(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);

  // `Network.emulateNetworkConditions` is a no-op until the domain is enabled —
  // it answers success either way, which is exactly how a throttling profile
  // silently stops applying.
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: MOBILE_SLOW_4G.latencyMs,
    downloadThroughput: MOBILE_SLOW_4G.downloadBytesPerSecond,
    uploadThroughput: MOBILE_SLOW_4G.uploadBytesPerSecond,
  });
  await session.send("Emulation.setCPUThrottlingRate", {
    rate: MOBILE_SLOW_4G.cpuThrottlingRate,
  });
}

export type Sample = {
  readonly vitals: Vitals;
  /** Every response the load produced, so a spec can assert what was fetched. */
  readonly responses: readonly { readonly url: string; readonly status: number }[];
};

/**
 * One cold load of `url` on a throttled mobile Chrome, in a context of its own.
 *
 * A **new context per sample**, deliberately: a second `page.goto` in the same
 * context reads the HTTP cache, and a cached load is not the arrival this
 * criterion is about ("un visiteur sur mobile en 4G", first visit).
 */
export async function sampleVitals(
  browser: Browser,
  device: Parameters<Browser["newContext"]>[0],
  baseURL: string,
  url: string
): Promise<Sample> {
  const context = await browser.newContext({ ...device, baseURL });
  const responses: { url: string; status: number }[] = [];

  try {
    const page = await context.newPage();
    page.on("response", (response) => {
      responses.push({ url: response.url(), status: response.status() });
    });

    await observeVitals(page);
    await throttle(page);

    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(SETTLE_MS);

    const collected = await page.evaluate(() => {
      const state = window.__vitals;
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const paint = performance
        .getEntriesByType("paint")
        .find((entry) => entry.name === "first-contentful-paint");

      return {
        lcpMs: state?.lcpMs ?? 0,
        lcpElement: state?.lcpElement ?? "",
        lcpUrl: state?.lcpUrl ?? "",
        cls: state?.cls ?? 0,
        fcpMs: paint?.startTime ?? 0,
        documentMs: navigation === undefined ? 0 : navigation.responseEnd - navigation.requestStart,
      };
    });

    return { vitals: collected, responses };
  } finally {
    await context.close();
  }
}

/** The middle value of an odd-sized sample; the lower middle of an even one. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Aucune mesure : la médiane d'un échantillon vide n'existe pas.");
  }

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** `min / median / max`, which is the least a performance number can be reported as. */
export function spread(values: readonly number[], digits = 0): string {
  const sorted = [...values].sort((a, b) => a - b);
  const format = (value: number) => value.toFixed(digits);

  return `min ${format(sorted[0] ?? 0)} · médiane ${format(median(values))} · max ${format(sorted[sorted.length - 1] ?? 0)}`;
}
