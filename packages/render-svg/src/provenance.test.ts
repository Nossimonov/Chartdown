import { parseXml } from "@rgrove/parse-xml";
import { describe, expect, it } from "vitest";
import { renderSource } from "./index";
import { readProvenance, stampProvenance, type Provenance } from "./provenance";

const MAP = ["map: battlemap", "grid: square 4x4", "[features]", "campfire : B2"].join("\n");

describe("provenance marker (#78)", () => {
  const p: Provenance = { source: "maps/camp.cd", docId: "camp", mode: "gm", output: "maps/camp-gm.svg" };

  it("stamp → read round-trips, including XML-hostile path characters", () => {
    const hostile: Provenance = { source: "maps/b&b <keep>.cd", docId: "b-b-keep", mode: "player", output: "maps/b&b <keep>.svg" };
    for (const prov of [p, hostile]) {
      const stamped = stampProvenance(renderSource(MAP).svg, prov);
      expect(readProvenance(stamped)).toEqual(prov);
      expect(() => parseXml(stamped)).not.toThrow();
    }
  });

  it("stamping is pure and idempotent — no timestamps, re-stamp replaces rather than doubles", () => {
    const svg = renderSource(MAP).svg;
    const once = stampProvenance(svg, p);
    expect(stampProvenance(svg, p)).toBe(once);
    const restamped = stampProvenance(once, { ...p, mode: "player", output: "maps/camp.svg" });
    expect(restamped.match(/<metadata data-chartdown-source/g)).toHaveLength(1);
    expect(readProvenance(restamped)?.mode).toBe("player");
  });

  it("an unstamped render carries no provenance", () => {
    expect(readProvenance(renderSource(MAP).svg)).toBeNull();
  });
});
