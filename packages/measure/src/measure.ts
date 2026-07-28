/**
 * `chartdown-measure` — derive Chartdown declarations from imagery.
 *
 * Its own binary rather than a verb on `chartdown` (ADR 0028), so a GM who
 * never measures anything installs nothing extra.
 *
 * There is deliberately NO command that emits a coastline. ADR 0028 makes that
 * a constraint rather than advice, because the failure has already happened:
 * #181's first pass produced a 2137-vertex traced polygon with no Hood Canal
 * in it and nothing that could take an id, a `gm=` note or a `detail=` sub-map
 * — a picture of Puget Sound rather than a map of one, and precisely the wall
 * of coordinates ADR 0023 exists to eliminate. This tool measures FEATURES.
 */

import { readFileSync } from "node:fs";
import { decodePng, ImageError } from "./png";
import { fitGeoref, GeorefError, parseLandmark, parseOrigin, type Georef, type Landmark, type Origin, type XY } from "./georef";
import { classifyWater, closeGaps, largestBody, type IndexName } from "./raster";
import { easeBends, measureFeature, MeasureError, simplify, tightestBend, withMouthLead } from "./feature";
import { CoastError, measureCoast } from "./coast";

const USAGE = `chartdown-measure — derive Chartdown declarations from imagery

usage: chartdown-measure inspect <image.png> [options]
       chartdown-measure feature <image.png> --mouth <point> --into <point> [options]
       chartdown-measure coast <image.png> --from <point> --to <point> [options]
       chartdown-measure --help

  inspect   report what the tool sees: the classification it chose, and the
            georeference it fitted. Run this first — a bad water threshold or
            a bad georeference is visible here and invisible afterwards.

  feature   measure one inlet and print its declaration. Which water is "this
            inlet" and where its mouth lies are yours to say: no picture of
            Puget Sound contains a line marking where Hood Canal begins.

  coast     trace a coastline with the inlets you intend to DECLARE removed.
            A traced shore already contains every inlet — simplification keeps
            a deep narrow one however coarse the tolerance — so declaring a
            feature on it would draw that feature twice. This emits the spine.

coast options:
  --from <point>      where the coastline starts
  --to <point>        where it ends. A ring has two arcs between them; the
                      longer is taken and both lengths are reported.
  --through <point>   a point the coast passes, where the longer is not the one
  --fill <miles>      close the land by this much first, so every inlet
                      narrower than TWICE it fills in and is left for its own
                      declaration (2). Which water is a feature and which is
                      the coast is your call, as --mouth is.
  --tolerance <miles> thin the traced staircase to controls a person would
                      write (0.5)

feature options:
  --mouth <x>,<y>     a point in the channel AT ITS MOUTH, between the headlands
  --into <x>,<y>      a point well inside the inlet, past the mouth
                      Both take IMAGE PIXELS bare — 1059,1143 — or MAP MILES
                      written as Chartdown writes a point, (53.7,57.5), or with
                      the unit, 53.7,57.5mi. Map form needs a --georef first.
  --word <word>       the vocabulary word to declare it as (default: sound)
  --name <text>       its display name
  --id <word>         its id

options:
  --georef <px>,<py>=<lat>,<lon>   a landmark; repeat it. Two at minimum, three
                                   to make the fit checkable. Spread them wide:
                                   landmarks close together cannot fix a scale.
  --index luma|blue                what makes a pixel wet. luma (default) suits
                                   satellite imagery and hand-drawn masks alike;
                                   blue separates water from shaded forest.
  --invert                         water is the LIGHTER side of the cut.
  --close <pixels>                 close breaks up to this wide before labelling,
                                   so a narrow passage is not pinched shut (2).
  --origin <lat>,<lon>             the DOCUMENT's extent origin — its north-west
                                   corner. Without it, coordinates come out
                                   relative to the IMAGE's top-left corner, which
                                   an existing map will not share: pasted in, the
                                   feature lands wherever the two frames differ.

PNG only, by design — see ADR 0029.`;

interface Options {
  image: string;
  landmarks: Landmark[];
  index: IndexName;
  invert: boolean;
  close: number;
  origin?: Origin;
  mouth?: Given;
  into?: Given;
  from?: Given;
  to?: Given;
  through?: Given;
  fill: number;
  tolerance: number;
  word: string;
  name?: string;
  id?: string;
}

/** A point the author gave, in whichever frame they gave it in. */
interface Given extends XY {
  /** True where it was written in MAP coordinates rather than image pixels. */
  map: boolean;
}

/**
 * A point on the command line, in pixels or in map miles.
 *
 * Everything this tool PRINTS is in map miles, while the mouth and the inward
 * point were pixels-only — so refining a mouth against a rendered map meant
 * converting by hand, both ways, which is the class of error a measuring
 * instrument should be absorbing rather than creating (#193).
 *
 * Map coordinates are marked the way Chartdown itself marks them: parenthesised
 * as a point, `(53.7,57.5)`, so a coordinate can be pasted straight back out of
 * a declaration — or with the unit, `53.7,57.5mi`, which needs no quoting in a
 * shell. Bare numbers stay pixels, so every invocation already written keeps
 * working and keeps meaning what it meant.
 */
function parsePoint(text: string | undefined, flag: string): Given {
  const s = (text ?? "").trim();
  const paren = /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*([a-zA-Z]*)$/.exec(s);
  const bare = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*([a-zA-Z]*)$/.exec(s);
  const m = paren ?? bare;
  if (!m) {
    throw new Error(`${flag} needs a point: <x>,<y> in image pixels, or (<x>,<y>) or <x>,<y>mi in map miles`);
  }
  const unit = (m[3] ?? "").toLowerCase();
  if (unit && unit !== "mi") {
    throw new Error(`${flag}: this tool works in miles, so '${unit}' is not a unit it can convert`);
  }
  return { x: Number(m[1]), y: Number(m[2]), map: Boolean(paren) || unit === "mi" };
}

/** Resolve a given point to image pixels, once the georeference is fitted. */
function toPixels(given: Given, fit: Georef): XY {
  return given.map ? fit.toPixel(given.x, given.y) : given;
}

function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command, image, ...rest] = argv;
  if (!command || !image) throw new Error(USAGE);
  const options: Options = { image, landmarks: [], index: "luma", invert: false, close: 2, word: "sound", fill: 2, tolerance: 0.5 };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === "--georef") {
      if (!value) throw new Error("--georef needs a landmark, as <px>,<py>=<lat>,<lon>");
      options.landmarks.push(parseLandmark(value));
      i++;
    } else if (flag === "--index") {
      if (value !== "luma" && value !== "blue") throw new Error("--index takes luma or blue");
      options.index = value;
      i++;
    } else if (flag === "--close") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error("--close takes a number of pixels");
      options.close = Math.round(n);
      i++;
    } else if (flag === "--mouth") {
      options.mouth = parsePoint(value, "--mouth");
      i++;
    } else if (flag === "--into") {
      options.into = parsePoint(value, "--into");
      i++;
    } else if (flag === "--word" || flag === "--name" || flag === "--id") {
      if (!value) throw new Error(`${flag} needs a value`);
      options[flag === "--word" ? "word" : flag === "--name" ? "name" : "id"] = value;
      i++;
    } else if (flag === "--from" || flag === "--to" || flag === "--through") {
      options[flag.slice(2) as "from" | "to" | "through"] = parsePoint(value, flag);
      i++;
    } else if (flag === "--fill" || flag === "--tolerance") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} takes a distance in miles`);
      options[flag === "--fill" ? "fill" : "tolerance"] = n;
      i++;
    } else if (flag === "--origin") {
      if (!value) throw new Error("--origin needs a document extent origin, as <lat>,<lon>");
      options.origin = parseOrigin(value);
      i++;
    } else if (flag === "--invert") {
      options.invert = true;
    } else {
      throw new Error(`unknown option '${flag}'`);
    }
  }
  return { command, options };
}

const round = (n: number, places = 2): string => String(Number(n.toFixed(places)));

function describeGeoref(fit: Georef, marks: number): string[] {
  const lines = [
    `georeference  ${round(fit.milesPerPixel, 5)}mi per pixel, covering ${round(fit.extent.width, 1)} x ${round(fit.extent.height, 1)}mi`,
    `              landmarks span ${Math.round(fit.baseline * 100)}% of the frame` +
      (marks >= 3 ? `, fit leaves ${round(fit.residualMiles, 3)}mi of error` : `, and two landmarks always fit exactly — add a third to make this checkable`),
  ];
  if (Math.abs(fit.rotationDegrees) > 1) {
    lines.push(`              image is ${round(Math.abs(fit.rotationDegrees), 1)}° off north — expected for a rotated picture, suspicious otherwise`);
  }
  return lines;
}

function inspect(options: Options): void {
  const raster = decodePng(readFileSync(options.image));
  const classified = classifyWater(raster, options.index, options.invert);
  const closed = closeGaps(classified.mask, options.close);
  const sea = largestBody(closed);
  const seaPixels = sea.bits.reduce((t, b) => t + b, 0);

  console.log(`image         ${raster.width} x ${raster.height} pixels`);
  console.log(`water         ${Math.round(classified.waterFraction * 100)}% of the frame, cut at ${classified.threshold} on the ${classified.index} index`);
  console.log(`largest body  ${Math.round((seaPixels / (raster.width * raster.height)) * 100)}% of the frame`);
  // The check a reader can actually make: if these two disagree badly, the sea
  // came apart into pieces and every measurement after it would be nonsense.
  const kept = classified.waterFraction > 0 ? seaPixels / (classified.waterFraction * raster.width * raster.height) : 0;
  if (kept < 0.8) {
    console.log(`              only ${Math.round(kept * 100)}% of the water joins up — the sea is in pieces. Raise --close, or the classification is wrong`);
  }
  if (classified.waterFraction < 0.02 || classified.waterFraction > 0.98) {
    console.log(`              that is almost all one class: try --index blue, or --invert`);
  }

  if (options.landmarks.length > 0) {
    for (const line of describeGeoref(fitGeoref(options.landmarks, raster, options.origin), options.landmarks.length)) {
      console.log(line);
    }
  } else {
    console.log("georeference  none given — add --georef to turn pixels into miles");
  }
}

/** Everything the pipeline needs, in the order `inspect` reports it. */
function prepare(options: Options): { mask: ReturnType<typeof largestBody>; fit: Georef } {
  const raster = decodePng(readFileSync(options.image));
  const classified = classifyWater(raster, options.index, options.invert);
  const sea = largestBody(closeGaps(classified.mask, options.close));
  if (options.landmarks.length === 0) {
    throw new GeorefError("measuring needs a georeference: give --georef landmarks so pixels can become miles");
  }
  return { mask: sea, fit: fitGeoref(options.landmarks, raster, options.origin) };
}

function feature(options: Options): void {
  if (!options.mouth || !options.into) throw new Error("feature needs --mouth and --into");
  const { mask, fit } = prepare(options);
  // Resolved AFTER the fit, because a map coordinate cannot become a pixel
  // until there is a georeference to turn it with.
  const mouthPx = toPixels(options.mouth, fit);
  const intoPx = toPixels(options.into, fit);
  const got = measureFeature(mask, fit, mouthPx, intoPx);

  // Thinned to what a person would write. Sixty controls down a canal is the
  // wall of coordinates ADR 0023 exists to remove, wearing a different hat —
  // a tenth of the feature's own width keeps every bend that reads as one.
  //
  // Thinned for readability and NOTHING ELSE (#189). A second pass used to
  // force the survivors evenly apart, to keep the renderer's spline from
  // overshooting on uneven spacing — and it deleted the controls a bend is
  // made of: measured on Hood Canal, the thinned line refused above 1.2mi
  // where the unthinned one drew at 2.2. The spline is centripetal now, so
  // spacing no longer decides a centerline's shape and the workaround is gone.
  const thinned = simplify(got.centerline, Math.max(got.size / 10, fit.milesPerPixel * 2));
  // AND EASED TO A CURVE THE CHANNEL CAN FOLLOW (#192). A centerline is only
  // meaningful down to the scale of the channel's own width, so curvature finer
  // than the half-width is measurement noise — and a bend tighter than the
  // half-width cannot be drawn at all, because that is where an offset curve
  // folds (spec 05 §4). Each control may move within its own half-width of
  // where it was measured and no further, which keeps the line in the water it
  // describes.
  // CHECKED AND EASED WITH THE MOUTH LEAD IN PLACE (#193). A renderer prepends
  // a control of its own along the host's normal, proportional to the first
  // leg, and that control is part of the curve it draws — so a check that
  // leaves it out is checking a different line. It printed a declaration that
  // `check` refused, silently and at exit 0, which is the one failure this
  // tool exists to prevent: measuring accurately and then handing over
  // something that cannot be drawn.
  //
  // The lead is held fixed while the rest is eased, because it is the
  // renderer's control rather than the author's; easing it would be smoothing
  // a point no document contains.
  const eased = easeBends(withMouthLead(thinned[0]!, thinned.slice(1), got.leaves), 1.2, 2);
  const controls = eased.slice(2);
  const subject = [options.word, options.id, options.name ? `"${options.name}"` : ""].filter(Boolean).join(" ");
  // Each control carries the width measured there (#190). `size=` is the mouth
  // and `taper=` could only narrow from it, so a channel that widens into a
  // basin and narrows again — which is what a real one does — had nowhere to be
  // stated, and this tool measured the profile and threw it away.
  const via = controls.length > 0
    ? ` via ${controls.map((p) => `(${round(p.x, 1)},${round(p.y, 1)})@${round(p.width, 2)}mi`).join(" ")}`
    : "";

  console.log(`; measured from ${options.image} — depth ${round(got.depth, 1)}mi along the channel, mouth ${round(got.size, 2)}mi`);
  // BOTH FRAMES, so the next run can be written in either. The anchor below is
  // the mouth CHORD'S MIDPOINT rather than the point given, so it is not the
  // coordinate to re-use for --mouth, and reading it as one lands a few pixels
  // off — which is exactly the hand-conversion this is here to remove.
  const mouthMi = fit.toMap(mouthPx.x, mouthPx.y);
  const intoMi = fit.toMap(intoPx.x, intoPx.y);
  console.log(
    `; measured at --mouth ${round(mouthPx.x)},${round(mouthPx.y)} --into ${round(intoPx.x)},${round(intoPx.y)}`
    + ` (in map coordinates: --mouth ${round(mouthMi.x, 2)},${round(mouthMi.y, 2)}mi --into ${round(intoMi.x, 2)},${round(intoMi.y, 2)}mi)`,
  );
  const shape = controls.length > 0 ? "" : ` taper=${round(got.taper, 2)}`;
  console.log(`${subject} : on <shore> at (${round(got.anchor.x, 1)},${round(got.anchor.y, 1)})${via} size=${round(got.size, 2)}mi${shape}`);
  console.log("");
  // WHICH FRAME THESE ARE IN (#196). Nothing in the output said, and it reads
  // as an absolute map coordinate — so a declaration measured against imagery
  // and pasted into a document whose extent starts elsewhere lands wherever the
  // two frames differ, silently, because a feature in the wrong place is still
  // a valid feature. Stating it costs a line and makes the offset a decision.
  if (options.origin) {
    console.log(`; coordinates are measured from --origin ${round(options.origin.lat, 4)},${round(options.origin.lon, 4)} — this document's own frame.`);
  } else {
    console.log("; coordinates are measured from the IMAGE's top-left corner. Where a document's extent");
    console.log("; starts elsewhere, pass --origin <lat>,<lon> — its north-west corner — or this lands off the map.");
  }
  console.log("; replace <shore> with the id of the coastline this hangs on.");
  if (controls.length === 0) {
    console.log("; no bends worth declaring — add reach= instead of via if you want a straight run.");
  }
  // SAY SO WHERE THE SHAPE STILL CANNOT BE DRAWN. Easing is bounded by the
  // channel, so a genuinely hairpin waterway survives it and is refused by the
  // renderer — correctly, since a channel several miles wide cannot make a turn
  // of smaller radius. Better to hear it from the tool that produced the line
  // than to paste it in and hear it from the renderer.
  const bend = tightestBend(eased);
  if (bend < 1) {
    console.log(
      `; NOTE: this centerline turns tighter than the channel is wide (${round(bend, 2)}x its half-width at the worst bend),`,
    );
    console.log("; so the renderer will refuse it and name the place. The water really does turn that sharply —");
    console.log("; declare the sharpest stretch as its own narrower feature, or accept a wider mouth for it.");
  }
  // The one assumption this check rests on, stated rather than left implicit:
  // the mouth's own chord stands in for the coast, so the lead above points
  // where a renderer will point it only if the feature is hung on a shore
  // running as the measured mouth does. Spec 05 §4 requires a centerline to
  // leave its host perpendicular, so that is the same condition.
  if (controls.length > 0) {
    console.log(`; the centerline leaves the mouth heading (${round(got.leaves.x, 2)},${round(got.leaves.y, 2)});`);
    console.log("; hang this on a coast that runs across that, or it leaves at a skew and is refused (spec 05 §4).");
  }
}

function coast(options: Options): void {
  if (!options.from || !options.to) throw new Error("coast needs --from and --to");
  const { mask, fit } = prepare(options);
  const got = measureCoast(mask, fit, {
    from: toPixels(options.from, fit),
    to: toPixels(options.to, fit),
    // Stated in miles because it is a judgement about the map, not the picture.
    fill: options.fill / fit.milesPerPixel,
    ...(options.through ? { through: toPixels(options.through, fit) } : {}),
  });
  const thinned = simplify(got.points, options.tolerance);
  const subject = ["coastline", options.id, options.name ? `"${options.name}"` : ""].filter(Boolean).join(" ");
  const at = (p: XY): string => `(${round(p.x, 1)},${round(p.y, 1)})`;
  const via = thinned.slice(1, -1).map(at).join(" ");
  console.log(`; traced from ${options.image} — inlets narrower than ${round(options.fill * 2, 2)}mi filled, ${thinned.length} controls at ${round(options.tolerance, 2)}mi`);
  console.log(`; the two arcs run ${round(got.forwardMiles, 1)}mi and ${round(got.backwardMiles, 1)}mi; took the one that is ${Math.round(got.forwardOnFrame * 100)}% picture-edge over the one that is ${Math.round(got.backwardOnFrame * 100)}%${options.through ? ", as --through says" : ""}.`);
  // HOW FAR EACH END MOVED. A point given in open water snaps to the nearest
  // shore, which is right and worth seeing: it was a seven-mile snap onto the
  // top row of the photograph that showed the ends were not being kept off the
  // picture's edge at all, while the other end moved 1.5mi onto a real bank.
  console.log(`; the ends moved ${round(got.fromMovedMiles, 1)}mi and ${round(got.toMovedMiles, 1)}mi to reach the nearest shore.`);
  console.log(`${subject} : from ${at(thinned[0]!)}${via ? ` via ${via}` : ""} to ${at(thinned[thinned.length - 1]!)}`);
  console.log("");
  if (options.origin) {
    console.log(`; coordinates are measured from --origin ${round(options.origin.lat, 4)},${round(options.origin.lon, 4)} — this document's own frame.`);
  } else {
    console.log("; coordinates are measured from the IMAGE's top-left corner. Where a document's extent");
    console.log("; starts elsewhere, pass --origin <lat>,<lon> — its north-west corner — or this lands off the map.");
  }
  console.log("; every inlet that filled is yours to declare on this line — measure each with `feature`.");
}

function main(argv: string[]): number {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(USAGE);
    return 0;
  }
  try {
    const { command, options } = parseArgs(argv);
    if (command === "inspect") {
      inspect(options);
      return 0;
    }
    if (command === "coast") {
      coast(options);
      return 0;
    }
    if (command === "feature") {
      feature(options);
      return 0;
    }
    console.error(`unknown command '${command}'\n\n${USAGE}`);
    return 2;
  } catch (error) {
    // Every failure this tool has is one an author can act on, so it is stated
    // rather than stack-traced.
    if (error instanceof ImageError || error instanceof GeorefError || error instanceof MeasureError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

process.exit(main(process.argv.slice(2)));
