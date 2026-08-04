/**
 * Vault-side resolution of the files a document references (#246).
 *
 * The parser never touches a filesystem — it takes other documents' sources
 * through `libraries` and `documents`, and *"the caller resolves paths"*. The
 * CLI is that caller for a disk; this is that caller for a vault. Without it a
 * `.cd` file beside a shared `ink-and-vellum.theme.cd` rendered unthemed and
 * with no vocabulary, which is the arrangement `examples/` itself uses and the
 * one #237 invites by making `.cd` files openable.
 *
 * Reading a vault is asynchronous where rendering is not, so this is separated
 * from the render: a caller awaits it, then mounts. A path that does not
 * resolve is simply absent, which leaves the parser's own
 * "library … not provided" warning to say so — now that the plugin shows
 * warnings at all (#245).
 */

import { parse } from "@chartdown/core";

/** The vault operations this needs, injected so the module tests without Obsidian. */
export interface VaultReader {
  /** Resolve a path relative to `folder`, returning its text, or null if absent. */
  read(folder: string, relativePath: string): Promise<string | null>;
}

export interface ResolvedImports {
  libraries: Record<string, string>;
  documents: Record<string, string>;
}

/** Normalise `folder` + `./sibling.cd` the way a vault path reads: no leading `./`, no `..` left. */
export function resolveVaultPath(folder: string, relative: string): string {
  const parts = (folder + relative).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") { out.pop(); continue; }
    out.push(part);
  }
  return out.join("/");
}

/**
 * Every file `source` references, read from the vault.
 *
 * Discovery is a parse, exactly as the CLI does it, rather than a regular
 * expression over the text: `use:` is a header and the parser is what knows
 * what a header is.
 */
export async function resolveImports(source: string, folder: string, vault: VaultReader): Promise<ResolvedImports> {
  const libraries: Record<string, string> = {};
  const documents: Record<string, string> = {};
  let headers;
  try {
    headers = parse(source).document.header;
  } catch {
    return { libraries, documents }; // an unparseable document has its own errors to report
  }
  for (const header of headers) {
    if (header.key === "use") {
      const text = await vault.read(folder, header.value);
      if (text !== null) libraries[header.value] = text;
      continue;
    }
    if (header.key === "inset") {
      // `inset: <doc> at <entity>` — the path is everything before ` at `.
      const path = header.value.split(/\s+at\s+/)[0]?.trim();
      if (!path) continue;
      const text = await vault.read(folder, path);
      if (text !== null) documents[path] = text;
    }
  }
  return { libraries, documents };
}
