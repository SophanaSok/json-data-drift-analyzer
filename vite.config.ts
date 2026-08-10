import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The policy applied to the deployed build.
 *
 * `connect-src` is the directive that matters: the app holds a Trello token in
 * memory while posting, and this is what stops an injected script from sending it
 * anywhere except Trello itself.
 *
 * `style-src` allows inline styles because the virtualized tables position rows with
 * inline `style` attributes. That is a real weakening against style injection, and it
 * is accepted deliberately — the exfiltration path is closed either way.
 *
 * `frame-ancestors` is deliberately absent: it is ignored when delivered in a meta
 * tag, and GitHub Pages cannot set response headers, so clickjacking protection is
 * not available by this route. Claiming it here would be decoration.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.trello.com",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join("; ");

/**
 * Injects the policy into the built HTML only.
 *
 * Not applied in development: Vite's dev server needs an inline script and a
 * websocket for hot reload, and loosening the policy to accommodate them would mean
 * shipping the loosened version. `e2e/csp.spec.ts` runs against the built output so
 * the real policy is exercised rather than assumed.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: "inject-content-security-policy",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
      );
    }
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: "/json-data-drift-analyzer/"
});
