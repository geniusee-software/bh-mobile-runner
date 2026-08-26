/** Quoted labels, then CamelCase or shouted names, strongest clue first. */
const QUOTED = /['"“”]([^'"“”]{2,60})['"“”]/g;
const NAMED = /\b([A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[A-Z]{3,}(?:\s+[A-Z]{2,})*)\b/g;

/**
 * The things an instruction names, in the words the app would use.
 *
 * Used to tell a shallow tree that missed something from a screen that has
 * nothing on it. A case says "Tap the 'View all' button" or "Open
 * AhavasYisroel4Life", and if neither string is anywhere in the tree we read,
 * the odds are we did not read far enough rather than that the app is empty.
 */
export function namedTargets(text: string): string[] {
  const terms: string[] = [];
  const push = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && trimmed.length > 1 && !terms.includes(trimmed)) {
      terms.push(trimmed);
    }
  };

  for (const match of text.matchAll(QUOTED)) push(match[1]);
  QUOTED.lastIndex = 0;
  for (const match of text.matchAll(NAMED)) push(match[1]);
  NAMED.lastIndex = 0;

  return terms;
}
