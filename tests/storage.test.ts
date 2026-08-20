import { describe, expect, it } from "vitest";

/**
 * Contract tests for the `Storage` stub installed by `tests/setup.ts`.
 *
 * They do not test a feature — they test the test harness, which is worth doing
 * exactly once: every divergence pinned here was a way for the suite to stay
 * green while the same code broke in a browser. Read the comment in
 * `tests/setup.ts` before changing any expectation.
 */

/**
 * Calls `setItem` off-contract on purpose. A browser coerces both arguments
 * with `String()`; TypeScript's signature forbids even writing the call, which
 * is why the coercion went untested and unimplemented.
 */
function setUntyped(storage: Storage, key: unknown, value: unknown): void {
  const untyped = storage.setItem as unknown as (key: unknown, value: unknown) => void;
  untyped.call(storage, key, value);
}

describe("the localStorage stub behaves like the browser's", () => {
  it("reads a stored value through named property access", () => {
    window.localStorage.setItem("theme", "dark");

    expect(window.localStorage.theme).toBe("dark");
    expect(window.localStorage["theme"]).toBe("dark");
    expect("theme" in window.localStorage).toBe(true);
  });

  it("routes a named property write into the store", () => {
    window.localStorage.theme = "light";

    expect(window.localStorage.getItem("theme")).toBe("light");
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.key(0)).toBe("theme");
  });

  it("deletes a stored value through the delete operator", () => {
    window.localStorage.setItem("theme", "dark");

    expect(delete window.localStorage.theme).toBe(true);

    expect(window.localStorage.getItem("theme")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("enumerates the stored keys, and nothing else", () => {
    window.localStorage.setItem("theme", "dark");
    window.localStorage.setItem("visits", "3");

    // The class-based stub answered ["entries"] here — its own Map field.
    expect(Object.keys(window.localStorage)).toEqual(["theme", "visits"]);
    expect(Object.entries(window.localStorage)).toEqual([
      ["theme", "dark"],
      ["visits", "3"],
    ]);
    expect({ ...window.localStorage }).toEqual({ theme: "dark", visits: "3" });
    expect(JSON.parse(JSON.stringify(window.localStorage))).toEqual({
      theme: "dark",
      visits: "3",
    });
  });

  it("keeps the API off the enumerable keys", () => {
    window.localStorage.setItem("theme", "dark");

    for (const member of ["entries", "getItem", "setItem", "length", "clear"]) {
      expect(Object.keys(window.localStorage)).not.toContain(member);
    }
    // …while the API itself stays callable.
    expect(typeof window.localStorage.getItem).toBe("function");
  });

  it("coerces keys and values to strings", () => {
    setUntyped(window.localStorage, 2, "deux");
    setUntyped(window.localStorage, "count", 42);

    expect(window.localStorage.getItem("2")).toBe("deux");
    expect(window.localStorage.getItem("count")).toBe("42");
    expect(Object.keys(window.localStorage)).toEqual(["2", "count"]);
  });

  it("leaks nothing written as a property into the next test", () => {
    expect(window.localStorage.length).toBe(0);
    expect(Object.keys(window.localStorage)).toEqual([]);

    // Written as a property, not through setItem: the class-based stub stored
    // this straight on the instance, where `clear()` could not reach it, and it
    // reappeared two tests later.
    window.localStorage.leaked = "1";

    expect(window.localStorage.length).toBe(1);
  });

  it("starts from an empty store even after the previous test wrote a property", () => {
    expect(window.localStorage.getItem("leaked")).toBeNull();
    expect(window.localStorage.leaked).toBeUndefined();
    expect(Object.keys(window.localStorage)).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps length, key(), clear() and a missing removeItem conformant", () => {
    expect(window.localStorage.length).toBe(0);
    expect(window.localStorage.key(0)).toBeNull();
    expect(window.localStorage.getItem("absent")).toBeNull();
    expect(() => window.localStorage.removeItem("absent")).not.toThrow();

    window.localStorage.setItem("a", "1");
    window.localStorage.setItem("b", "2");

    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.key(1)).toBe("b");
    expect(window.localStorage.key(2)).toBeNull();

    window.localStorage.clear();

    expect(window.localStorage.length).toBe(0);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it("gives sessionStorage its own independent store", () => {
    window.localStorage.setItem("shared", "local");
    window.sessionStorage.setItem("shared", "session");

    expect(window.localStorage.getItem("shared")).toBe("local");
    expect(window.sessionStorage.getItem("shared")).toBe("session");
    expect(window.sessionStorage.other).toBeUndefined();
  });
});
