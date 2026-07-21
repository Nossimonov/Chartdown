/**
 * Minimal happy-dom stand-ins for Obsidian's DOM helpers (createEl, empty),
 * loaded via vitest setupFiles. The plugin uses the Obsidian idiom (per
 * obsidianmd/prefer-create-el); tests get just enough of it to run. Guarded:
 * node-environment suites have no HTMLElement and skip the shim entirely.
 */

interface CreateElOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean>;
}

if (typeof HTMLElement !== "undefined") {
  // Loose cast: obsidian's typings already declare createEl globally with a
  // richer signature; the runtime here is happy-dom, which has neither.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["createEl"] ??= function (this: HTMLElement, tag: string, o?: CreateElOptions): HTMLElement {
    const el = this.ownerDocument.createElement(tag);
    if (o?.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
    if (o?.text) el.textContent = o.text;
    if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
    this.appendChild(el);
    return el;
  };
  proto["empty"] ??= function (this: HTMLElement): void {
    this.replaceChildren();
  };
}

export {};
