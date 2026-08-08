/**
 * The issues a pull request body says it closes (#310).
 *
 * GitHub honours `Closes #n` only when a PR merges into the DEFAULT branch.
 * Every PR here targets `preview`, so the keyword has never once fired: the
 * fixes accumulate, `main` receives them in one release PR that describes a
 * release rather than listing twenty numbers, and nothing closes. 0.6.0
 * shipped with twenty issues fixed, released and published while still open.
 *
 * So the keyword is honoured here instead, by a workflow on `preview`. This
 * file is the part worth testing — a regex over prose that decides whether
 * someone's issue closes — and it lives outside the workflow so it CAN be
 * tested. The batch that closed 0.6.0's issues by hand needed three attempts;
 * the parsing should not be the sort of thing anybody attempts by hand again.
 *
 * Keywords and syntax follow GitHub's own documented set, so a contributor
 * writing what the platform documents gets what the platform promises.
 */

/** close/closes/closed · fix/fixes/fixed · resolve/resolves/resolved */
const KEYWORDS = String.raw`close[sd]?|fix(?:e[sd])?|resolve[sd]?`;

/**
 * Issue numbers a body closes, deduped, in first-seen order.
 *
 * A bare `#12` or a `see #12` is deliberately NOT a closing reference — the
 * keyword is what distinguishes "this fixes it" from "this is related to it",
 * and a mention closing someone's issue would be worse than the bug this fixes.
 */
export function closingRefs(body) {
  const re = new RegExp(String.raw`\b(?:${KEYWORDS})\b:?\s+#(\d+)`, "gi");
  return [...new Set([...(body ?? "").matchAll(re)].map((m) => Number(m[1])))];
}

// CLI: body on stdin, one issue number per line on stdout. Used by the
// workflow so the parsing above is the same code the tests exercise.
if (process.argv[2] === "--stdin") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  for (const n of closingRefs(Buffer.concat(chunks).toString("utf8"))) console.log(n);
}
