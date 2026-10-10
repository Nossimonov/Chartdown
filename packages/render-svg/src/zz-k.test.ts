import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { renderSource } from "./index";
const HEAD = ["# P","map: battlemap","chartdown: 0.1","grid: square 20x15","scale: 5ft"];
// two intersections: road dips across the river twice
const doc = (line: string) => [...HEAD,"","[terrain]",
  'river redford "R" : path A9 T9 width=2','road tollroad "T" : path C1 C12 H12 H1', line].join("\n");
it("k", () => {
  const out: string[] = [];
  for (const line of [
    'ford f1 "F" : on redford on tollroad',
    'ford f1 "F" : on redford on tollroad at C9',
  ]) {
    const errs = renderSource(doc(line),{mode:"gm"}).diagnostics.filter(d=>d.severity==="error").map(d=>d.message.slice(0,90));
    out.push(`  ${line.slice(14).padEnd(42)} errors=${errs.length} ${errs.join(" | ")}`);
  }
  writeFileSync("k.txt", out.join("\n"));
  expect(1).toBe(1);
});
