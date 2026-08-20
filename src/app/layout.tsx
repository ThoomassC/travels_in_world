import type { ReactNode } from "react";

/**
 * Next.js requires a root layout, but the document language is only known one
 * segment deeper. So this layout renders nothing but its children: `<html>` and
 * `<body>` are emitted by `src/app/[locale]/layout.tsx`, which knows the locale,
 * and by `src/app/not-found.tsx` for URLs that never reach a locale segment.
 *
 * Do not add `<html>`/`<body>` here — it would nest two documents.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
