/**
 * The serverless share link: a whole document carried in a URL fragment (#97).
 *
 *     https://nossimonov.github.io/Chartdown/#s=<payload>&m=<mode>&t=<theme>
 *
 * The map travels in the link itself — no server, no storage, no account — and
 * because the payload sits in the FRAGMENT it is never sent to the host: a
 * shared map is not uploaded anywhere by being shared.
 *
 * Extracted from `playground.ts` so the documented contract and the running
 * code are the same code. `docs/spec/digest.md` specifies this encoding for
 * agents, and `share.test.ts` round-trips it against these functions — so the
 * documentation cannot drift from the playground without a test failing, which
 * is the guarantee #97 asked for.
 */

/** Document → fragment payload: UTF-8, `deflate-raw`, base64url, `=` stripped. */
export async function encodeShare(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Fragment payload → document. Throws on anything that is not one. */
export async function decodeShare(encoded: string): Promise<string> {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** The production playground — the base an agent should build links against. */
export const PLAYGROUND_URL = "https://nossimonov.github.io/Chartdown/";

/**
 * Build a share link for a document.
 *
 * `mode` is written verbatim; only the exact string `gm` selects GM mode, so
 * anything else — including an absent `m` — renders the player sheet, which is
 * the fail-closed default (spec 01 §6).
 *
 * `theme` is honoured only for a theme the playground ships (`candyworld`,
 * `vellum`); `default` needs no parameter.
 */
export function shareUrl(
  encoded: string,
  opts: { mode?: "player" | "gm"; theme?: string; base?: string } = {},
): string {
  const params = new URLSearchParams({ m: opts.mode ?? "player", t: opts.theme ?? "default" });
  return `${opts.base ?? PLAYGROUND_URL}#s=${encoded}&${params}`;
}
