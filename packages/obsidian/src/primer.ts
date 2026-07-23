/**
 * The AI authoring primer (#88): one clipboard-load that turns any LLM chat
 * into a Chartdown co-author. Instructions + the complete spec digest —
 * optionally carrying the current map source, for revising an existing map
 * rather than writing one from scratch.
 */

import digest from "../../../docs/spec/digest.md";

const HEAD = [
  "You are co-writing a Chartdown map with me. Chartdown is a plain-text,",
  "Markdown-inspired language for TTRPG maps (battlemaps, hexcrawls, region",
  "maps); my notes app renders it in place. The complete language reference",
  "follows. Reply with ONE ```chartdown fenced code block and keep any prose",
  "outside it brief. Keep my names and flavor text; prefer source a human",
  "can read back unrendered.",
].join("\n");

export function authoringPrimer(currentSource?: string): string {
  const task = currentSource
    ? "My current map source is below. I'll describe the changes I want — revise it and reply with the full updated document.\n\n```chartdown\n" +
      currentSource +
      (currentSource.endsWith("\n") ? "" : "\n") +
      "```"
    : "I'll describe the scene I want — write the map.";
  return `${HEAD}\n\n---\n\n${digest}\n\n---\n\n${task}\n`;
}
