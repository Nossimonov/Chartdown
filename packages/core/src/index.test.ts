import { describe, expect, it } from "vitest";
import { SPEC_VERSION, parse } from "./index";

describe("skeleton", () => {
  it("targets spec draft 0.1", () => {
    expect(SPEC_VERSION).toBe("0.1");
  });

  it("parse fails loudly until #21 lands", () => {
    expect(() => parse("map: battlemap")).toThrow(/not yet implemented/);
  });
});
