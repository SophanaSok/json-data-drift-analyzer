import { describe, expect, it } from "vitest";
import { readPipelineEnv, secretsOf } from "./env.ts";

const valid = {
  PIPELINE_DASHBOARD_URL: "https://dashboard.internal.example/",
  PIPELINE_USERNAME: "ops@example.com",
  PIPELINE_PASSWORD: "hunter2"
};

function readOk(source: Record<string, string | undefined>) {
  const result = readPipelineEnv(source);
  if (result.status !== "ok") throw new Error(`expected ok, got: ${result.message}`);
  return result.env;
}

function readError(source: Record<string, string | undefined>): string {
  const result = readPipelineEnv(source);
  if (result.status !== "error") throw new Error("expected an error");
  return result.message;
}

describe("readPipelineEnv", () => {
  it("reads the three variables and trims the trailing slash", () => {
    expect(readOk(valid)).toEqual({
      baseUrl: "https://dashboard.internal.example",
      username: "ops@example.com",
      password: "hunter2",
      insecureTransport: false
    });
  });

  it("names every missing variable at once", () => {
    const message = readError({ PIPELINE_DASHBOARD_URL: valid.PIPELINE_DASHBOARD_URL });
    expect(message).toContain("PIPELINE_USERNAME");
    expect(message).toContain("PIPELINE_PASSWORD");
  });

  it("treats a blank value as missing", () => {
    expect(readError({ ...valid, PIPELINE_PASSWORD: "   " })).toContain("PIPELINE_PASSWORD");
  });

  it("keeps whitespace inside a password, which may be part of it", () => {
    expect(readOk({ ...valid, PIPELINE_PASSWORD: " pad ded " }).password).toBe(" pad ded ");
  });

  it("flags plain http so the caller can warn about the login going out in clear", () => {
    expect(readOk({ ...valid, PIPELINE_DASHBOARD_URL: "http://dash.internal" }).insecureTransport).toBe(true);
  });

  it("rejects a URL it cannot use", () => {
    expect(readError({ ...valid, PIPELINE_DASHBOARD_URL: "dashboard.internal" })).toMatch(/not a valid URL/);
    expect(readError({ ...valid, PIPELINE_DASHBOARD_URL: "file:///etc" })).toMatch(/must be http or https/);
  });
});

describe("secretsOf", () => {
  it("covers both values that must never be printed", () => {
    expect(secretsOf(readOk(valid))).toEqual(["hunter2", "ops@example.com"]);
  });
});
