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
import { fitGeoref, GeorefError, parseLandmark, type Georef, type Landmark, type XY } from "./georef";
import { classifyWater, closeGaps, largestBody, type IndexName } from "./raster";
import { measureFeature, MeasureError, simplify } from "./feature";

const USAGE = `chartdown-measure — derive Chartdown declarations from imagery

usage: chartdown-measure inspect <image.png> [options]
       chartdown-measure feature <image.png> --mouth <px,py> --into <px,py> [options]
       chartdown-measure --help

  inspect   report what the tool sees: the classification it chose, and the
            georeference it fitted. Run this first — a bad water threshold or
            a bad georeference is visible here and invisible afterwards.

  feature   measure one inlet and print its declaration. Which water is "this
            inlet" and where its mouth lies are yours to say: no picture of
            Puget Sound contains a line marking where Hood Canal begins.

feature options:
  --mouth <px>,<py>   a pixel in the channel AT ITS MOUTH, between the headlands
  --into <px>,<py>    a pixel well inside the inlet, past the mouth
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

PNG only, by design — see ADR 0029.`;

interface Options {
  image: string;
  landmarks: Landmark[];
  index: IndexName;
  invert: boolean;
  close: number;
  mouth?: XY;
  into?: XY;
  word: string;
  name?: string;
  id?: string;
}

function parsePixel(text: string | undefined, flag: string): XY {
  const m = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(text ?? "");
  if (!m) throw new Error(`${flag} needs a pixel, as <x>,<y>`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command, image, ...rest] = argv;
  if (!command || !image) throw new Error(USAGE);
  const options: Options = { image, landmarks: [], index: "luma", invert: false, close: 2, word: "sound" };
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
      options.mouth = parsePixel(value, "--mouth");
      i++;
    } else if (flag === "--into") {
      options.into = parsePixel(value, "--into");
      i++;
    } else if (flag === "--word" || flag === "--name" || flag === "--id") {
      if (!value) throw new Error(`${flag} needs a value`);
      options[flag === "--word" ? "word" : flag === "--name" ? "name" : "id"] = value;
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
    for (const line of describeGeoref(fitGeoref(options.landmarks, raster), options.landmarks.length)) {
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
  return { mask: sea, fit: fitGeoref(options.landmarks, raster) };
}

function feature(options: Options): void {
  if (!options.mouth || !options.into) throw new Error("feature needs --mouth and --into");
  const { mask, fit } = prepare(options);
  const got = measureFeature(mask, fit, options.mouth, options.into);

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
  const controls = simplify(got.centerline, Math.max(got.size / 10, fit.milesPerPixel * 2)).slice(1);
  const subject = [options.word, options.id, options.name ? `"${options.name}"` : ""].filter(Boolean).join(" ");
  // Each control carries the width measured there (#190). `size=` is the mouth
  // and `taper=` could only narrow from it, so a channel that widens into a
  // basin and narrows again — which is what a real one does — had nowhere to be
  // stated, and this tool measured the profile and threw it away.
  const via = controls.length > 0
    ? ` via ${controls.map((p) => `(${round(p.x, 1)},${round(p.y, 1)})@${round(p.width, 2)}mi`).join(" ")}`
    : "";

  console.log(`; measured from ${options.image} — depth ${round(got.depth, 1)}mi along the channel, mouth ${round(got.size, 2)}mi`);
  const shape = controls.length > 0 ? "" : ` taper=${round(got.taper, 2)}`;
  console.log(`${subject} : on <shore> at (${round(got.anchor.x, 1)},${round(got.anchor.y, 1)})${via} size=${round(got.size, 2)}mi${shape}`);
  console.log("");
  console.log("; replace <shore> with the id of the coastline this hangs on.");
  if (controls.length === 0) {
    console.log("; no bends worth declaring — add reach= instead of via if you want a straight run.");
  }
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
