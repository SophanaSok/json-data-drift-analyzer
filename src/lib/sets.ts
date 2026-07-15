export function intersectSets(sets: Array<Set<string> | undefined>): Set<string> {
  const valid = sets.filter((set): set is Set<string> => Boolean(set));
  if (valid.length === 0) {
    return new Set<string>();
  }
  const [first, ...rest] = valid.sort((a, b) => a.size - b.size);
  const output = new Set<string>();
  for (const id of first) {
    if (rest.every((set) => set.has(id))) {
      output.add(id);
    }
  }
  return output;
}
