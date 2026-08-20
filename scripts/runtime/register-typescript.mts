import { register } from "node:module";

/**
 * Installs {@link file://./typescript-resolve.mts} for the whole process. Loaded
 * through `node --import`, which is what makes the hook active for the entry
 * point itself and not only for what the entry point imports.
 *
 * Kept apart from the hook it registers because `register()` runs the hook on a
 * separate loader thread: a module cannot register itself.
 */
register("./typescript-resolve.mts", import.meta.url);
