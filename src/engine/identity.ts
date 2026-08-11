import { buildIdentityKey } from "./normalize";

export type IdentityDuplicates = {
  duplicates: Set<string>;
};

export type RecordIdentity = {
  /**
   * Collision-proof key: the identity components JSON-serialized in field order
   * (see `buildIdentityKey`), so a value containing a separator cannot forge a
   * collision. Null when any component is missing, blank, or non-scalar — such a
   * record cannot be keyed and must be surfaced, not silently merged under "".
   */
  key: string | null;
  /**
   * Human-readable form of the identity values, for display and sorting. Not
   * guaranteed unique — never use it as a map key.
   */
  label: string;
};

export function buildRecordKey(record: Record<string, unknown>, identityFields: string[]): RecordIdentity {
  const identity = buildIdentityKey(record, identityFields);
  return {
    key: identity.key,
    label: identity.values.map((value) => value ?? "?").join("::")
  };
}

export function collectDuplicateKeys(records: Array<Record<string, unknown>>, identityFields: string[]): IdentityDuplicates {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    const { key } = buildRecordKey(record, identityFields);
    // Unkeyable records are reported as unkeyed, not as duplicates of each other.
    if (key === null) {
      continue;
    }
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
  }
  return { duplicates };
}
