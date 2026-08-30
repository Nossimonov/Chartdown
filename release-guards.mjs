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

/**
 * Released changelog sections are frozen (#378).
 *
 * `bump` rolls `[Unreleased]` into a new section, so anything appearing in a
 * released one afterwards was added by hand — and every time it has happened it
 * was an insertion aimed at `[Unreleased]` that missed. The damage is doubled:
 * the release is credited with a fix it does not contain, AND the fix appears
 * in no future release's notes, because `bump` only ever rolls `[Unreleased]`.
 *
 * That is #351's defect, and it recurred twice more — #363's and #365's entries
 * — from the same cause: an insertion searching for `### Fixed` globally when
 * `[Unreleased]` had no such block yet, finding the released one.
 *
 * ONE EXCEPTION, recorded rather than hidden: `0.4.0` was tagged with a single
 * bullet for 117 commits (its section had been written onto the wrong branch,
 * and the push reported success for a no-op), and its real notes were written
 * afterwards. That section is legitimately LARGER than at its tag, and freezing
 * it would restore the broken version.
 */
export const FROZEN_EXCEPTIONS = new Set(["0.4.0"]);

/** The `## [x.y.z]` section of a changelog, heading included, or "". */
export function releasedSection(changelog, version) {
  const head = (changelog ?? "").indexOf(`## [${version}]`);
  if (head === -1) return "";
  const next = changelog.indexOf("## [", head + 5);
  return changelog.slice(head, next === -1 ? undefined : next).trimEnd();
}

/**
 * Why a released section must not ship as it stands, or null.
 *
 * `atTag` is that section as it was when the version was tagged. The caller
 * supplies it, so this stays pure and the git call lives at the edge.
 */
export function refuseDriftedSection(version, now, atTag) {
  if (FROZEN_EXCEPTIONS.has(version)) return null;
  if (atTag === "") return null;
  // The HEADING is excluded, deliberately. 0.3.0 and 0.3.1 carry a date
  // corrected by a day after tagging, which is a repair rather than the defect
  // this guards — that defect is entries appearing in a shipped section. A
  // growing exception list for date fixes would dull the check for no gain.
  const body = (text) => text.split("\n").slice(1).join("\n").trim();
  if (body(now) === body(atTag)) return null;
  const bullets = (text) => text.split("\n").filter((l) => l.startsWith("- ")).length;
  const added = bullets(now) - bullets(atTag);
  return [
    `\u2717 The released section [${version}] no longer matches its tag.`,
    added > 0
      ? `  It has gained ${added} entr${added === 1 ? "y" : "ies"} since v${version} shipped.`
      : `  Its text has changed since v${version} shipped.`,
    `  A released section is frozen: bump rolls only [Unreleased], so an entry`,
    `  added here is credited to a release that does not contain it AND will`,
    `  appear in no future release's notes at all (#351, #378).`,
    `  Move it to [Unreleased]. (Nothing has been modified.)`,
  ].join("\n");
}
