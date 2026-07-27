/**
 * Turning pixels into miles, and refusing to when the landmarks cannot say.
 *
 * #181 records the failure this exists to prevent: a first georeference 15%
 * wrong, from a longitude baseline of 0.09° between two landmarks, with
 * nothing warning. The proposal's own remedy — "report the residual" — would
 * NOT have caught it, and that is worth stating plainly: two landmarks and a
 * similarity transform have four degrees of freedom fitted to four numbers, so
 * the residual is exactly zero for ANY two points, however badly chosen. A
 * clean residual on two landmarks is arithmetic, not evidence.
 *
 * What actually goes wrong is CONDITIONING. Landmarks close together relative
 * to the image multiply every pixel-picking error by the ratio of the image to
 * the baseline; a baseline a tenth of the frame turns a two-pixel misclick into
 * a twenty-pixel error at the far edge. So both are checked, and the one that
 * catches the reported failure is the baseline.
 */

export class GeorefError extends Error {}

/** A point identified in both frames: where it is in the image, and on Earth. */
export interface Landmark {
  px: number;
  py: number;
  lat: number;
  lon: number;
}

export interface XY { x: number; y: number }

export interface Georef {
  /** Image pixel to document coordinates, in miles from the map's NW corner. */
  toMap(px: number, py: number): XY;
  /** The document extent the image covers, in miles. */
  extent: { width: number; height: number };
  milesPerPixel: number;
  /** Rotation from north-up, in degrees. */
  rotationDegrees: number;
  /** RMS fit error in miles. Meaningless below three landmarks — see above. */
  residualMiles: number;
  /** Longest landmark separation as a fraction of the image diagonal. */
  baseline: number;
}

/** Mean Earth radius: one degree of latitude, in miles. */
const MILES_PER_DEGREE = 69.09;

/**
 * Shortest baseline worth trusting, as a fraction of the image diagonal.
 *
 * Not a round number for its own sake: at a quarter of the frame, a landmark
 * placed two pixels off skews a corner by eight, which is under a pixel of map
 * error at any scale this tool is used at. Below it the amplification grows
 * without bound, and the reported case sat near a tenth.
 */
const MIN_BASELINE = 0.25;

/** Fit error worth refusing, as a fraction of the image diagonal. */
const MAX_RESIDUAL = 0.01;

/**
 * Local planar coordinates about a reference latitude, in miles, y southward.
 *
 * Equirectangular, which is exact enough over one map and wrong in exactly the
 * way the reported failure was: a degree of longitude is shorter than a degree
 * of latitude by `cos(lat)`, and at Puget Sound's 47.6° that factor is 0.67.
 * Treating the two as interchangeable is a 33% error in one axis.
 */
const project = (lat: number, lon: number, lat0: number, lon0: number): XY => ({
  x: (lon - lon0) * Math.cos((lat0 * Math.PI) / 180) * MILES_PER_DEGREE,
  y: -(lat - lat0) * MILES_PER_DEGREE,
});

export function fitGeoref(marks: Landmark[], image: { width: number; height: number }): Georef {
  if (marks.length < 2) {
    throw new GeorefError("a georeference needs at least two landmarks — give a third to make the fit checkable, since two always fit exactly");
  }
  const lat0 = marks.reduce((t, m) => t + m.lat, 0) / marks.length;
  const lon0 = marks.reduce((t, m) => t + m.lon, 0) / marks.length;
  const world = marks.map((m) => project(m.lat, m.lon, lat0, lon0));

  const diagonal = Math.hypot(image.width, image.height);
  let longest = 0;
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      longest = Math.max(longest, Math.hypot(marks[i]!.px - marks[j]!.px, marks[i]!.py - marks[j]!.py));
    }
  }
  const baseline = diagonal > 0 ? longest / diagonal : 0;
  if (baseline < MIN_BASELINE) {
    throw new GeorefError(
      `the landmarks span only ${(baseline * 100).toFixed(0)}% of the image, which cannot fix its scale: every error in picking them is multiplied by ${(1 / Math.max(baseline, 1e-6)).toFixed(0)}x at the far edge. Pick landmarks at least ${(MIN_BASELINE * 100).toFixed(0)}% apart — opposite corners of the area you are mapping`,
    );
  }

  // Least-squares similarity: pixels to miles, isotropic by construction, so
  // the fit cannot absorb a bad landmark as a stretched axis.
  const mean = (get: (i: number) => number): number => marks.reduce((t, _, i) => t + get(i), 0) / marks.length;
  const pcx = mean((i) => marks[i]!.px);
  const pcy = mean((i) => marks[i]!.py);
  const wcx = mean((i) => world[i]!.x);
  const wcy = mean((i) => world[i]!.y);
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let i = 0; i < marks.length; i++) {
    const ax = marks[i]!.px - pcx;
    const ay = marks[i]!.py - pcy;
    const bx = world[i]!.x - wcx;
    const by = world[i]!.y - wcy;
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
    norm += ax * ax + ay * ay;
  }
  if (!(norm > 0)) throw new GeorefError("every landmark sits on the same pixel — they cannot fix a scale");
  const scale = Math.hypot(dot, cross) / norm;
  const theta = Math.atan2(cross, dot);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const toWorld = (px: number, py: number): XY => {
    const ax = px - pcx;
    const ay = py - pcy;
    return { x: wcx + scale * (ax * cos - ay * sin), y: wcy + scale * (ax * sin + ay * cos) };
  };

  let sum = 0;
  for (let i = 0; i < marks.length; i++) {
    const got = toWorld(marks[i]!.px, marks[i]!.py);
    sum += (got.x - world[i]!.x) ** 2 + (got.y - world[i]!.y) ** 2;
  }
  const residualMiles = Math.sqrt(sum / marks.length);
  const milesPerPixel = scale;
  const tolerance = MAX_RESIDUAL * diagonal * milesPerPixel;
  if (marks.length >= 3 && residualMiles > tolerance) {
    throw new GeorefError(
      `the landmarks disagree: fitting them leaves ${residualMiles.toFixed(2)}mi of error, beyond the ${tolerance.toFixed(2)}mi this image can carry. One of them is misplaced, or one pair of coordinates belongs to a different point`,
    );
  }

  // The document's frame is the IMAGE's, so (0,0) is its north-west corner and
  // the extent is what the picture covers. Taken from the transformed corners
  // rather than from width x scale, so a rotated image still yields the box the
  // map actually occupies.
  const corners = [toWorld(0, 0), toWorld(image.width, 0), toWorld(0, image.height), toWorld(image.width, image.height)];
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const extent = {
    width: Math.max(...corners.map((c) => c.x)) - minX,
    height: Math.max(...corners.map((c) => c.y)) - minY,
  };

  return {
    toMap: (px, py) => {
      const at = toWorld(px, py);
      return { x: at.x - minX, y: at.y - minY };
    },
    extent,
    milesPerPixel,
    rotationDegrees: (theta * 180) / Math.PI,
    residualMiles,
    baseline,
  };
}

/** Parse `x,y=lat,lon` as written on the command line. */
export function parseLandmark(text: string): Landmark {
  const m = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*=\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(text);
  if (!m) throw new GeorefError(`landmark '${text}' is not in the form <pixelX>,<pixelY>=<lat>,<lon>`);
  const [px, py, lat, lon] = m.slice(1).map(Number) as [number, number, number, number];
  if (Math.abs(lat) > 90) throw new GeorefError(`landmark '${text}' has a latitude outside -90..90 — are the coordinates the other way round?`);
  if (Math.abs(lon) > 180) throw new GeorefError(`landmark '${text}' has a longitude outside -180..180`);
  return { px, py, lat, lon };
}
