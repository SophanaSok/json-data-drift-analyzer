/**
 * Node module-resolution hook: lets `node` run modules from src/, which use
 * extensionless relative imports (resolved by Vite in the app and by vitest in
 * tests, but not by plain Node ESM). A failed relative specifier is retried
 * with `.ts` appended — nothing else is rewritten.
 *
 * Load it before the entry point: node --import ./tools/ts-resolve.ts <script>
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (relative && !/\.(ts|tsx|js|mjs|json)$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  }
});
