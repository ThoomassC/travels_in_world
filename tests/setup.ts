import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * DO NOT REMOVE — verified on Node v25.5.0 (2026-08).
 *
 * Node 25 ships a native, global `localStorage` / `sessionStorage` (the
 * `--localstorage-file` feature). Because it is installed on the Node global
 * object, it *shadows* the implementation jsdom puts on `window`, and it is
 * unusable in tests: without a backing storage file the API throws, and the
 * jsdom-provided methods a component expects are simply not the ones it gets.
 *
 * The failure mode is obscure — a component that reads a persisted preference
 * blows up somewhere deep in a render, with no mention of storage in the stack.
 * So we install a deterministic in-memory Storage and reset it between tests.
 *
 * The project pins Node 24.x (`.nvmrc`, `engines`) where this shadowing does
 * not happen, but contributors and local shells drift; this stub keeps the
 * suite honest on both lines. Delete it only once no supported Node version
 * exposes a global storage object.
 */

/**
 * A stub only earns its keep if it diverges from the browser nowhere a test can
 * notice. Satisfying the `Storage` *interface* is not enough — the four
 * divergences below were measured on a plain class-based version, each one able
 * to turn a green test into a production bug. `tests/storage.test.ts` pins them.
 *
 * 1. Named property access. `localStorage.theme` and `localStorage["theme"]`
 *    read the stored value in a browser; on a class they read `undefined`. The
 *    `localStorage.theme` idiom would have passed the suite and shipped broken.
 * 2. Enumeration. `Object.keys(localStorage)` must list the stored keys. On a
 *    class holding a `Map` field it listed `["entries"]` — TypeScript's
 *    `private` is a compile-time fiction, the field is a real enumerable own
 *    property — so code walking the storage saw exactly the wrong set.
 * 3. Key coercion. `setItem(2, "x")` stores under `"2"` in a browser.
 * 4. Reset. Anything written *as a property* has to land in the same store that
 *    `clear()` empties, or it survives `afterEach` and leaks into the next test
 *    in the file.
 *
 * Hence a `Proxy` over a non-enumerable method table: reads and writes of any
 * other name are routed to the backing `Map`, which is the single thing
 * `clear()` empties and the single source for enumeration.
 *
 * Accepted, documented divergence: a key colliding with a `Storage` member name
 * (`setItem("getItem", …)`) stays readable through `getItem` but not through
 * property access — a browser would let the stored value shadow the method and
 * break the object. Shadowing the API in a test stub buys nothing.
 */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();

  const api: Storage = {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.get(String(key)) ?? null;
    },
    key(index: number): string | null {
      return Array.from(entries.keys())[Number(index)] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(String(key));
    },
    setItem(key: string, value: string): void {
      entries.set(String(key), String(value));
    },
  };

  // In a browser these live on `Storage.prototype`, so they never show up in
  // `Object.keys(localStorage)`. An object literal makes them enumerable own
  // properties; hide them so enumeration can only ever report stored keys.
  for (const member of Object.keys(api)) {
    Object.defineProperty(api, member, { enumerable: false });
  }

  /** True for the storage API itself (and `Object.prototype`), false for a key. */
  const isApiMember = (property: string | symbol): boolean => property in api;

  return new Proxy(api, {
    get(target, property, receiver) {
      if (typeof property === "string" && !isApiMember(property) && entries.has(property)) {
        return entries.get(property);
      }
      return Reflect.get(target, property, receiver);
    },

    set(target, property, value, receiver) {
      if (typeof property === "string" && !isApiMember(property)) {
        entries.set(property, String(value));
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    },

    has(target, property) {
      return (
        (typeof property === "string" && entries.has(property)) || Reflect.has(target, property)
      );
    },

    deleteProperty(target, property) {
      if (typeof property === "string" && entries.has(property)) {
        entries.delete(property);
        return true;
      }
      return Reflect.deleteProperty(target, property);
    },

    // Stored keys only — same as a browser, where the methods sit on the
    // prototype. The method table is configurable, so omitting it here breaks
    // no Proxy invariant.
    ownKeys() {
      return Array.from(entries.keys());
    },

    getOwnPropertyDescriptor(target, property) {
      if (typeof property === "string" && entries.has(property)) {
        return {
          value: entries.get(property),
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}

vi.stubGlobal("localStorage", createMemoryStorage());
vi.stubGlobal("sessionStorage", createMemoryStorage());

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});
