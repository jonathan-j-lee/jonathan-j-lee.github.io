import * as d3 from "d3-geo";
import * as GeoJSON from "geojson";
import { Position, StationReport } from "./datastore";
import { USA_INNER } from "./simulation";
import util from "./util";

export interface AnimationOptions {
  // How fast the windstreams fade
  fade: number;
}

export default class Animation {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  map: OffscreenCanvas;
  // Last frame of windstreams only, with opacity reduced slightly. THis creates
  // the illusion of motion.
  lastFrame: OffscreenCanvas;

  proj: d3.GeoProjection;
  // Low-poly outline of the map for bounds checking.
  outline: GeoJSON.GeometryObject;
  options: AnimationOptions;

  constructor(
    canvas: HTMLCanvasElement,
    map: any,
    outline: any,
    options: AnimationOptions = {
      fade: util.getFloatParam("fade", 0.9),
    },
  ) {
    this.canvas = canvas;
    this.lastFrame = new OffscreenCanvas(this.canvas.width, this.canvas.height);
    this.ctx = this.canvas.getContext("2d")!;
    this.proj = d3
      .geoAlbersUsa()
      .fitSize([this.canvas.width, this.canvas.height], map);

    this.map = new OffscreenCanvas(this.canvas.width, this.canvas.height);
    // Draw the map in rasterized form up-front, then copy that into the live
    // map for each render. This is cheaper than re-enumerating all
    // constituent points in the map polygon, projecting them, etc.
    this.initMap(map);
    this.outline = outline;
    this.options = options;
  }

  initMap(map: any) {
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    this.ctx.beginPath();
    const path = d3.geoPath(this.proj, this.ctx);
    path(map);
    this.ctx.stroke();
    const ctx = this.map.getContext("2d")!;
    ctx.drawImage(this.canvas, 0, 0);
  }

  static async withMap(
    canvas: HTMLCanvasElement,
    mapUrl: string,
    outlineUrl: string,
  ) {
    let mapRes = await fetch(mapUrl, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "max-age=2592000",
      },
    });
    let outlineRes = await fetch(outlineUrl, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "max-age=2592000",
      },
    });
    if (!mapRes.ok || !outlineRes.ok) {
      throw new Error("unable to fetch map/outline");
    }
    return new Animation(canvas, await mapRes.json(), await outlineRes.json());
  }

  // TODO: Consider caching the previous projection. Unfortunately, respawning
  // streams makes this difficult.
  render(deltas: [Position, Position][], reports: StationReport[], radius = 3) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalCompositeOperation = "darken";
    this.ctx.drawImage(this.lastFrame, 0, 0);

    this.ctx.strokeStyle = this.ctx.fillStyle = "rgba(255, 255, 255, 1)";
    for (const [prevPoint, nextPoint] of deltas) {
      this.ctx.beginPath();
      let coordinates = this.proj([prevPoint.lon, prevPoint.lat]);
      if (!coordinates) {
        continue;
      }
      this.ctx.moveTo(...coordinates);
      coordinates = this.proj([nextPoint.lon, nextPoint.lat]);
      if (!coordinates || !this.contains(nextPoint)) {
        continue;
      }
      this.ctx.lineTo(...coordinates);
      this.ctx.stroke();
    }

    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.strokeStyle = this.ctx.fillStyle = "rgba(192, 192, 192, 0.6)";
    for (const { pos } of reports) {
      let coordinates = this.proj([pos.lon, pos.lat]);
      if (!coordinates) {
        continue;
      }
      this.ctx.beginPath();
      this.ctx.arc(...coordinates, radius, 0, 2 * Math.PI);
      this.ctx.fill();
    }

    this.saveToFrameBuffer();
    this.ctx.drawImage(this.map, 0, 0);
  }

  contains(point: Position): boolean {
    // Fast paths using rectangles inside short-circuits `geoContains(...)`,
    // is authoritative but slow.
    return (
      USA_INNER.contains(point) ||
      d3.geoContains(this.outline, [point.lon, point.lat])
    );
  }

  saveToFrameBuffer() {
    const ctx = this.lastFrame.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, this.lastFrame.width, this.lastFrame.height);
    ctx.globalAlpha = this.options.fade;
    ctx.drawImage(this.canvas, 0, 0);
  }
}
