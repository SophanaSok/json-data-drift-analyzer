/**
 * Structural validation for profile JSON files.
 *
 * Imported JSON is cast, never type-checked, so this is where a bad file fails
 * loudly instead of silently governing recovery. Unknown keys are rejected —
 * a typo like `safeBackfilFields` must surface as an error, not silently grant
 * nothing. Pure and dependency-free so node tooling can import it directly.
 */

import type { SourceProfileBase, SourceProfileDelta, ProfileOverrideDelta } from "./schema";

const SEVERITIES = new Set(["pass", "info", "warning", "high", "critical"]);

type Problems = string[];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isStringArrayArray = (v: unknown): v is string[][] => Array.isArray(v) && v.every(isStringArray);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Per-key structural checks, shared by base, delta, and override validation. */
const TOP_LEVEL_CHECKS: Record<string, (v: unknown, problems: Problems, keyName?: string) => void> = {
  id: expect(isString, "a string"),
  sourceUrl: (v, problems) => {
    if (!isString(v) || v.length === 0) {
      problems.push(`sourceUrl must be a non-empty string.`);
      return;
    }
    if (!URL.canParse(v)) {
      problems.push(`sourceUrl "${v}" does not parse as a URL.`);
    }
  },
  displayName: expect(isString, "a string"),
  agency: expect(isString, "a string"),
  version: (v, problems) => {
    if (!isFiniteNumber(v) || !Number.isInteger(v) || v < 1) {
      problems.push(`version must be a positive integer, got ${JSON.stringify(v)}.`);
    }
  },
  collectionPath: expect(isString, "a string"),
  primaryKey: expect(isStringArray, "a string array"),
  fallbackKeys: expect(isStringArrayArray, "an array of string arrays"),
  dedupeKey: expect(isStringArray, "a string array"),
  hardRequiredFields: expect(isStringArray, "a string array"),
  safeBackfillFields: expect(isStringArray, "a string array"),
  manualReviewFields: expect(isStringArray, "a string array"),
  excludedFields: expect(isStringArray, "a string array"),
  minimumMatchRate: expect(isFiniteNumber, "a number"),
  recordCountTolerance: expect(isFiniteNumber, "a number"),
  dateSensitiveFields: expect(isStringArray, "a string array"),
  notes: expect(isStringArray, "a string array"),
  candidateOnlyPolicy: (v, problems) => {
    if (v !== "keep" && v !== "exclude") {
      problems.push(`candidateOnlyPolicy must be "keep" or "exclude", got ${JSON.stringify(v)}.`);
    }
  },
  validation: subObject("validation", {
    dateFields: expect(isStringArray, "a string array"),
    urlFields: expect(isStringArray, "a string array"),
    emailFields: expect(isStringArray, "a string array"),
    phoneFields: expect(isStringArray, "a string array"),
    jsonFields: expect(isStringArray, "a string array")
  }),
  corroboration: subObject("corroboration", {
    textFields: expect(isStringArray, "a string array"),
    deadlineCues: expect(isStringArray, "a string array")
  }),
  exportGate: subObject("exportGate", {
    blockOnBelowMinimumMatchRate: expect((v) => typeof v === "boolean", "a boolean"),
    blockOnCriticalFindings: expect((v) => typeof v === "boolean", "a boolean")
  }),
  alerts: subObject("alerts", {
    duplicateTitle: subObject("alerts.duplicateTitle", {
      field: (v, problems) => {
        if (!isString(v) || v.length === 0) problems.push("alerts.duplicateTitle.field must be a non-empty string.");
      },
      threshold: (v, problems) => {
        if (!isFiniteNumber(v) || !Number.isInteger(v) || v < 2) {
          problems.push(`alerts.duplicateTitle.threshold must be an integer of at least 2, got ${JSON.stringify(v)}.`);
        }
      }
    })
  }),
  detection: subObject("detection", {
    identityValues: (v, problems) => {
      if (!isRecord(v)) {
        problems.push("detection.identityValues must be an object keyed by field name.");
        return;
      }
      for (const [field, values] of Object.entries(v)) {
        if (!isStringArray(values) || values.length === 0) {
          problems.push(`detection.identityValues["${field}"] must be a non-empty string array.`);
        }
      }
    },
    urlFields: expect(isStringArray, "a string array"),
    urlPrefixes: expect(isStringArray, "a string array")
  }),
  quality: validateQuality
};

/** Full quality section: required keys when validating a base. */
const QUALITY_REQUIRED_KEYS = [
  "requiredFields",
  "optionalEmptyFields",
  "emptyRules",
  "identityDefault",
  "fieldGroups",
  "documentFieldPairs",
  "searchSourceFields"
] as const;

function validateQuality(value: unknown, problems: Problems): void {
  if (!isRecord(value)) {
    problems.push("quality must be an object.");
    return;
  }
  const checks: Record<string, (v: unknown, problems: Problems, keyName?: string) => void> = {
    requiredFields: expect(isStringArray, "a string array"),
    optionalEmptyFields: expect(isStringArray, "a string array"),
    identityDefault: expect(isStringArray, "a string array"),
    emptyRules: (v, p) => {
      if (!isRecord(v)) {
        p.push("quality.emptyRules must be an object keyed by field name.");
        return;
      }
      for (const [field, rule] of Object.entries(v)) {
        if (!isRecord(rule)) {
          p.push(`quality.emptyRules["${field}"] must be an object.`);
          continue;
        }
        for (const key of Object.keys(rule)) {
          if (key === "allowEmptyArray") {
            if (typeof rule[key] !== "boolean") p.push(`quality.emptyRules["${field}"].allowEmptyArray must be a boolean.`);
          } else if (key === "placeholders") {
            if (!isStringArray(rule[key])) p.push(`quality.emptyRules["${field}"].placeholders must be a string array.`);
          } else {
            p.push(`quality.emptyRules["${field}"] has unknown key "${key}".`);
          }
        }
      }
    },
    fieldGroups: (v, p) => {
      if (!Array.isArray(v)) {
        p.push("quality.fieldGroups must be an array.");
        return;
      }
      v.forEach((group, i) => {
        if (!isRecord(group)) {
          p.push(`quality.fieldGroups[${i}] must be an object.`);
          return;
        }
        const groupChecks: Record<string, (gv: unknown) => boolean> = {
          id: isString,
          name: isString,
          narrative: isString,
          fields: isStringArray,
          thresholdDrop: isFiniteNumber,
          minAffectedFields: isFiniteNumber,
          severity: (gv) => isString(gv) && SEVERITIES.has(gv)
        };
        for (const [key, check] of Object.entries(groupChecks)) {
          if (!(key in group)) p.push(`quality.fieldGroups[${i}] is missing "${key}".`);
          else if (!check(group[key])) p.push(`quality.fieldGroups[${i}].${key} is invalid.`);
        }
        for (const key of Object.keys(group)) {
          if (!(key in groupChecks)) p.push(`quality.fieldGroups[${i}] has unknown key "${key}".`);
        }
      });
    },
    documentFieldPairs: (v, p) => {
      if (!Array.isArray(v)) {
        p.push("quality.documentFieldPairs must be an array.");
        return;
      }
      v.forEach((pair, i) => {
        if (!isRecord(pair) || !isString(pair.docs) || !isString(pair.hashes)) {
          p.push(`quality.documentFieldPairs[${i}] must be { docs: string, hashes: string }.`);
          return;
        }
        for (const key of Object.keys(pair)) {
          if (key !== "docs" && key !== "hashes") p.push(`quality.documentFieldPairs[${i}] has unknown key "${key}".`);
        }
      });
    },
    searchSourceFields: (v, p) => {
      if (!isRecord(v)) {
        p.push("quality.searchSourceFields must be an object.");
        return;
      }
      for (const role of ["title", "status", "type", "url"]) {
        if (!isString(v[role])) p.push(`quality.searchSourceFields.${role} must be a string.`);
      }
      for (const key of Object.keys(v)) {
        if (!["title", "status", "type", "url"].includes(key)) {
          p.push(`quality.searchSourceFields has unknown key "${key}".`);
        }
      }
    }
  };
  for (const [key, v] of Object.entries(value)) {
    const check = checks[key];
    if (!check) problems.push(`quality has unknown key "${key}".`);
    else check(v, problems, `quality.${key}`);
  }
}

function expect(check: (v: unknown) => boolean, expected: string) {
  return (value: unknown, problems: Problems, keyName?: string): void => {
    if (!check(value)) {
      problems.push(`${keyName ?? "value"} must be ${expected}, got ${summarize(value)}.`);
    }
  };
}

function subObject(name: string, checks: Record<string, (v: unknown, p: Problems, k?: string) => void>) {
  return (value: unknown, problems: Problems): void => {
    if (!isRecord(value)) {
      problems.push(`${name} must be an object.`);
      return;
    }
    for (const [key, v] of Object.entries(value)) {
      const check = checks[key];
      if (!check) problems.push(`${name} has unknown key "${key}".`);
      else check(v, problems, `${name}.${key}`);
    }
  };
}

function summarize(value: unknown): string {
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json.length > 60 ? `${json.slice(0, 57)}...` : json;
}

function checkKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  problems: Problems
): void {
  for (const [key, v] of Object.entries(value)) {
    const check = allowed.has(key) ? TOP_LEVEL_CHECKS[key] : undefined;
    if (!check) {
      problems.push(`Unknown key "${key}" — a misspelled policy key must fail, not silently grant nothing.`);
      continue;
    }
    check(v, problems, key);
  }
}

const DELTA_ONLY_KEYS = ["id", "sourceUrl", "version", "safeBackfillFields", "notes", "displayName", "agency", "detection"] as const;
const ALL_KEYS = new Set(Object.keys(TOP_LEVEL_CHECKS));
const BASE_KEYS = new Set([...ALL_KEYS].filter((k) => !(DELTA_ONLY_KEYS as readonly string[]).includes(k)));
const BASE_REQUIRED_KEYS = [
  "collectionPath",
  "primaryKey",
  "fallbackKeys",
  "dedupeKey",
  "hardRequiredFields",
  "manualReviewFields",
  "excludedFields",
  "minimumMatchRate",
  "quality"
] as const;
const DELTA_REQUIRED_KEYS = ["id", "sourceUrl", "version", "safeBackfillFields"] as const;
/** An override may tweak policy but never re-identify or re-version the profile. */
const OVERRIDE_KEYS = new Set([...ALL_KEYS].filter((k) => !["id", "sourceUrl", "version"].includes(k)));

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; problems: string[] };

export function validateBase(value: unknown): ValidationResult<SourceProfileBase> {
  const problems: Problems = [];
  if (!isRecord(value)) return { ok: false, problems: ["Base profile must be a JSON object."] };
  for (const key of BASE_REQUIRED_KEYS) {
    if (!(key in value)) problems.push(`Base profile is missing required key "${key}".`);
  }
  checkKnownKeys(value, BASE_KEYS, problems);
  if (isRecord(value.quality)) {
    for (const key of QUALITY_REQUIRED_KEYS) {
      if (!(key in value.quality)) problems.push(`Base quality section is missing required key "${key}".`);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: value as unknown as SourceProfileBase };
}

export function validateDelta(value: unknown): ValidationResult<SourceProfileDelta> {
  const problems: Problems = [];
  if (!isRecord(value)) return { ok: false, problems: ["Profile delta must be a JSON object."] };
  for (const key of DELTA_REQUIRED_KEYS) {
    if (!(key in value)) {
      problems.push(
        key === "safeBackfillFields"
          ? `Delta is missing "safeBackfillFields" — state it explicitly, [] when no field is approved (AGENTS.md rules 4/6).`
          : `Delta is missing required key "${key}".`
      );
    }
  }
  checkKnownKeys(value, ALL_KEYS, problems);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: value as unknown as SourceProfileDelta };
}

export function validateOverrideDelta(value: unknown): ValidationResult<ProfileOverrideDelta> {
  const problems: Problems = [];
  if (!isRecord(value)) return { ok: false, problems: ["Override delta must be a JSON object."] };
  checkKnownKeys(value, OVERRIDE_KEYS, problems);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: value as unknown as ProfileOverrideDelta };
}
