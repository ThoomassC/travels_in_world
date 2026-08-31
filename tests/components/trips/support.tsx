import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/i18n/messages/fr.json";
import { defaultLocale } from "@/i18n/routing";

/**
 * Renders a listing component through the real message catalogue, the way
 * `tests/components/map/world-map.test.tsx` does.
 *
 * The catalogue is the real one on purpose: a stub of it would let a component
 * read a key that does not exist in `fr.json` and still pass, which is exactly
 * the class of defect a French-only site cannot see any other way.
 */
export function renderWithMessages(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale={defaultLocale} messages={frMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

export { frMessages, defaultLocale };
