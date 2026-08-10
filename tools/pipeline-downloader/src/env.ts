/**
 * The dashboard URL and login, read from the environment and nowhere else.
 *
 * No credential is accepted on the command line (it would land in shell history and in
 * `ps` output), read from a config file, or written anywhere by this tool. Nothing is
 * cached between runs either: the browser context is created fresh each time and its
 * `storageState` is never saved, so a session ends when the process does.
 */

export const REQUIRED_ENV_VARS = ["PIPELINE_DASHBOARD_URL", "PIPELINE_USERNAME", "PIPELINE_PASSWORD"] as const;

export type PipelineEnv = {
  baseUrl: string;
  username: string;
  password: string;
  /** True when the dashboard URL is plain http, so the caller can warn. */
  insecureTransport: boolean;
};

export type EnvResult = { status: "ok"; env: PipelineEnv } | { status: "error"; message: string };

export function readPipelineEnv(source: Record<string, string | undefined>): EnvResult {
  const missing = REQUIRED_ENV_VARS.filter((name) => (source[name] ?? "").trim().length === 0);
  if (missing.length > 0) {
    return { status: "error", message: `Missing environment variable(s): ${missing.join(", ")}. See .env.example.` };
  }

  const rawUrl = (source.PIPELINE_DASHBOARD_URL ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { status: "error", message: "PIPELINE_DASHBOARD_URL is not a valid URL (include the scheme)." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { status: "error", message: `PIPELINE_DASHBOARD_URL must be http or https, not "${parsed.protocol}".` };
  }

  return {
    status: "ok",
    env: {
      // Trailing slash trimmed so paths can be appended without doubling it.
      baseUrl: rawUrl.replace(/\/+$/, ""),
      username: (source.PIPELINE_USERNAME ?? "").trim(),
      // Not trimmed: leading or trailing whitespace can be part of a password.
      password: source.PIPELINE_PASSWORD ?? "",
      insecureTransport: parsed.protocol === "http:"
    }
  };
}

/** Everything that must never appear in console output or the run log. */
export function secretsOf(env: PipelineEnv): string[] {
  return [env.password, env.username];
}
