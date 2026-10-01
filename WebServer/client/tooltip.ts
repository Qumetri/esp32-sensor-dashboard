import type { Chart as ChartJS, TooltipModel } from "chart.js";
import { METRICS } from "./config.js";
import { qs, rgba, tok } from "./dom.js";
import { one, spanText } from "./format.js";
import { state } from "./state.js";
import type { MetricKey } from "./types.js";

// Value leads, label follows.
export function externalTooltip(key: MetricKey) {
    return ({ chart, tooltip }: { chart: ChartJS; tooltip: TooltipModel<"line"> }): void => {
        const box = chart.canvas.parentElement;
        if (!box) return;
        const tip = qs(box, ".tip");
        const m = METRICS[key];
        const i = tooltip.dataPoints?.[0]?.dataIndex;
        const p = i === undefined ? null : state.grid[i];

        if (tooltip.opacity === 0 || !p || p.empty || !state.last) {
            tip.hidden = true;
            return;
        }

        tip.replaceChildren();
        const add = (cls: string, text: string) => {
            const el = document.createElement("div");
            el.className = cls;
            el.textContent = text;
            tip.append(el);
            return el;
        };
        const row = (keyEl: HTMLElement, value: string, label: string) => {
            const el = document.createElement("div");
            el.className = "row";
            const strong = document.createElement("strong");
            strong.textContent = value;
            const span = document.createElement("span");
            span.textContent = label;
            el.append(keyEl, strong, span);
            tip.append(el);
        };

        add("t", spanText(p.t, state.last.bucketMs, state.range));

        const pen = document.createElement("span");
        pen.className = "pen " + key;
        row(pen, `${one(m.avg(p))} ${m.unit}`, "average");

        const band = document.createElement("span");
        band.className = "swatch-band";
        band.style.background = rgba(tok(m.colorVar), 0.22);
        row(band, `${one(m.lo(p))}–${one(m.hi(p))} ${m.unit}`, "low to high");

        add("n", `${p.samples.toLocaleString()} ${p.samples === 1 ? "reading" : "readings"}`);

        tip.hidden = false;
        const x = tooltip.caretX;
        const w = tip.offsetWidth;
        const left = x + 16 + w > box.clientWidth ? x - 16 - w : x + 16;
        tip.style.left = Math.max(0, left) + "px";
    };
}
