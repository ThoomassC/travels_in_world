import type { ReactElement } from "react";
import type { TransportMode } from "@/domain/schema";

/**
 * The seven transport glyphs, drawn at build time as inline SVG.
 *
 * **No icon library**, deliberately: `@tabler/icons-react` was removed from this
 * project precisely because icon components are client components, and this page
 * ships no JavaScript at all. Inline paths cost their own bytes of HTML and
 * nothing else.
 *
 * **The icon is never alone**, and that is an acceptance criterion rather than a
 * preference. A pictogram of a bus is a bus to whoever already knows the
 * convention; to everyone else — and to every screen reader — it is nothing. So
 * the `<svg>` here is `aria-hidden`, carries no title and no label, and
 * {@link TransportIcon}'s only caller renders it beside a real text node from the
 * message catalogue. Hiding it is what stops the mode being announced twice.
 *
 * `Record<TransportMode, …>` and not a lookup with a fallback: the day an eighth
 * mode is added to `TRANSPORT_MODES`, this file must stop compiling. A `?? plane`
 * would instead ship a trip by ferry drawn as an aeroplane.
 */
const GLYPHS: Record<TransportMode, ReactElement> = {
  plane: (
    <>
      <path d="M21 12 3 18.5l3.5-6.5L3 5.5 21 12Z" />
      <path d="M6.5 12H21" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="3.5" width="14" height="12" rx="3" />
      <path d="M5 10h14" />
      <path d="M9 19.5 7 22M15 19.5 17 22" />
      <path d="M9.5 13h.01M14.5 13h.01" />
    </>
  ),
  bus: (
    <>
      <rect x="3.5" y="4" width="17" height="12" rx="2.5" />
      <path d="M3.5 10.5h17" />
      <circle cx="8" cy="19" r="1.6" />
      <circle cx="16" cy="19" r="1.6" />
    </>
  ),
  car: (
    <>
      <path d="M4 15.5v-2l1.8-4.6A2 2 0 0 1 7.7 7.5h8.6a2 2 0 0 1 1.9 1.4L20 13.5v2" />
      <path d="M4 13.5h16" />
      <circle cx="7.5" cy="16.5" r="1.8" />
      <circle cx="16.5" cy="16.5" r="1.8" />
    </>
  ),
  boat: (
    <>
      <path d="M12 3.5v9" />
      <path d="M12 5.5 18 12.5h-6" />
      <path d="M4 15.5h16l-2.4 5H6.4Z" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="16" r="3.8" />
      <circle cx="18" cy="16" r="3.8" />
      <path d="M6 16l4.2-8.5H14" />
      <path d="M10.2 7.5 15 16" />
      <path d="M14.5 7.5h2.8" />
    </>
  ),
  foot: (
    <>
      <circle cx="12.5" cy="4" r="2" />
      <path d="M12.5 6.5v5l-3 4 1 5.5" />
      <path d="M12.5 11.5 15.5 15v6" />
      <path d="M9 9.5h6" />
    </>
  ),
};

export type TransportIconProps = {
  readonly mode: TransportMode;
  readonly className?: string;
};

/**
 * Decorative by contract. The caller owns the text; this owns the picture.
 *
 * `focusable="false"` beside `aria-hidden`: without it, older Internet Explorer
 * and some Edge builds still put the `<svg>` in the tab order, producing a stop
 * on an element that announces nothing at all. It costs nine characters.
 */
export function TransportIcon({ mode, className }: TransportIconProps): ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[mode]}
    </svg>
  );
}
