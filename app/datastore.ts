import util from "./util";

export interface Position {
  lat: number;
  lon: number;
}

export interface Wind {
  dir: number;
  speed: number;
}

export interface Station {
  code: string;
  name?: string;
  link: URL | string | null;
}

export interface StationReport {
  station: Station;
  pos: Position;
  wind: Wind;
}

interface CachedReport {
  insertTime: number;
  repots: StationReport;
}

export interface DataStoreOptions {
  stations?: Set<string>;
  ttl?: number;
  batchSize?: number;
}

// Note: This uses the `DOMParser` API, so unfortunately it needs to run
// within a window context (i.e., not a worker).
export default class DataStore {
  stations: Set<string>;
  batchSize: number;
  ttl: number;

  readonly BASE_URL = "https://forecast.weather.gov";
  // The default location list should include coverage everywhere possible to
  // improve the interpolation.
  readonly DEFAULT_STATIONS = new Set([
    "ABQ", // Albuquerque, NM
    "ALB", // Albany, NY
    "AMA", // Amarillo, TX
    "ATL", // Atlanta, GA
    "BGR", // Bangor, ME
    "BHM", // Birmingham, AL
    "BIL", // Billings, MT
    "BIS", // Bismarck, ND
    "BOI", // Boise, ID
    "BOS", // Boston, MA
    "BNA", // Nashville, TN
    "BTV", // Burlington, VT
    "BUF", // Buffalo, NY
    "BWI", // Baltimore, MD
    "CHS", // Charleston, SC
    "CLE", // Cleveland, OH
    "CLT", // Charlotte, NC
    "CMH", // Columbus, OH
    "CNY", // Moab, UT
    "COS", // Colorado Springs, CO
    "CPR", // Casper, WY
    "CRP", // Corpus Christi, TX
    "CSG", // Columbus, GA
    "CRW", // Charleston, WV
    "DEN", // Denver, CO
    "DFW", // Dallas-Fort Worth, TX
    "DLH", // Duluth, MN
    "DSM", // Des Moines, IA
    "DTW", // Detroit, MI
    "ELP", // El Paso, TX
    "FAR", // Fargo, ND
    "FAT", // Fresno, CA
    "FSD", // Sioux Falls, SD
    "FWA", // Fort Wayne, IN
    "GEG", // Spokane, WA
    "GRR", // Grand Rapids, MI
    "IAD", // Washington DC
    "IAH", // Houston, TX
    "ICT", // Witchita, KS
    "ILM", // Willmington, NC
    "IND", // Indianapolis, IN
    "JAX", // Jacksonville, FL
    "JAN", // Jackson, MS
    "JFK", // New York, NY
    "LAS", // Las Vegas, NV
    "LAX", // Los Angeles, CA
    "LBB", // Lubbock, TX
    "LEX", // Lexington, KY
    "LIT", // Little Rock, AR
    "MCI", // Kansas City, MO
    "MCO", // Orlando, FL
    "MDT", // Harrisburg, PA
    "MEM", // Memphis, TN
    "MHT", // Manchester, NH
    "MIA", // Miami, FL
    "MKE", // Milwaukee, WI
    "MOB", // Mobile, AL
    "MSN", // Madison, WI
    // Missing data
    // 'MSO',  // Missoula, MT
    "MSY", // New Orleans, LA
    "MSP", // Minneapolis, MN
    "OKC", // Oklahoma City, OK
    "OMA", // Omaha, NE
    "ORD", // Chicago, IL
    "PHL", // Philadelpha, PA
    "PHX", // Phoenix, AZ
    "PDX", // Portland, OR
    "PIT", // Pittsburgh, PA
    "RDD", // Redding, CA
    "RDU", // Raleigh, NC
    "RIC", // Richmond, VA
    "RNO", // Reno, NV
    "SAT", // San Antonio, TX
    "SAV", // Savannah, GA
    "SAN", // San Diego, CA
    "SDF", // Louisville, KY
    "SEA", // Seattle, WA
    "SFO", // San Francisco, CA
    "SLC", // Salt Lake City, UT
    "SMF", // Sacramento, CA
    "STL", // St Louis, MO
    "SYR", // Syracuse, NY
    "TPA", // Tampa, FL
    "TUS", // Tucson, AZ
    "TVC", // Traverse City, MI
    "TYS", // Knoxville, TN
  ]);

  constructor(options: DataStoreOptions) {
    this.stations = options.stations || this.DEFAULT_STATIONS;
    this.ttl = options.ttl || 24 * 60 * 60;
    this.batchSize = options.batchSize || 8;
  }

  async *load() {
    try {
      const storedReports = this.loadFromCache();
      yield storedReports;
      const storedReportCodes = new Set(
        storedReports.map((report) => report.station.code),
      );
      let productPage = await this.fetchHtml(
        "/product_sites.php?site=OKX&product=CF6",
      );
      let stations = productPage.querySelector(".contentArea");
      if (!stations) {
        return;
      }
      let pending = [];
      for (const link of stations.getElementsByTagName("a")) {
        let station = this.parseStationLink(link);
        if (
          this.stations.has(station.code) &&
          !storedReportCodes.has(station.code)
        ) {
          pending.push(this.fetchStationReport(station));
          if (pending.length >= this.batchSize) {
            yield await this.resolveBatch(pending);
            pending = [];
          }
        }
      }
      if (pending.length > 0) {
        yield await this.resolveBatch(pending);
      }
    } catch (err) {
      console.error(err);
    }
  }

  loadFromCache(): StationReport[] {
    const reports: StationReport[] = [];
    const now = Date.now();
    const entries = Object.entries(localStorage);
    for (const [key, value] of entries) {
      const { insertTime, report } = JSON.parse(value);
      if (
        insertTime + this.ttl * 1000 < now ||
        !this.stations.has(report.station.code)
      ) {
        localStorage.removeItem(key);
      } else {
        reports.push(report);
      }
    }
    const expired = entries.length - reports.length;
    if (util.getIntParam("debug")) {
      console.log(
        `store: Loaded ${reports.length} entries, expired ${expired}`,
      );
    }
    return reports;
  }

  async resolveBatch(
    pending: Promise<StationReport>[],
  ): Promise<StationReport[]> {
    let results = await Promise.allSettled(pending);
    let reports = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        localStorage.setItem(
          this.storageKey(result.value),
          JSON.stringify({
            insertTime: Date.now(),
            report: result.value,
          }),
        );
        reports.push(result.value);
      } else {
        console.error(result.reason);
      }
    }
    return reports;
  }

  storageKey(report: StationReport) {
    return `weather-${report.station.code}`;
  }

  parseStationLink(link: HTMLAnchorElement): Station {
    let splitIndex = link.innerText.indexOf("-");
    let href = link.getAttribute("href");
    if (splitIndex === -1) {
      return { code: link.innerText.trim(), link: href };
    } else {
      return {
        code: link.innerText.slice(0, splitIndex).trim(),
        name: link.innerText.slice(splitIndex + 1).trim(),
        link: href,
      };
    }
  }

  async fetchStationReport(station: Station): Promise<StationReport> {
    if (!station.link) {
      throw new Error("station <a> has no link");
    }
    let url = new URL(station.link, this.BASE_URL);
    url.searchParams.append("format", "txt");
    url.searchParams.append("version", "1");
    url.searchParams.append("glossary", "0");
    let stationPage = await this.fetchHtml(url);
    let data = stationPage.querySelector(
      ".glossaryProduct",
    ) as HTMLPreElement | null;
    if (!data) {
      throw new Error("no data on station page");
    }
    return this.parseStationReport(station, data.innerText);
  }

  parseStationReport(station: Station, contents: string): StationReport {
    const [, stationName] = contents.match(/station:\s+(.*)/i) || [];
    if (stationName) {
      station.name = stationName;
    }
    const [, latDegrees, latMinutes, northSouth] =
      contents.match(/latitude:\s+(\d+)[^\d]+(\d+)\s+(N|S)/i) || [];
    let lat =
      Number.parseFloat(latDegrees) + Number.parseFloat(latMinutes) / 60;
    if (northSouth === "S") {
      lat *= -1;
    }

    const [, lonDegrees, lonMinutes, eastWest] =
      contents.match(/longitude:\s+(\d+)[^\d]+(\d+)\s+(E|W)/i) || [];
    let lon =
      Number.parseFloat(lonDegrees) + Number.parseFloat(lonMinutes) / 60;
    if (eastWest === "W") {
      lon *= -1;
    }

    // TODO:
    // * Do something more robust by reading the column headings.
    // * Would be cool to store the historical data and let the user slide to
    //   a particular date.
    let ruleCount = 0;
    let [speed, dir]: [number | null, number | null] = [null, null];
    for (const line of contents.split("\n")) {
      if (line.startsWith("=====")) {
        ruleCount += 1;
      } else if (ruleCount === 2) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 13) {
          continue;
        }
        speed = Number.parseFloat(fields[11]);
        dir = Number.parseFloat(fields[12]);
      } else if (ruleCount > 2) {
        break;
      }
    }

    if (
      speed === null ||
      dir === null ||
      isNaN(speed) ||
      isNaN(dir) ||
      isNaN(lat) ||
      isNaN(lon)
    ) {
      throw new Error(`bad data for ${JSON.stringify(station)}`);
    }
    return { station, pos: { lat, lon }, wind: { speed, dir } };
  }

  async fetchHtml(url: URL | string): Promise<Document> {
    let parser = new DOMParser();
    return parser.parseFromString(await this.fetchText(url), "text/html");
  }

  async fetchText(url: URL | string): Promise<string> {
    let res = await fetch(new URL(url, this.BASE_URL));
    if (!res.ok) {
      throw new Error(`failed to fetch ${url}`);
    }
    return await res.text();
  }
}
