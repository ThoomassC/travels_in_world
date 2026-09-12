"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LiquidBubble } from "./liquid-bubble";
import styles from "./site-nav.module.css";

type NavKey = "carte" | "pays" | "villes" | "a-propos";

const NAV_KEYS: readonly NavKey[] = ["carte", "pays", "villes", "a-propos"];

const navKeyFrom = (value: string | undefined): NavKey | null =>
  NAV_KEYS.includes(value as NavKey) ? (value as NavKey) : null;

const navKeyFromPathname = (pathname: string | null): NavKey => {
  const segment = pathname?.split("/").filter(Boolean)[0];
  return navKeyFrom(segment) ?? "carte";
};

const isModifiedClick = (event: MouseEvent): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

const noMountSubscription = (): (() => void) => () => undefined;
const clientMounted = (): boolean => true;
const serverMounted = (): boolean => false;

export type NavBubbleProps = {
  readonly children: ReactNode;
};

/**
 * Keeps the navigation as accessible links while giving the active tab a
 * single liquid surface that follows client-side route changes.
 */
export function NavBubble({ children }: NavBubbleProps) {
  const pathname = usePathname();
  const router = useRouter();
  const currentKey = navKeyFromPathname(pathname);
  const mounted = useSyncExternalStore(noMountSubscription, clientMounted, serverMounted);
  const [optimistic, setOptimistic] = useState<{ from: string | null; key: NavKey } | null>(null);
  const [moving, setMoving] = useState(false);
  const movementTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(
    () => () => {
      if (movementTimer.current !== null) {
        window.clearTimeout(movementTimer.current);
      }
    },
    []
  );

  const activeKey = optimistic?.from === pathname ? optimistic.key : currentKey;

  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;

    const handleClick = (event: MouseEvent): void => {
      if (isModifiedClick(event)) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>("a[data-nav]");
      if (anchor === null || !list.contains(anchor) || anchor.target === "_blank") return;

      const nextKey = navKeyFrom(anchor.dataset.nav);
      if (nextKey === null || nextKey === currentKey) return;

      event.preventDefault();
      setOptimistic({ from: pathname, key: nextKey });
      setMoving(true);

      if (movementTimer.current !== null) {
        window.clearTimeout(movementTimer.current);
      }
      movementTimer.current = window.setTimeout(() => setMoving(false), 620);

      // The navigation helper expects a pathname without the locale prefix.
      const pathnameWithoutLocale = anchor.pathname.replace(/^\/[^/]+(?=\/|$)/, "") || "/";
      router.push(`${pathnameWithoutLocale}${anchor.search}${anchor.hash}`);
    };

    list.addEventListener("click", handleClick);
    return () => list.removeEventListener("click", handleClick);
  }, [currentKey, pathname, router]);

  return (
    <ul
      ref={listRef}
      className={styles.list}
      role="list"
      data-active={mounted ? activeKey : undefined}
      data-moving={moving ? "true" : undefined}
    >
      <LiquidBubble className={styles.movingBubble} aria-hidden="true" />
      {children}
    </ul>
  );
}
