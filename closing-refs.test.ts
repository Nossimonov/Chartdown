/**
 * What a PR body says it closes (#310).
 *
 * This regex decides whether somebody's issue closes, so it is tested rather
 * than trusted: the first two attempts at writing it both returned an empty
 * array for every input — once because an inner group stole the capture index,
 * once because a shell ate the backslashes and `\b` became a backspace. Both
 * failed silently, in the direction of "nothing to close", which is exactly the
 * failure this whole issue is about.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM helper, shared with the workflow that uses it.
import { closingRefs } from "./closing-refs.mjs";

const refs = (body: string | null): number[] => closingRefs(body) as number[];

describe("a closing keyword is honoured", () => {
  it("the ordinary case", () => {
    expect(refs("Closes #295.")).toEqual([295]);
  });

  it("several in one body, in the order written", () => {
    // #298 closed five issues in one PR; that is the shape this must survive.
    expect(refs("Closes #284. Closes #288. Closes #285. Closes #289. Closes #291.")).toEqual([284, 288, 285, 289, 291]);
  });

  it("every keyword GitHub documents, in any case", () => {
    expect(refs("closes #1, Fixes #2, RESOLVED #3, fix #4, close #5, resolve #6")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("with a colon, as GitHub also allows", () => {
    expect(refs("Resolves: #8")).toEqual([8]);
  });

  it("deduplicates rather than closing twice", () => {
    expect(refs("Closes #12, and closes #12 again")).toEqual([12]);
  });
});

describe("a mention is not a closing reference", () => {
  it("a bare number is left alone", () => {
    // Closing an issue somebody merely referenced would be worse than the bug
    // this fixes — our PR bodies cite related issues constantly.
    expect(refs("see #99 and refs #100")).toEqual([]);
  });

  it("a citation beside a closing keyword takes only the closed one", () => {
    expect(refs("Building on the work in #50, closes #51")).toEqual([51]);
  });

  it("a keyword inside a longer word does not count", () => {
    expect(refs("unclosed #7 · prefixes #8")).toEqual([]);
  });

  it("a keyword with no number closes nothing", () => {
    expect(refs("This closes the discussion")).toEqual([]);
  });

  it("an empty or missing body is not an error", () => {
    expect(refs("")).toEqual([]);
    expect(refs(null)).toEqual([]);
  });
});

describe("against bodies this repository has actually merged", () => {
  it("the release PR closes nothing, which is why 0.6.0 shipped with 20 open", () => {
    const body = "Brings `main` to **0.6.0**. 46 commits, 18 changelog entries, four of them BREAKING.\n\n"
      + "| #266 | an archetype name is grammar |\n| #293 / #294 | a structure detail |\n";
    expect(refs(body)).toEqual([]);
  });

  it("a fix PR closes exactly what it named", () => {
    const body = "Closes #293. Closes #294.\n\n## The slot was closed in the spec and open in the renderer\n\n"
      + "Spec 06 §3 makes a structure detail a closed set … that is the else-branch #103 fixed the routing into.";
    expect(refs(body)).toEqual([293, 294]); // and NOT #103, which is cited
  });
});
