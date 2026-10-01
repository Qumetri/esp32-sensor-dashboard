import type { Plugin } from "chart.js";
import { METRICS } from "./config.js";
import { tok } from "./dom.js";
import { one } from "./format.js";
import type { MetricKey } from "./types.js";

// Vertical hairline at the hovered time, drawn under the data.
export const crosshair: Plugin<"line"> = {
    id: "crosshair",
    beforeDatasetsDraw(chart) {
        const active = chart.tooltip?.getActiveElements?.() ?? [];
        const first = active[0];
        if (!first) return;
        const x = Math.round(first.element.x) + 0.5;
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = tok("--rule");
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, top);
        c.lineTo(x, bottom);
        c.stroke();
        c.restore();
    },
};

function ringDot(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
    c.beginPath();
    c.arc(x, y, r + 2, 0, Math.PI * 2);
    c.fillStyle = tok("--surface");
    c.fill();
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
}

// Selective direct labels: the latest value at the line's end, plus the
// high and the low. Never a number on every point.
export function annotate(key: MetricKey): Plugin<"line"> {
    return {
        id: "annotate",
        afterDatasetsDraw(chart) {
            const m = METRICS[key];
            const series = (i: number) => (chart.data.datasets[i]?.data ?? []) as (number | null)[];
            const hi = series(0), lo = series(1), avg = series(2);

            let end = -1;
            for (let i = avg.length - 1; i >= 0; i--) if (avg[i] != null) { end = i; break; }
            if (end < 0) return;

            const c = chart.ctx;
            const area = chart.chartArea;
            const color = tok(m.colorVar);
            c.save();
            c.textBaseline = "middle";

            let iHi = -1, iLo = -1, vHi = -Infinity, vLo = Infinity;
            for (let i = 0; i < hi.length; i++) {
                const h = hi[i], l = lo[i];
                if (h != null && h > vHi) { iHi = i; vHi = h; }
                if (l != null && l < vLo) { iLo = i; vLo = l; }
            }

            // Only mark extremes when they differ meaningfully; on a flat
            // trace "High 22.4 / Low 22.4" is noise.
            if (iHi >= 0 && iLo >= 0 && vHi - vLo >= m.steady * 2) {
                c.font = `500 12px ${tok("--font")}`;
                c.fillStyle = tok("--ink-2");
                for (const { i, dataset, text, dir } of [
                    { i: iHi, dataset: 0, text: `High ${one(vHi)}${m.tick}`, dir: -1 },
                    { i: iLo, dataset: 1, text: `Low ${one(vLo)}${m.tick}`, dir: 1 },
                ]) {
                    const p = chart.getDatasetMeta(dataset).data[i];
                    // An extreme right next to the end point would double up with
                    // the end label; the stat row above the chart still reports it.
                    if (!p || i >= end - 2) continue;
                    ringDot(c, p.x, p.y, 3, color);
                    const w = c.measureText(text).width;
                    const x = Math.min(Math.max(p.x, area.left + w / 2 + 2), area.right - w / 2 - 2);
                    c.textAlign = "center";
                    c.fillStyle = tok("--ink-2");
                    c.fillText(text, x, p.y + dir * 12);
                }
            }

            const p = chart.getDatasetMeta(2).data[end];
            if (p) {
                ringDot(c, p.x, p.y, 4, color);
                c.font = `600 13px ${tok("--font")}`;
                c.fillStyle = tok("--ink");
                c.textAlign = "left";
                c.fillText(`${one(avg[end])}${m.tick}`, p.x + 10, p.y);
            }
            c.restore();
        },
    };
}
