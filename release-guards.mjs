/**
 * What the changelog says about the version being cut (#334).
 *
 * CONTRIBUTING states the rule as though something enforces it:
 *
 *   "Mark the changelog entry BREAKING, and the release cut from `preview` is
 *    a MINOR; with no BREAKING entry in [Unreleased] it is a PATCH.
 *    The changelog is the answer — check it rather than remember it."
 *
 * Nothing read the marker. `npm run bump` takes the version as an argument and
 * its changelog gate measures DENSITY — bullets against commits since the last
 * tag — not what the bullets say. So `[Unreleased]` could hold a BREAKING entry
 * while someone ran `npm run bump -- 0.6.1`, and every surface would be
 * rewritten without a word. The two releases that got this right got it right
 * because somebody remembered.
 *
 * This lives outside `bump.mjs` for the same reason `closing-refs.mjs` lives
 * outside its workflow: it is a rule over prose that decides a release's
 * version number, and it should not sit unexercised inside a script that
 * rewrites twenty files as a side effect of being imported.
 */

/** Bullets in a changelog section marked BREAKING, in the order written. */
export function breakingEntries(section) {
  // All 11 BREAKING bullets across 0.4.0–0.6.0 are spelled `- **BREAKING — `,
  // and the word appears nowhere else in the file, so anchoring to the bullet
  // is exact rather than hopeful. Asserted against that committed history in
  // the tests, not only against fixtures written to match.
  return [...(section ?? "").matchAll(/^- \*\*BREAKING\b[^\n]*/gm)].map((m) => m[0]);
}

/** The `## [Unreleased]` slice of a changelog, or "" if there is none. */
export function unreleasedSection(changelog) {
  const head = (changelog ?? "").indexOf("## [Unreleased]");
  if (head === -1) return "";
  const next = changelog.indexOf("## [", head + "## [Unreleased]".length);
  return changelog.slice(head, next === -1 ? undefined : next);
}

/**
 * Why this bump must not proceed, or null if it may.
 *
 * ONE DIRECTION ONLY. A minor with no BREAKING entry is ordinary — features
 * ship in minors — so only the patch-with-breaking case is an error. A major
 * is likewise never blocked: it is a superset of what breaking demands.
 */
export function refuseBump(changelog, current, next) {
  const breaking = breakingEntries(unreleasedSection(changelog));
  if (breaking.length === 0) return null;
  const [cMaj, cMin] = current.split(".").map(Number);
  const [nMaj, nMin] = next.split(".").map(Number);
  if (nMaj !== cMaj || nMin !== cMin) return null; // a minor or major carries it fine
  const expected = `${cMaj}.${cMin + 1}.0`;
  return [
    `✗ [Unreleased] holds ${breaking.length} BREAKING entr${breaking.length === 1 ? "y" : "ies"}, so ${next} cannot be a patch.`,
    `  ${breaking[0].slice(0, 96)}${breaking[0].length > 96 ? "…" : ""}`,
    `  A breaking change in a patch is the promise this project makes about versions, broken silently.`,
    `  Cut ${expected} instead — or, if the entry is not really breaking, ADR 0041 has the worked table.`,
    `  (Nothing has been modified.)`,
  ].join("\n");
}
