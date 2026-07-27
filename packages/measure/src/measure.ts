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
import { fitGeoref, GeorefError, parseLandmark, type Georef, type Landmark } from "./georef";
import { classifyWater, closeGaps, largestBody, type IndexName } from "./raster";

const USAGE = `chartdown-measure — derive Chartdown declarations from imagery

usage: chartdown-measure inspect <image.png> [options]
       chartdown-measure --help

  inspect   report what the tool sees: the classification it chose, and the
            georeference it fitted. Run this first — a bad water threshold or
            a bad georeference is visible here and invisible afterwards.

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
}

function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command, image, ...rest] = argv;
  if (!command || !image) throw new Error(USAGE);
  const options: Options = { image, landmarks: [], index: "luma", invert: false, close: 2 };
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
    console.error(`unknown command '${command}'\n\n${USAGE}`);
    return 2;
  } catch (error) {
    // Every failure this tool has is one an author can act on, so it is stated
    // rather than stack-traced.
    if (error instanceof ImageError || error instanceof GeorefError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

process.exit(main(process.argv.slice(2)));
