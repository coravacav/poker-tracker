/**
 * Returns the items in a random order (Fisher–Yates). With two or more distinct
 * items the result always differs from the input, so a shuffle never looks like
 * a click that did nothing.
 */
export function shuffleSeatOrder<T>(items: readonly T[], random: () => number = Math.random): T[] {
  if (items.length < 2) return [...items];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    if (shuffled.some((item, index) => item !== items[index])) return shuffled;
  }

  // A run of unlucky (or stubbed) draws: rotate by one so the order still changes.
  return [...items.slice(1), items[0]];
}
