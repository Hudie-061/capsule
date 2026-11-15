// Russian plural forms: plural(3, ["вещь", "вещи", "вещей"]) -> "вещи"
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100; const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
