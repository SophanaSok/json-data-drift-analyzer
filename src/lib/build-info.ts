/**
 * Build identifier, stamped by Vite at build time (see `define` in vite.config.ts).
 *
 * In CI this is the commit SHA, so a "wrong numbers" report can be tied to the
 * exact build that produced it. In dev and in test runners the define is absent
 * and this falls back to "dev".
 */
declare const __APP_COMMIT__: string;

export const BUILD_COMMIT: string = typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : "dev";

/** Short form for display surfaces. */
export const BUILD_COMMIT_SHORT: string = BUILD_COMMIT === "dev" ? "dev" : BUILD_COMMIT.slice(0, 12);
