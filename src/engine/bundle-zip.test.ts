import { describe, expect, it } from "vitest";
import { buildZipArchive, readZipArchive, zipFileName } from "./bundle-zip";
import type { ExportArtifact } from "./export";

const artifacts: ExportArtifact[] = [
  { kind: "recovered", fileName: "a-recovered.json", contentType: "application/json", content: '{"Export":[{"Title":"Ünïcode — ok"}]}\n' },
  { kind: "findings", fileName: "a-findings.csv", contentType: "text/csv", content: "id,severity\r\n1,high\r\n" },
  { kind: "contractor-ticket", fileName: "a-ticket.md", contentType: "text/markdown", content: "# Ticket\n" }
];

describe("bundle zip", () => {
  it("round-trips every artifact byte-for-byte", () => {
    const files = readZipArchive(buildZipArchive(artifacts));
    expect(Object.keys(files).sort()).toEqual(artifacts.map((artifact) => artifact.fileName).sort());
    for (const artifact of artifacts) {
      expect(files[artifact.fileName]).toBe(artifact.content);
    }
  });

  it("is byte-identical for identical input (fixed timestamps)", () => {
    expect(buildZipArchive(artifacts)).toEqual(buildZipArchive(artifacts));
  });

  it("names the archive after the profile and run", () => {
    expect(zipFileName("bellingham-procureware", "2026-08-10T00:00:00.000Z")).toBe(
      "bellingham-procureware-bundle-2026-08-10T00-00-00-000Z.zip"
    );
    expect(zipFileName("", "2026-08-10T00:00:00.000Z")).toMatch(/^unnamed-bundle-/);
  });

  it("handles an empty bundle", () => {
    expect(readZipArchive(buildZipArchive([]))).toEqual({});
  });
});
