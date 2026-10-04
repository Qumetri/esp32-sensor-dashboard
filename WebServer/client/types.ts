// Shapes of the /api/series response (see WebServer/index.ts).

export type RangeKey = "15m" | "1h" | "1d" | "1w";
export type MetricKey = "temp" | "hum";

export interface Point {
    t: number;
    tAvg: number;
    tMin: number;
    tMax: number;
    hAvg: number;
    hMin: number;
    hMax: number;
    samples: number;
    empty?: false;
}

/** A bucket in the range that the server returned no readings for. */
export interface EmptyPoint {
    t: number;
    empty: true;
    /** Interpolated values for a jitter-sized gap (see BRIDGE_MS), drawn but never reported. */
    bridge?: Point;
}

export type GridPoint = Point | EmptyPoint;

export interface MetricStats {
    current: number | null;
    min: number | null;
    max: number | null;
    avg: number | null;
    stdev: number | null;
    first: number | null;
    last: number | null;
    change: number | null;
}

export interface Stats {
    count: number;
    firstTs: number | null;
    lastTs: number | null;
    latestTs: number | null;
    temperature: MetricStats;
    humidity: MetricStats;
    dewPoint: number | null;
}

export interface Series {
    range: RangeKey;
    rangeLabel: string;
    bucketMs: number;
    since: number;
    now: number;
    points: Point[];
    stats: Stats;
}

export interface Metric {
    name: string;
    unit: string;
    tick: string;
    colorVar: string;
    minSpan: number;
    floor: number;
    ceil: number;
    steady: number;
    avg: (p: Point) => number;
    lo: (p: Point) => number;
    hi: (p: Point) => number;
    stats: (s: Stats) => MetricStats;
}
