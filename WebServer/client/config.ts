import type { Metric, MetricKey, RangeKey } from "./types.js";

// How often the ESP32 posts a reading (INTERVAL_MS in ESP/main.py).
export const SEND_INTERVAL_MS = 60_000;

// New data only arrives once a minute; polling faster just repeats requests.
export const POLL_MS = 15_000;

// The server timestamps readings on arrival, so network jitter can push a
// reading into the next one-minute bucket and leave one empty even though
// nothing was missed. Gaps between readings up to this long are drawn as a
// continuous line; anything longer is a real outage and shows as a gap.
export const BRIDGE_MS = 2.5 * SEND_INTERVAL_MS;

export const RANGE_TEXT: Record<RangeKey, string> = {
    "15m": "the last 15 minutes",
    "1h": "the last hour",
    "1d": "the last 24 hours",
    "1w": "the last 7 days",
};

export const isRangeKey = (s: string | undefined): s is RangeKey =>
    s !== undefined && Object.hasOwn(RANGE_TEXT, s);

// Per-metric settings. minSpan stops the y-axis from zooming in on sensor
// noise: the DHT-22 reads in 0.1 steps, and a 0.1 °C wobble stretched to
// fill the chart reads as a dramatic swing.
export const METRICS: Record<MetricKey, Metric> = {
    temp: {
        name: "temperature", unit: "°C", tick: "°", colorVar: "--temp",
        minSpan: 2, floor: -40, ceil: 80, steady: 0.1,
        avg: p => p.tAvg, lo: p => p.tMin, hi: p => p.tMax,
        stats: s => s.temperature,
    },
    hum: {
        name: "humidity", unit: "%", tick: "%", colorVar: "--hum",
        minSpan: 6, floor: 0, ceil: 100, steady: 0.5,
        avg: p => p.hAvg, lo: p => p.hMin, hi: p => p.hMax,
        stats: s => s.humidity,
    },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];
