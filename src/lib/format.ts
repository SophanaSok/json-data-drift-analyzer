export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function compactCount(value: number): string {
  return Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}
