/**
 * The share-link contract, exercised against the documentation (#97).
 *
 * An agent that authors a map has no sanctioned way to show its user the
 * result: the playground's fragment URL carries a whole document with no
 * server, no storage and no account, but nothing told an agent it existed or
 * how to build one. `docs/spec/digest.md` now specifies it.
 *
 * A specification of an encoding is worth exactly as much as its agreement
 * with the encoder. So this file does not restate the algorithm — it EXTRACTS
 * THE REFERENCE ENCODER FROM THE DIGEST, runs it, and requires it to agree
 * byte-for-byte with the function the playground itself calls. Documentation
 * and implementation cannot drift apart without this failing, which is the
 * guarantee #97 asked for.
 *
 * That also caught a real difference while this was written: the first draft
 * of the documented encoder used `String.fromCharCode(...bytes)`, which the
 * running code deliberately avoids because a spread of thousands of arguments
 * overflows the call stack on a large map.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeShare, encodeShare, PLAYGROUND_URL, shareUrl } from "./share";

/** The fenced `js` block under "Reference encoder" in the digest. */
function documentedEncoder(): (src: string, opts?: Record<string, string>) => Promise<string> {
  const digest = readFileSync("docs/spec/digest.md", "utf8");
  const after = digest.slice(digest.indexOf("Reference encoder"));
  const block = /```js\n([\s\S]*?)```/.exec(after);
  if (!block) throw new Error("no fenced js block follows 'Reference encoder' in digest.md");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${block[1]}\nreturn shareLink;`)() as ReturnType<typeof documentedEncoder>;
}

const SOURCE = readFileSync("examples/vessany/vessany.cd", "utf8");

describe("the digest documents the encoder the playground runs", () => {
  it("the snippet is extractable and runs", () => {
    // Calibration: every assertion below is worthless if this silently yields
    // nothing, so the instrument is checked before it is trusted.
    expect(typeof documentedEncoder()).toBe("function");
  });

  it("produces byte-identical payloads for a real corpus map", async () => {
    const link = await documentedEncoder()(SOURCE);
    const documented = new URLSearchParams(link.slice(link.indexOf("#") + 1)).get("s");
    expect(documented).toBe(await encodeShare(SOURCE));
  });

  it("and for the awkward inputs an encoding gets wrong", async () => {
    for (const text of ["", "a", "# Tildes ~~~\n\n; a comment", "é 漢字 🗺️", "x".repeat(50_000)]) {
      const link = await documentedEncoder()(text);
      const documented = new URLSearchParams(link.slice(link.indexOf("#") + 1)).get("s");
      expect(documented, JSON.stringify(text.slice(0, 20))).toBe(await encodeShare(text));
    }
  });

  it("names the production base URL the code uses", async () => {
    expect(await documentedEncoder()("x")).toContain(PLAYGROUND_URL);
  });
});

describe("the payload round-trips", () => {
  it("a real corpus map comes back byte-identical", async () => {
    expect(await decodeShare(await encodeShare(SOURCE))).toBe(SOURCE);
  });

  it("through the documented decode steps, written out", async () => {
    // The digest tells a reader to invert it: `-`→`+`, `_`→`/`, base64-decode,
    // DecompressionStream. Padding is not required. This is that, literally.
    const payload = await encodeShare(SOURCE);
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    expect(await new Response(stream).text()).toBe(SOURCE);
  });

  it("and the payload is URL-safe — no +, / or = to be mangled in transit", async () => {
    expect(await encodeShare(SOURCE)).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("a truncated payload throws rather than decoding to something else", async () => {
    // What #389 is about: a clipped link must fail, not load a plausible map.
    const payload = await encodeShare(SOURCE);
    await expect(decodeShare(payload.slice(0, payload.length - 40))).rejects.toThrow();
  });
});

describe("the link the digest describes", () => {
  it("defaults to player — a gm link shows every secret", async () => {
    // Fail-closed (spec 01 §6). The digest says so because the consequence of
    // the wrong default is handing players the GM's map.
    expect(shareUrl(await encodeShare(SOURCE))).toContain("m=player");
  });

  it("carries mode and theme where the playground reads them", async () => {
    const url = shareUrl(await encodeShare(SOURCE), { mode: "gm", theme: "vellum" });
    const params = new URLSearchParams(url.slice(url.indexOf("#") + 1));
    expect(params.get("m")).toBe("gm");
    expect(params.get("t")).toBe("vellum");
    expect(url.slice(0, url.indexOf("#"))).toBe(PLAYGROUND_URL);
  });

  it("keeps the payload in the FRAGMENT, so it never reaches the host", async () => {
    // The property that makes this safe to hand an agent.
    const url = shareUrl(await encodeShare(SOURCE));
    expect(url.slice(0, url.indexOf("#"))).not.toContain("s=");
  });
});
