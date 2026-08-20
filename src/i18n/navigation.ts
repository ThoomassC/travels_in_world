import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * The only sanctioned navigation primitives for internal routes. `next/link`
 * and `next/navigation`'s `redirect` are banned everywhere else by ESLint
 * (`no-restricted-imports`) because they ignore the `[locale]` segment.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
