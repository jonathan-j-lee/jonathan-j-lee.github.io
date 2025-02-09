import Animation from "./animation";
import DataStore, { Position, StationReport } from "./datastore";
import { makeInterpolator, makeUpdate, Interpolator } from "./simulation";
import * as d3 from "d3-timer";
import util from "./util";

class StatusLabel {
  total: number;
  label: HTMLElement;
  color: HTMLElement;

  constructor(total: number) {
    this.total = total;
    this.label = document.querySelector(
      "p#load-status > .label",
    )! as HTMLElement;
    this.color = document.querySelector(
      "p#load-status > .indicator",
    )! as HTMLElement;
  }

  update(done: number) {
    this.label.innerText = `Loading weather data (${done}/${this.total} stations) ...`;
  }

  complete(done: number) {
    if (done >= this.total) {
      this.label.innerText = "All weather data loaded.";
      this.color.style.color = "#32A467";
    } else {
      this.label.innerText = "Failed to load all weather data.";
      this.color.style.color = "#E76A6E";
    }
  }
}

async function main() {
  const url = new URL(location.href);
  const canvas = document.getElementById("winds")! as HTMLCanvasElement;
  canvas.width = 960; // Body max-width
  canvas.height = 0.65 * canvas.width;

  const anim = await Animation.withMap(
    canvas,
    "assets/us-outline.geojson",
    "assets/us-polygon.geojson",
  );
  const reports: StationReport[] = [];

  const stations = url.searchParams.get("stations");
  const store = new DataStore({
    stations: stations ? new Set(stations.split(",")) : undefined,
    ttl: util.getFloatParam("ttl") || undefined,
  });
  const status = new StatusLabel(store.stations.size);

  let interpolator = makeInterpolator(reports);
  const timer = d3.timer(() => anim.render(update(interpolator), reports));

  for await (const batch of store.load()) {
    if (batch.length > 0) {
      reports.push(...batch);
      interpolator = makeInterpolator(reports);
    }
    status.update(reports.length);
    if (util.getIntParam("debug")) {
      for (const report of batch) {
        console.log("store: Loaded report", report);
      }
    }
  }

  status.complete(reports.length);
}

const update = makeUpdate();

window.addEventListener("load", main);
