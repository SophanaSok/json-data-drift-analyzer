/**
 * Vitest setup.
 *
 * Node >= 22 exposes an experimental global `localStorage` that is unavailable unless
 * the process is started with `--localstorage-file` (it emits
 * "ExperimentalWarning: localStorage is not available..." on access). Vitest's jsdom
 * environment does not overwrite globals that already exist, so jsdom's own working
 * `localStorage` never lands on the global object and `window.localStorage` resolves to
 * Node's unusable stub.
 *
 * This installs an in-memory Storage only when the environment failed to provide a
 * working one. On Node versions without the experimental global, jsdom's real
 * implementation is present and this is inert.
 */

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(String(key)) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    }
  } as Storage;
}

function hasWorkingStorage(target: Window & typeof globalThis): boolean {
  try {
    return typeof target.localStorage?.setItem === "function";
  } catch {
    // Access itself can throw when storage is disabled.
    return false;
  }
}

if (typeof window !== "undefined" && !hasWorkingStorage(window)) {
  Object.defineProperty(window, "localStorage", {
    value: createMemoryStorage(),
    configurable: true
  });
}
