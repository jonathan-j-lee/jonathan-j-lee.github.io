import { Position, Wind, StationReport } from "./datastore";
import { Matrix, solve } from "ml-matrix";
import util from "./util";
import { timer } from "d3-timer";

declare global {
  var EARTH_RADIUS: number;
  var USA_OUTER: MultiRect;
}

export type Interpolator = (pos: Position, hours: number) => [Position, Wind];
interface InterpolatorOptions {
  basisFn: (x: number) => number;
  norm: (pos1: Position, pos2: Position) => number;
}

// https://en.wikipedia.org/wiki/Radial_basis_function_interpolation
// TODO: Consider porting this to WASM for better performance.
export function makeInterpolator(
  reports: StationReport[],
  { basisFn, norm }: InterpolatorOptions = {
    // The shaping parameter (`r^2` coefficient) needs to not be too small or
    // large:
    // * A coefficient too large will generate very unstable coefficients because
    //   least squares will try to solve for the wind vectors with a matrix of
    //   ones. Not meaningful.
    // * OTOH, a coefficient too large will reduce the influence of station
    //   readings on areas far away. This is essentially what the current basis
    //   function is. Since the LHS matrix is the identity, the weights are just
    //   the raw speeds and the interpolated wind is just linearly weighted on
    //   Haversine distance.
    //
    // TODO: Make a more rigorous choice.
    basisFn: (r: number) => Math.exp(-300 * Math.pow(r, 2)),
    norm: haversineDist,
  },
): Interpolator {
  let bases = new Matrix(reports.length, reports.length);
  for (let i = 0; i < reports.length; i++) {
    for (let j = 0; j < i; j++) {
      let weight = basisFn(norm(reports[i].pos, reports[j].pos));
      bases.set(i, j, weight);
      bases.set(j, i, weight);
    }
    bases.set(i, i, 1);
  }

  for (const report of reports) {
    if (report.wind.speed > 40) {
      console.warn("anomalously high wind speed", report);
    }
    if (isNaN(report.wind.speed) || isNaN(report.wind.dir)) {
      console.warn("missing data", report.wind);
    }
  }

  // Note: These speeds are still in miles, just along the lat/lon lines.
  let latSpeeds = Matrix.columnVector(
    reports.map(({ wind }) => wind.speed * Math.cos(radians(wind.dir))),
  );
  let lonSpeeds = Matrix.columnVector(
    reports.map(({ wind }) => wind.speed * Math.sin(radians(wind.dir))),
  );
  let latWeights = solve(bases, latSpeeds);
  let lonWeights = solve(bases, lonSpeeds);

  return (pos: Position, hours: number) => {
    let base = Matrix.rowVector(
      reports.map((report) => norm(pos, report.pos)).map(basisFn),
    );
    let latSpeed = base.mmul(latWeights).get(0, 0);
    let lonSpeed = base.mmul(lonWeights).get(0, 0);

    let latMiles = latSpeed * hours;
    let lonMiles = lonSpeed * hours;
    let wind: Wind = {
      speed: Math.hypot(latSpeed, lonSpeed),
      dir: degrees(Math.atan2(lonSpeed, latSpeed)),
    };
    if (util.getIntParam("debug") >= 2) {
      console.log(wind, latMiles, lonMiles);
    }
    // TODO: Actually figure out the correct tangent -> great circle distance
    // calculation for this. This is approximately correct over short distances.
    return [
      {
        lat: pos.lat + degrees(latMiles / EARTH_RADIUS),
        lon: pos.lon + degrees(lonMiles / EARTH_RADIUS),
      },
      wind,
    ];
  };
}

// Haversine distance
function haversineDist(pos1: Position, pos2: Position): number {
  let latDiff = radians(pos2.lat - pos1.lat);
  let lonDiff = radians(pos2.lon - pos1.lon);
  let havTheta =
    hav(latDiff) +
    Math.cos(radians(pos1.lat)) * Math.cos(radians(pos2.lat)) * hav(lonDiff);
  return invHav(havTheta);
}

// Haversine function
function hav(theta: number): number {
  return (1 - Math.cos(theta)) / 2;
}

function invHav(x: number): number {
  // Clamp for precision reasons
  return Math.acos(Math.min(1, Math.max(-1, 1 - 2 * x)));
}

function radians(theta: number): number {
  return (theta * Math.PI) / 180;
}

function degrees(theta: number): number {
  return (theta * 180) / Math.PI;
}

class Rect {
  bottom: number;
  top: number;
  left: number;
  right: number;
  area: number;

  constructor(corner1: Position, corner2: Position) {
    this.bottom = Math.min(corner1.lat, corner2.lat);
    this.top = Math.max(corner1.lat, corner2.lat);
    this.left = Math.min(corner1.lon, corner2.lon);
    this.right = Math.max(corner1.lon, corner2.lon);
    // In steradians
    this.area = (this.top - this.bottom) * (this.right - this.left);
  }

  contains(pos: Position): boolean {
    return (
      this.bottom < pos.lat &&
      pos.lat < this.top &&
      this.left < pos.lon &&
      pos.lon < this.right
    );
  }

  random(): Position {
    return {
      lat: this.bottom + (this.top - this.bottom) * Math.random(),
      lon: this.left + (this.right - this.left) * Math.random(),
    };
  }
}

class MultiRect {
  rects: Rect[];
  totalArea: number;

  constructor(rects: Rect[]) {
    this.rects = rects;
    this.totalArea = this.rects
      .map((rect) => rect.area)
      .reduce((a, b) => a + b);
  }

  contains(pos: Position): boolean {
    return this.rects.some((rect) => rect.contains(pos));
  }

  random(): Position {
    const weight = Math.random() * this.totalArea;
    let threshold = 0;
    for (const rect of this.rects) {
      threshold += rect.area;
      if (weight <= threshold) {
        return rect.random();
      }
    }
    throw new Error("this shouldn't happen");
  }

  randomStream(minTicks: number, maxTicks: number): Stream {
    return {
      pos: this.random(),
      ttl: minTicks + Math.trunc(Math.random() * Math.abs(maxTicks - minTicks)),
    };
  }
}

globalThis.EARTH_RADIUS = 3_963.1; // In miles unfortunately, since speed is in MPH
// Low-poly hardcoded approximation because it's fast
globalThis.USA_OUTER = new MultiRect([
  // The Interior
  // San Diego, CA to Duluth, MN
  new Rect({ lat: 32.654, lon: -117.133 }, { lat: 48.966, lon: -92.09 }),
  // Jacksonville, FL to (Gary, IN) x (Duluth, MN)
  new Rect({ lat: 29.11, lon: -81.394 }, { lat: 41.608, lon: -92.09 }),

  // Midwest
  // (Gary, In) x (Detroit, MI) to Duluth, MN (MINI SODAAA!)
  new Rect({ lat: 41.608, lon: -83.093 }, { lat: 46.786, lon: -92.09 }),
  // Grand Portage, MN to Duluth, MN
  new Rect({ lat: 47.969, lon: -89.67 }, { lat: 46.786, lon: -92.09 }),

  // West Coast
  // Point Roberts, WA to (San Francisco, CA) x (San Bernardino, CA)
  new Rect({ lat: 48.9988, lon: -123.027 }, { lat: 37.774, lon: -117.133 }),
  // Clallam Bay, WA to (Ft Bragg, CA) x (Point Roberts, WA)
  new Rect({ lat: 48.254, lon: -124.261 }, { lat: 39.452, lon: -123.027 }),
  // (San Francisco, CA) x (Arlight, CA) to (Santa Monica, CA) x (San Diego, CA)
  new Rect({ lat: 37.774, lon: -120.648 }, { lat: 34.014, lon: -117.113 }),
  // (San Francisco, CA) x (Arlight, CA) to (Plaskett, CA) x (Carmel-by-the-Sea, CA)
  new Rect({ lat: 37.774, lon: -120.648 }, { lat: 35.905, lon: -121.904 }),

  // Southwest/Texas
  // (San Diego, CA) x (Duluth, MN) to (El Paso, TX) x (Las Vegas, NV)
  new Rect({ lat: 32.654, lon: -92.09 }, { lat: 31.32, lon: -115.095 }),
  // (McAllen, TX) x (Duluth, MN) to El Paso, TX
  new Rect({ lat: 26.21, lon: -92.09 }, { lat: 31.32, lon: -106.41 }),

  // Lake Erie
  // (Gary, IN) x (Boston, MA) to Potsdam, NY
  new Rect({ lat: 41.608, lon: -71.031 }, { lat: 44.67, lon: -74.97 }),
  // (Niagara-on-the-Lake, NY) x (Potsdam, NY) to Clayton, NY
  new Rect({ lat: 43.26, lon: -74.97 }, { lat: 44.26, lon: -75.9 }),
  // (Gary, IN) x (Syracuse, NY) to Niagara-on-the-Lake, NY
  new Rect({ lat: 41.608, lon: -76.117 }, { lat: 43.26, lon: -79.033 }),
  // (Gary, IN) x (Niagara-on-the-Lake, NY) to (Erie, PA) x (Mentor, OH)
  new Rect({ lat: 41.608, lon: -79.033 }, { lat: 42.123, lon: -81.3 }),

  // East Coast
  // (Gary, IN) x (Jacksonville, FL) to (Morehead City, NC) x (Virginia Beach, VA)
  new Rect({ lat: 41.608, lon: -81.394 }, { lat: 34.718, lon: -75.987 }),
  // (Van Buren, ME) x (Houlton, ME) to Augusta, ME
  new Rect({ lat: 47.16, lon: -67.85 }, { lat: 44.32, lon: -69.77 }),
  // (Portsmouth, ME) x (Boston, MA) to (Pittsburgh, NH) x (Augusta, ME)
  new Rect({ lat: 43.07, lon: -71.031 }, { lat: 45.089, lon: -69.77 }),
  // Virginia Beach, VA to (Gary, IN) x (Philadelpha, PA) (Joe Biden)
  new Rect({ lat: 36.84, lon: -75.987 }, { lat: 41.608, lon: -71.16 }),
  // (Morehead City, NC) x (Jacksonville, FL) to Charleston, SC
  new Rect({ lat: 34.718, lon: -81.394 }, { lat: 32.77, lon: -79.91 }),
  // (Morehead City, NC) x (Charleston, SC) to (Myrtle Beach, SC) x (Wilmington, NC)
  new Rect({ lat: 34.718, lon: -79.91 }, { lat: 33.7, lon: -77.84 }),

  // FL
  // Jacksonville, FL to Venice, FL
  new Rect({ lat: 29.11, lon: -81.394 }, { lat: 27.12, lon: -82.48 }),
  // (Venice, FL) x (Naples, FL) to (Key Largo, FL) x (Miami FL)
  new Rect({ lat: 27.12, lon: -81.79 }, { lat: 25.07, lon: -80.18 }),
  // (Venice, FL) x (Palm Coast, FL) to Titusville, FL
  new Rect({ lat: 27.12, lon: -81.21 }, { lat: 28.61, lon: -80.8 }),
]);

export const USA_INNER = new MultiRect([
  new Rect({ lat: 34.59, lon: -120.47 }, { lat: 48.51, lon: -92.99 }),
  new Rect({ lat: 41.46, lon: -81.65 }, { lat: 30.44, lon: -92.99 }),
  new Rect({ lat: 34.93, lon: -81.65 }, { lat: 41.46, lon: -75.98 }),
  new Rect({ lat: 41.69, lon: -83.32 }, { lat: 45.81, lon: -92.99 }),
]);

interface Stream {
  pos: Position;
  ttl: number;
}

export function makeUpdate(): (
  interpolator: Interpolator,
) => [Position, Position][] {
  const url = new URL(location.href);
  const numPoints = util.getIntParam("points", 800);
  const maxWindow = util.getFloatParam("window", 168); // In hours
  const tickDuration = util.getFloatParam("tick", 0.5); // In hours

  const maxTicks = Math.min(10, Math.trunc(maxWindow / tickDuration));
  const minTicks = Math.min(5, Math.trunc(0.7 * maxTicks));
  const randomStream = () => USA_OUTER.randomStream(minTicks, maxTicks);
  if (util.getIntParam("debug")) {
    console.log(
      `sim: Using parameters points=${numPoints} window=${maxWindow} tick=${tickDuration}`,
    );
  }

  const streams: Stream[] = new Array(numPoints).fill(null).map(randomStream);

  return (interpolator: Interpolator) => {
    let deltas: [Position, Position][] = [];
    for (let i = 0; i < streams.length; i++) {
      let stream = streams[i];
      if (stream.ttl <= 0 || !USA_OUTER.contains(stream.pos)) {
        streams[i] = stream = randomStream();
      }
      let prevPos = stream.pos;
      let wind: Wind;
      [stream.pos, wind] = interpolator(prevPos, tickDuration);
      stream.ttl -= 1;
      deltas.push([prevPos, stream.pos]);
    }
    return deltas;
  };
}
