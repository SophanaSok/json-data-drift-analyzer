export function detectCollectionPaths(input: unknown): string[] {
  if (Array.isArray(input)) {
    return ["$"];
  }
  if (input && typeof input === "object") {
    const output: string[] = [];
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        output.push(key);
      }
    }
    return output;
  }
  return [];
}

export function getCollection(input: unknown, path: string): Array<Record<string, unknown>> {
  const source = path === "$" ? input : (input as Record<string, unknown> | undefined)?.[path];
  if (!Array.isArray(source)) {
    return [];
  }
  return source.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

export function normalizeRecord(record: Record<string, unknown>, ignoredFields: string[]): Record<string, unknown> {
  const ignored = new Set(ignoredFields);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key)));
}
