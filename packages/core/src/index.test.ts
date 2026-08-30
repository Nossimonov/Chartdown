import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, SPEC_VERSION } from "./index";
import { KNOWN_HEADER_KEYS } from "./parse";

/**
 * The documents a reader or an agent is served, which therefore must not make
 * a false claim about the language. DERIVED rather than listed: #363 was a
 * defect the check already existed for, in a file the hand-kept list omitted.
 */
const shippedDocs = (root: string): string[] => [
  ...readdirSync(join(root, "docs", "spec"))
    .filter((f) => f.endsWith(".md") || f.endsWith(".ebnf"))
    .map((f) => join("docs", "spec", f)),
  "README.md",
  join("playground", "llms.txt"),
];

describe("basics", () => {
  it("every version surface agrees — one bump command, one truth (#90)", () => {
    // Any surface that escapes `npm run bump` fails here, on every push and
    // in the release gate — never waiting for an owner catch (the failure
    // mode that shipped SPEC_VERSION=0.1 and a digest titled draft v0.1).
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
    const pkg = (name: string): { version: string; dependencies?: Record<string, string> } =>
      JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8").replace(/^﻿/, "")) as { version: string; dependencies?: Record<string, string> };
    const versions = ["core", "render-svg", "cli", "browser", "mcp", "action"].map((name) => pkg(name).version);
    expect(new Set(versions).size).toBe(1); // the six packages version together
    expect(pkg("render-svg").dependencies?.["@chartdown/core"]).toBe(versions[0]); // and the pin follows
    // The spec and the packages version together: SPEC_VERSION is major.minor.
    expect(SPEC_VERSION).toBe(versions[0]!.split(".").slice(0, 2).join("."));
    // The machine-ingestion artifacts — the digest is served publicly as
    // llms-full.txt, so a stale header misinforms every bootstrapping LLM.
    const specDir = join(root, "docs", "spec");
    expect(readFileSync(join(specDir, "digest.md"), "utf8").split("\n")[0]).toContain(`spec v${SPEC_VERSION}`);
    expect(readFileSync(join(specDir, "grammar.ebnf"), "utf8")).toContain(`spec v${SPEC_VERSION}`);
    expect(readFileSync(join(specDir, "README.md"), "utf8")).toContain(`spec v${SPEC_VERSION}`);
    // The project README: the status headline and the CDN embed pin.
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain(`Spec v${SPEC_VERSION}`);
    expect(readme).toContain(`@chartdown/browser@${SPEC_VERSION}`);
  });

  it("the README's syntax sketch is a document that checks (#351)", () => {
    // The README calls it "real, working syntax … this document renders today",
    // and it had not for some time: ADR 0015 made `start` the one staging-zone
    // spelling, #121 fixed the examples, and the sketch kept `party start`.
    // It is the first Chartdown most readers type, and nothing was reading it.
    //
    // The sketch is illustrative rather than normative (CONTRIBUTING rule 5),
    // so this asserts only that it PARSES CLEAN — not that it demonstrates any
    // particular feature, which would make the README a spec by the back door.
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
    const readme = readFileSync(join(root, "README.md"), "utf8");
    // `\r?\n`: this file is CRLF on Windows checkouts, and a `\n`-only fence
    // pattern silently matched nothing — the test passed by finding no sketch.
    const sketch = /```chartdown\r?\n([\s\S]*?)```/.exec(readme)?.[1];
    expect(sketch, "no ```chartdown block in README.md").toBeDefined();
    const errors = parse(sketch!).diagnostics.filter((d) => d.severity === "error");
    expect(errors.map((d) => `line ${d.line}: ${d.message}`)).toEqual([]);
  });

  it("the core and the renderer carry no third-party runtime dependency (ADR 0007, #335)", () => {
    // The rule that decides whether these packages stay embeddable, and until
    // now nothing asserted it. The test above checks that render-svg's PIN on
    // core matches the version — a different claim, which would pass just as
    // happily with `lodash` sitting beside it.
    //
    // Scope is exactly what the rule says: ADR 0007 binds the language core and
    // the renderer, and ADR 0011 deliberately lets `@chartdown/mcp` carry
    // runtime dependencies. Asserting more than was decided would block work
    // nobody has ruled on.
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
    for (const name of ["core", "render-svg"]) {
      const deps = Object.keys(
        (JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8").replace(/^﻿/, "")) as
          { dependencies?: Record<string, string> }).dependencies ?? {},
      );
      // A workspace sibling is not a dependency in the sense that matters — it
      // ships from this repo and carries the same rule.
      expect(deps.filter((d) => !d.startsWith("@chartdown/")), `${name} took a runtime dependency`).toEqual([]);
    }
  });

  it("llms.txt names the shipped version, and the corpus it describes (#363)", () => {
    // The FIRST file an agent reads: served at the site root, ahead of the
    // digest it points at. It said "the whole v0.2 language" at 0.7, and
    // "five complete documents" against a corpus of nine — found by the owner
    // writing a map for a game, which is the one test nothing here performs.
    //
    // Neither claim is the shape #331 catches. That check reads sentences that
    // call a version UNRELEASED; this is a stale statement of the CURRENT one,
    // which reads as perfectly confident and is simply out of date.
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
    const llms = readFileSync(join(root, "playground", "llms.txt"), "utf8");

    expect(llms).toContain(`whole v${SPEC_VERSION} language`);
    // And no OTHER version of the language is claimed anywhere in it.
    const others = [...llms.matchAll(/whole v(\d+\.\d+) language/g)].map((m) => m[1]);
    expect(others).toEqual([SPEC_VERSION]);

    // The corpus count, checked against the corpus rather than described —
    // the way #278 checks the playground picker rather than trusting it.
    const maps = readdirSync(join(root, "examples"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => existsSync(join(root, "examples", e.name, `${e.name}.cd`)));
    const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    expect(llms, `the corpus has ${maps.length} map documents`)
      .toContain(`${WORDS[maps.length]} complete documents`);
  });

  it("no shipped doc calls a released version unreleased (#331)", () => {
    // The test above checks version TOKENS, which is all `bump` can rewrite:
    // `spec v0.5` → `spec v0.6`. It cannot see a SENTENCE making a version
    // claim, so digest.md's banner — "in-progress spec 0.4 … 0.4.0 has not
    // shipped … carry no `chartdown:` pin" — survived three releases directly
    // beneath a heading the same test was keeping correct. Worst possible file
    // for it: agents read the digest first, and it told them the shipped
    // language was unfinished and that pinning it was wrong.
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
    const CLAIM = /in-progress|has not shipped|not yet shipped|unreleased|on this branch/i;
    const rank = (v: string): number[] => v.split(".").map(Number);
    const shipped = (v: string): boolean => {
      const [a, b] = rank(v);
      const [x, y] = rank(SPEC_VERSION);
      return a! < x! || (a === x && b! <= y!);
    };
    // DERIVED, not hand-kept. This list is what failed in #363: the check was
    // built for exactly that defect and `playground/llms.txt` was not on it, so
    // the site root told every agent the language was v0.2 for five minor
    // versions. A new spec section now joins the sweep by existing.
    for (const rel of shippedDocs(root)) {
      const prose = readFileSync(join(root, rel), "utf8").split(/\n|(?<=[.!?])\s+/);
      for (const sentence of prose.filter((s) => CLAIM.test(s))) {
        for (const [, v] of sentence.matchAll(/\b(\d+\.\d+(?:\.\d+)?)\b/g)) {
          // A claim about a FUTURE version is fine — that is a roadmap note.
          expect(shipped(v!), `${rel} calls shipped ${v} unshipped: ${sentence.trim()}`).toBe(false);
        }
      }
    }
  });

  it("every known header key is defined in the digest's Header keys list (#99)", () => {
    // Agents learn the language from the digest — a key the parser accepts
    // but the digest never names is invisible to them (user-caught: map:).
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
    const digest = readFileSync(join(root, "docs", "spec", "digest.md"), "utf8");
    const keysLine = digest.split("\n").find((l) => l.startsWith("Header keys:"));
    expect(keysLine).toBeDefined();
    for (const key of KNOWN_HEADER_KEYS) {
      expect(keysLine, `header key '${key}:' missing from the digest`).toContain(`\`${key}:`);
    }
  });

  it("parses a minimal document without errors", () => {
    const { document, diagnostics } = parse("map: battlemap\ngrid: square 4x4\n[features]\ncampfire : B2 light=30ft\n");
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(document.mapType).toBe("battlemap");
    expect(document.grid).toEqual({ kind: "square", cols: 4, rows: 4 });
  });

  it("derives docId from the title, overridable by id:", () => {
    const a = parse("# Ambush at Redford Crossing\nmap: battlemap\n");
    expect(a.document.docId).toBe("ambush-at-redford-crossing");
    const b = parse("# Whatever\nmap: battlemap\nid: my-map\n");
    expect(b.document.docId).toBe("my-map");
  });
});

describe("archetype inference (spec 04 §3)", () => {
  const errorsOf = (src: string) => parse(src).diagnostics.filter((d) => d.severity === "error");
  const firstEntity = (src: string) => {
    const { document } = parse(src);
    for (const section of document.sections) {
      const entity = section.entries.find((e) => e.kind === "entity");
      if (entity?.kind === "entity") return entity;
    }
    throw new Error("no entity");
  };

  it("unknown words never fail", () => {
    expect(errorsOf("map: region\nextent: 10x10mi\n[features]\nzorbleflax : (8,7)\n")).toEqual([]);
  });

  it("infers terrain from area/blob shapes", () => {
    const e = firstEntity("map: region\nextent: 10x10mi\n[features]\nglombus : blob (4,3) size=2mi\n");
    expect(e.archetype).toBe("terrain");
    expect(e.archetypeSource).toBe("inferred-shape");
  });

  it("infers path from from…to", () => {
    const e = firstEntity("map: region\nextent: 10x10mi\n[features]\nsludgeway : from (1,1) to (9,9)\n");
    expect(e.archetype).toBe("path");
  });

  it("a lone point infers feature only when the section carries no archetype", () => {
    const gm = firstEntity('map: region\nextent: 10x10mi\n[gm]\nzorbleflax : (8,7) "a mystery"\n');
    expect(gm.archetype).toBe("feature");
  });

  it("section context outranks the lone-cell rule — a solo creature in [tokens] is a token", () => {
    const e = firstEntity("map: battlemap\ngrid: square 20x15\n[tokens]\nogre \"Gruk\" : G9 size=2\n");
    expect(e.archetype).toBe("token");
    expect(e.archetypeSource).toBe("inferred-section");
  });

  it("a bare range falls through to section context — staging zones stay tokens", () => {
    const e = firstEntity("map: battlemap\ngrid: square 20x15\n[tokens]\nparty start : J14..L15\n");
    expect(e.archetype).toBe("token");
    expect(e.archetypeSource).toBe("inferred-section");
  });

  it("vocabulary derivation resolves through the chain", () => {
    const e = firstEntity("map: region\nextent: 10x10mi\n[vocab]\nlicorice-forest : forest\n[terrain]\nlicorice-forest : blob (4,4) size=1mi\n");
    expect(e.archetype).toBe("terrain");
    expect(e.archetypeSource).toBe("vocab");
  });

  it("document vocab shadows the standard library", () => {
    const e = firstEntity("map: battlemap\ngrid: square 4x4\n[vocab]\nwagon : zone\n[features]\nwagon : A1..B2\n");
    expect(e.archetype).toBe("zone");
  });
});
