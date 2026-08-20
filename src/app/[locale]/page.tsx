import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

/**
 * Assumed placeholder: the world map (TIW-11) and the trip pages (TIW-12) land
 * later. Every string still comes from the message catalogue — a hardcoded
 * placeholder is the one that never gets translated.
 */
export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("tagline")}</p>
      <section aria-labelledby="placeholder-heading">
        <h2 id="placeholder-heading">{t("placeholderHeading")}</h2>
        <p>{t("placeholderBody")}</p>
      </section>
    </main>
  );
}
