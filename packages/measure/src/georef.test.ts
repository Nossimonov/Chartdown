import { describe, expect, it } from "vitest";
import { fitGeoref, GeorefError, parseLandmark, type Landmark } from "./georef";

const IMAGE = { width: 1000, height: 1000 };

/** Puget Sound's latitude, where a degree of longitude is 0.67 of a degree of latitude. */
const LAT = 47.6;
const MPD = 69.09;

/** Landmarks generated from a known scale, so the fit has a right answer. */
const synthetic = (milesPerPixel: number, pairs: [number, number][]): Landmark[] =>
  pairs.map(([px, py]) => ({
    px,
    py,
    lat: LAT - (py * milesPerPixel) / MPD,
    lon: -122 + (px * milesPerPixel) / (MPD * Math.cos((LAT * Math.PI) / 180)),
  }));

describe("fitting a georeference", () => {
  // Equirectangular projection scales longitude by the cosine of ONE reference
  // latitude, so it is exact only there. Over a 50mi map at 47.6° the factor
  // drifts about 0.9% edge to edge, which lands as roughly a quarter of a
  // percent of scale — an eighth of a mile over fifty. That is the model's
  // accuracy, not a defect, and these bounds state it rather than pretending
  // to more.
  const WITHIN = 0.005;

  it("recovers the scale it was built from", () => {
    const fit = fitGeoref(synthetic(0.05, [[100, 100], [900, 900], [900, 100]]), IMAGE);
    expect(Math.abs(fit.milesPerPixel - 0.05) / 0.05).toBeLessThan(WITHIN);
    expect(Math.abs(fit.extent.width - 50) / 50).toBeLessThan(WITHIN);
    expect(Math.abs(fit.extent.height - 50) / 50).toBeLessThan(WITHIN);
    // North-up to well under a pixel of skew across the frame. Not zero: the
    // reference latitude the fit picks is the landmarks' mean, which differs
    // from the one they were generated about, and that lands as a fraction of
    // a degree of apparent rotation.
    expect(Math.abs(fit.rotationDegrees)).toBeLessThan(0.5);
  });

  it("puts the map's origin at the image's north-west corner", () => {
    const fit = fitGeoref(synthetic(0.05, [[100, 100], [900, 900], [900, 100]]), IMAGE);
    const nw = fit.toMap(0, 0);
    expect(Math.hypot(nw.x, nw.y)).toBeLessThan(0.1);
    // And y runs SOUTHWARD, as document coordinates do.
    expect(fit.toMap(0, 1000).y).toBeGreaterThan(0);
  });

  it("does not confuse a degree of longitude with a degree of latitude", () => {
    // The reported 15% error came from treating them alike. At this latitude
    // the factor is cos(47.6) = 0.674, so a fit that ignored it would put the
    // east-west extent out by a third.
    const fit = fitGeoref(synthetic(0.05, [[0, 0], [1000, 0], [0, 1000]]), IMAGE);
    expect(fit.extent.width / fit.extent.height).toBeCloseTo(1, 2);
  });
});

describe("a georeference that cannot be trusted is refused (#181)", () => {
  it("refuses landmarks too close together — which a residual cannot catch", () => {
    // Two points fit a similarity EXACTLY, so the residual here is zero no
    // matter how badly chosen they are. This is the check that catches the
    // failure #181 actually hit.
    const cramped = synthetic(0.05, [[480, 480], [520, 520]]);
    expect(() => fitGeoref(cramped, IMAGE)).toThrow(GeorefError);
    expect(() => fitGeoref(cramped, IMAGE)).toThrow(/span only \d+% of the image/);
    expect(() => fitGeoref(cramped, IMAGE)).toThrow(/multiplied by/);
  });

  it("accepts a well-spread pair, and says the residual proves nothing", () => {
    const fit = fitGeoref(synthetic(0.05, [[50, 50], [950, 950]]), IMAGE);
    expect(fit.baseline).toBeGreaterThan(0.25);
    expect(fit.residualMiles).toBeCloseTo(0, 6);
  });

  it("refuses landmarks that disagree with each other", () => {
    const marks = synthetic(0.05, [[100, 100], [900, 900], [900, 100]]);
    marks[2]!.lat += 0.5; // ~35mi out
    expect(() => fitGeoref(marks, IMAGE)).toThrow(/landmarks disagree/);
  });

  it("needs at least two", () => {
    expect(() => fitGeoref(synthetic(0.05, [[100, 100]]), IMAGE)).toThrow(/at least two landmarks/);
  });
});

describe("reading a landmark off the command line", () => {
  it("parses the documented form", () => {
    expect(parseLandmark("120,340=47.6,-122.33")).toEqual({ px: 120, py: 340, lat: 47.6, lon: -122.33 });
  });

  it("catches coordinates given the wrong way round", () => {
    expect(() => parseLandmark("10,10=-122.33,47.6")).toThrow(/other way round/);
  });

  it("rejects a shape it does not understand rather than guessing", () => {
    expect(() => parseLandmark("47.6,-122.33")).toThrow(/not in the form/);
  });
});

describe("map coordinates convert back to pixels (#193)", () => {
  // Everything the tool prints is in map miles while the mouth and the inward
  // point were pixels-only, so refining a mouth against a rendered map meant
  // converting by hand in both directions — the class of error a measuring
  // instrument should absorb rather than create.
  const marks = [
    "1146,2052=47.2690,-122.5517",
    "1046,478=48.4061,-122.6433",
    "202,838=48.1490,-123.5670",
  ].map(parseLandmark);

  it("is an exact inverse, not an approximation", () => {
    // The fit is a similarity, so it inverts exactly. Checked at the corners
    // and the middle, because a rotation error only shows away from the centre.
    const fit = fitGeoref(marks, { width: 1957, height: 2696 });
    for (const [px, py] of [[0, 0], [1957, 0], [0, 2696], [1957, 2696], [1059, 1143], [842, 1850]] as const) {
      const m = fit.toMap(px, py);
      const back = fit.toPixel(m.x, m.y);
      expect(back.x, `${px},${py}`).toBeCloseTo(px, 6);
      expect(back.y, `${px},${py}`).toBeCloseTo(py, 6);
    }
  });

  it("inverts a ROTATED fit too", () => {
    // Where the two frames differ only by scale a wrong rotation is invisible,
    // and every other landmark set in this suite is square to north. Built by
    // taking a known rotation and scale and running the projection BACKWARDS,
    // so the three are a similarity by construction — landmarks invented by
    // hand are not, and the fit rightly refuses them.
    const MILES_PER_DEGREE = 69.09;
    const lat0 = 47.6;
    const lon0 = -122.6;
    const theta = (18 * Math.PI) / 180;
    const scale = 0.05;
    const turned = [[100, 100], [900, 500], [500, 900]].map(([px, py]) => {
      const ax = px! - 500;
      const ay = py! - 500;
      const wx = scale * (ax * Math.cos(theta) - ay * Math.sin(theta));
      const wy = scale * (ax * Math.sin(theta) + ay * Math.cos(theta));
      return {
        px: px!,
        py: py!,
        lat: lat0 - wy / MILES_PER_DEGREE,
        lon: lon0 + wx / (Math.cos((lat0 * Math.PI) / 180) * MILES_PER_DEGREE),
      };
    });
    const fit = fitGeoref(turned, { width: 1000, height: 1000 });
    expect(Math.abs(fit.rotationDegrees)).toBeGreaterThan(1);
    for (const [px, py] of [[0, 0], [1000, 1000], [250, 750]] as const) {
      const m = fit.toMap(px, py);
      const back = fit.toPixel(m.x, m.y);
      expect(back.x, `${px},${py}`).toBeCloseTo(px, 6);
      expect(back.y, `${px},${py}`).toBeCloseTo(py, 6);
    }
  });
});
