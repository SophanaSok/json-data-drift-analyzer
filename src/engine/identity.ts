export type IdentityDuplicates = {
  duplicates: Set<string>;
};

export function buildRecordKey(record: Record<string, unknown>, identityFields: string[]): string {
  return identityFields.map((field) => String(record[field] ?? "").trim()).join("::");
}

export function collectDuplicateKeys(records: Array<Record<string, unknown>>, identityFields: string[]): IdentityDuplicates {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    const key = buildRecordKey(record, identityFields);
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
  }
  return { duplicates };
}
