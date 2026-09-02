import { appendFileSync } from "node:fs";
import process from "node:process";
import { devices, expect, test } from "@playwright/test";
import { MOBILE_SLOW_4G, median, sampleVitals, spread } from "./vitals";

/**
 * TIW-26's first acceptance criterion, measured rather than declared: **LCP under
 * 2.5 s and CLS under 0.1 on a throttled mobile profile**, on the home page and
 * on a trip page.
 *
 * Read `./vitals.ts` first — it holds the throttling profile, why the two metrics
 * are taken from the browser's own `PerformanceObserver` rather than from a
 * dependency, and what applied throttling gives up against Lighthouse's
 * simulated kind.
 *
 * **Why this suite has a configuration of its own** (`./playwright.perf.config.ts`)
 * rather than joining `playwright.content.config.ts`, which already serves this
 * fixture: `workers: 1`. A performance sample taken while three other browsers
 * share the same four cores measures the runner, not the page. That config is
 * serial on CI and parallel on a workstation, so borrowing it would have made the
 * local numbers meaningless — and the local numbers are the ones a human reads
 * while working.
 */

/**
 * Five cold loads per route.
 *
 * One sample is not a measurement: on a shared runner the first load pays a cold
 * server and whatever the kernel was doing, and the spread between the best and
 * the worst is routinely 2×. Five is odd — so the median is a real observation
 * and not an average of two — and small enough to keep the job under two minutes.
 */
const SAMPLES = 5;

/** The criterion's own numbers. Not chosen here, and not to be raised here. */
const LCP_CEILING_MS = 2_500;
const CLS_CEILING = 0.1;

/**
 * A phone, declaratively. `devices["Pixel 5"]` is 393 × 851 at DPR 2.625 with
 * `isMobile` and `hasTouch` — which matters beyond the box: `isMobile` changes
 * how Chrome lays out and rasterises, and a "mobile" measurement taken in a
 * desktop viewport is a desktop measurement in a small window.
 */
const MOBILE = devices["Pixel 5"];

/**
 * The two pages the criterion names. Both exist in this run because the server
 * serves `tests/fixtures/content/home-map` — the repository's own `content/trips`
 * is empty until TIW-24, so there is no trip page to measure on it at all.
 */
const ROUTES = [
  { path: "/fr", label: "accueil" },
  { path: "/fr/voyages/japon-2024", label: "page de voyage" },
] as const;

/**
 * Publishes the numbers where a human will actually find them: the job log, the
 * Playwright report, and GitHub's run summary when there is one.
 *
 * The criterion says "chaque vérification est automatisée et rattachée au
 * pipeline". A threshold answers pass/fail; it does not answer "how close are
 * we", which is the question that decides whether the next ticket has room. So
 * the assertion below blocks *and* this prints.
 */
function publish(title: string, lines: readonly string[]): void {
  const block = [`### ${title}`, "", ...lines, ""].join("\n");

  process.stdout.write(`\n${block}\n`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== "") {
    appendFileSync(summary, `${block}\n`);
  }
}

for (const route of ROUTES) {
  test(`${route.path} stays under ${LCP_CEILING_MS} ms LCP and ${CLS_CEILING} CLS on ${MOBILE_SLOW_4G.label}`, async ({
    browser,
    baseURL,
  }) => {
    expect(baseURL, "baseURL manquant : la configuration de perf le pose.").toBeTruthy();

    const lcp: number[] = [];
    const cls: number[] = [];
    const documentTransfer: number[] = [];
    const fcp: number[] = [];
    const elements = new Set<string>();
    const rows: string[] = [];

    for (let sample = 1; sample <= SAMPLES; sample += 1) {
      const { vitals, responses } = await sampleVitals(browser, MOBILE, baseURL ?? "", route.path);

      lcp.push(vitals.lcpMs);
      cls.push(vitals.cls);
      documentTransfer.push(vitals.documentMs);
      fcp.push(vitals.fcpMs);
      elements.add(vitals.lcpElement);

      rows.push(
        `| ${sample} | ${vitals.documentMs.toFixed(0)} | ${vitals.fcpMs.toFixed(0)} | ` +
          `${vitals.lcpMs.toFixed(0)} | ${vitals.cls.toFixed(4)} | \`${vitals.lcpElement}\` |`
      );

      /**
       * The **guard on the fixture**, and the reason it is inside the loop rather
       * than in a test of its own: on this server the trip page's photographs are
       * only there because `./fixture-photos.ts` copied them in before
       * `next start`. If that copy fails, every photo answers 404, the cover never
       * paints, LCP settles on a paragraph — and the measurement gets *faster*
       * while measuring a page nobody is served. A silent 404 is how this suite
       * would report a pass it has not earned.
       */
      if (route.path !== "/fr") {
        const photos = responses.filter((response) => response.url.includes("/photos/"));
        expect(
          photos.length,
          "Aucune requête vers /photos/ : la page de voyage mesurée n'a pas de couverture, donc le LCP porte sur autre chose que la vraie page."
        ).toBeGreaterThan(0);
        expect(
          photos.filter((response) => response.status >= 400),
          "Des photos répondent en erreur : `installFixturePhotos` n'a pas posé les fichiers, et le LCP mesuré est plus rapide que la vraie page."
        ).toEqual([]);
      }
    }

    publish(`${route.label} — ${route.path}`, [
      `Profil : ${MOBILE_SLOW_4G.label} · ${SAMPLES} chargements à froid, un contexte neuf chacun.`,
      "",
      "| # | document (ms) | FCP (ms) | LCP (ms) | CLS | élément du LCP |",
      "| - | ------------- | -------- | -------- | --- | -------------- |",
      ...rows,
      "",
      `LCP : ${spread(lcp)} ms — plafond ${LCP_CEILING_MS} ms.`,
      `CLS : ${spread(cls, 4)} — plafond ${CLS_CEILING}.`,
      `Document : ${spread(documentTransfer)} ms · FCP : ${spread(fcp)} ms.`,
    ]);

    /**
     * **Guards on the measurement itself, before the thresholds.** Each of the
     * three is a way this test could report success without having measured
     * anything, and each has a distinct cause.
     */

    // 1. No LCP entry at all — the observer failed to install, or the page
    //    painted nothing. `0 < 2500` would otherwise be a green run on silence.
    expect(
      median(lcp),
      "Aucune entrée `largest-contentful-paint` : l'observateur n'a rien vu, donc le seuil ci-dessous porterait sur zéro."
    ).toBeGreaterThan(0);

    /**
     * 2. The throttling stopped applying. `Network.emulateNetworkConditions`
     *    answers success on a target whose `Network` domain was never enabled, so
     *    the failure is silent and every number above becomes an unthrottled one
     *    that passes trivially. A document delivered in under 100 ms is not
     *    possible under a 150 ms emulated round trip.
     *
     *    **`documentMs` and not a time-to-first-byte**, which is what the first
     *    version of this line used and why it went red against a correctly
     *    throttled site — `./vitals.ts` carries the measurement.
     */
    expect(
      median(documentTransfer),
      `Document médian livré en ${median(documentTransfer).toFixed(0)} ms sous un RTT annoncé de ${MOBILE_SLOW_4G.latencyMs} ms : le bridage réseau ne s'applique pas, et les mesures ci-dessus sont celles d'une machine non bridée.`
    ).toBeGreaterThan(100);

    // 3. The LCP element, reported and pinned to one answer across the samples:
    //    a route whose LCP jumps between two elements is measuring two pages.
    expect(
      [...elements],
      `Le LCP change d'élément d'un échantillon à l'autre (${[...elements].join(", ")}) : la médiane ne décrit alors aucune page en particulier.`
    ).toHaveLength(1);

    expect(median(lcp), `LCP médian sur ${route.path}`).toBeLessThan(LCP_CEILING_MS);
    expect(median(cls), `CLS médian sur ${route.path}`).toBeLessThan(CLS_CEILING);
  });
}
