import type { Chart as ChartJS } from "chart.js";
import { METRICS } from "./config.js";
import { $, qs, rgba, tok } from "./dom.js";
import { hm, wd } from "./format.js";
import { annotate, crosshair } from "./plugins.js";
import { state } from "./state.js";
import { externalTooltip } from "./tooltip.js";
import type { MetricKey } from "./types.js";

export type LineChart = ChartJS<"line", (number | null)[], number>;

// Filled by buildCharts(), which runs before anything renders.
export const charts = {} as Record<MetricKey, LineChart>;

// Clean, regularly spaced x labels instead of whatever autoSkip lands on.
// On narrow charts the step doubles so labels never run into each other.
function tickLabel(i: number, narrow: boolean): string | null {
    const p = state.grid[i], prev = state.grid[i - 1];
    if (!p) return null;
    const d = new Date(p.t);
    const hour = d.toLocaleTimeString([], { hour: "numeric" });
    switch (state.range) {
        case "15m": return d.getSeconds() < 15 && d.getMinutes() % (narrow ? 5 : 3) === 0 ? hm(d) : null;
        case "1h": return d.getMinutes() % (narrow ? 20 : 10) === 0 ? hm(d) : null;
        case "1d":
            if (d.getMinutes() >= 15 || d.getHours() % (narrow ? 6 : 3) !== 0) return null;
            return d.getHours() === 0 ? wd(d) : hour;
        case "1w":
            if (!prev || new Date(prev.t).getDate() === d.getDate()) return null;
            return narrow ? wd(d) : d.toLocaleDateString([], { weekday: "short", day: "numeric" });
    }
    return null;
}

function makeChart(key: MetricKey): LineChart {
    const m = METRICS[key];
    const color = tok(m.colorVar);
    const band = rgba(color, Number(tok("--band-alpha")));
    const chart: LineChart = new Chart<"line", (number | null)[], number>($<HTMLCanvasElement>("chart-" + key), {
        type: "line",
        data: {
            labels: [],
            datasets: [
                { data: [], borderWidth: 0, borderColor: "transparent", backgroundColor: band, pointRadius: 0, pointHoverRadius: 0, fill: false, cubicInterpolationMode: "monotone" },
                { data: [], borderWidth: 0, borderColor: "transparent", backgroundColor: band, pointRadius: 0, pointHoverRadius: 0, fill: "-1", cubicInterpolationMode: "monotone" },
                {
                    data: [], borderColor: color, backgroundColor: color, borderWidth: 2,
                    borderCapStyle: "round", borderJoinStyle: "round", fill: false,
                    cubicInterpolationMode: "monotone",
                    // A lone bucket between gaps has no neighbours to draw a
                    // line to, so give it a small dot instead of nothing.
                    pointRadius: ctx => {
                        const d = ctx.dataset.data as (number | null)[], i = ctx.dataIndex;
                        return d[i] !== null && d[i - 1] == null && d[i + 1] == null ? 2.5 : 0;
                    },
                    pointHoverRadius: 4, pointHoverBorderWidth: 2,
                    pointHoverBorderColor: tok("--surface"), pointHoverBackgroundColor: color,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            spanGaps: false,
            layout: { padding: { top: 18, right: 58, bottom: 0, left: 0 } },
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false, external: externalTooltip(key) },
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { color: tok("--rule") },
                    ticks: {
                        autoSkip: false, maxRotation: 0, color: tok("--muted"),
                        font: { size: 12 },
                        callback(_, i) { return tickLabel(i, this.chart.width < 620); },
                    },
                },
                y: {
                    grid: { color: tok("--grid") },
                    border: { display: false },
                    ticks: {
                        maxTicksLimit: 5, color: tok("--muted"), font: { size: 12 },
                        callback: v => `${Number(Number(v).toFixed(1))}${m.tick}`,
                    },
                },
            },
        },
        plugins: [crosshair, annotate(key)],
    });

    const panel = $("panel-" + key);
    qs(panel, `[data-band="${key}"]`).style.background = rgba(color, 0.22);
    return chart;
}

export function buildCharts(): void {
    for (const c of Object.values(charts)) c.destroy();
    Chart.defaults.font.family = tok("--font");
    charts.temp = makeChart("temp");
    charts.hum = makeChart("hum");
}
