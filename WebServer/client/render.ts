import { charts } from "./charts.js";
import { METRICS, RANGE_TEXT } from "./config.js";
import { $, qs } from "./dom.js";
import { ago, bucketWords, one, spanText, whenText } from "./format.js";
import { state } from "./state.js";
import type { GridPoint, Metric, MetricKey, Point, Series } from "./types.js";

const isFilled = (p: GridPoint): p is Point => !p.empty;

// The server only returns buckets that have readings. Laying them onto a
// full grid that spans the whole range keeps time evenly spaced and turns
// missing buckets into visible gaps instead of silently joining across them.
function buildGrid(d: Series): GridPoint[] {
    const byT = new Map(d.points.map(p => [p.t, p]));
    const out: GridPoint[] = [];
    const start = Math.floor(d.since / d.bucketMs) * d.bucketMs;
    for (let t = start; t <= d.now; t += d.bucketMs) {
        out.push(byT.get(t) ?? { t, empty: true });
    }
    return out;
}

function renderChart(key: MetricKey, d: Series): void {
    const m = METRICS[key];
    const chart = charts[key];
    const panel = $("panel-" + key);
    const { grid, range } = state;
    const val = (f: (p: Point) => number) => grid.map(p => p.empty ? null : f(p));

    chart.data.labels = grid.map(p => p.t);
    chart.data.datasets[0]!.data = val(m.hi);
    chart.data.datasets[1]!.data = val(m.lo);
    chart.data.datasets[2]!.data = val(m.avg);

    // Y range: at least minSpan wide, centred on the data, with headroom
    // for the high/low labels.
    const filled = grid.filter(isFilled);
    const y = chart.options.scales?.["y"] as { suggestedMin?: number | undefined; suggestedMax?: number | undefined };
    if (filled.length) {
        const lo = Math.min(...filled.map(m.lo));
        const hi = Math.max(...filled.map(m.hi));
        const span = Math.max(m.minSpan, (hi - lo) * 1.3);
        const mid = (lo + hi) / 2;
        y.suggestedMin = Math.max(m.floor, mid - span / 2);
        y.suggestedMax = Math.min(m.ceil, mid + span / 2);
    } else {
        y.suggestedMin = undefined;
        y.suggestedMax = undefined;
    }
    chart.update();

    // stats
    const s = m.stats(d.stats);
    const set = (name: string, text: string) => { qs(panel, `[data-stat="${name}"]`).textContent = text; };
    const extreme = (f: (p: Point) => number, pick: (a: number, b: number) => boolean) => {
        let best: Point | null = null;
        for (const p of filled) if (best === null || pick(f(p), f(best))) best = p;
        return best;
    };
    const pLo = extreme(m.lo, (a, b) => a < b);
    const pHi = extreme(m.hi, (a, b) => a > b);

    set("low", s.min === null ? "–" : `${one(s.min)} ${m.unit}`);
    set("low-at", pLo ? whenText(pLo.t, range) : "");
    set("avg", s.avg === null ? "–" : `${one(s.avg)} ${m.unit}`);
    set("high", s.max === null ? "–" : `${one(s.max)} ${m.unit}`);
    set("high-at", pHi ? whenText(pHi.t, range) : "");
    set("sd", s.stdev === null ? "–"
        : s.stdev < 0.05 ? `under 0.1 ${m.unit}`
            : `± ${s.stdev.toFixed(s.stdev < 1 ? 2 : 1)} ${m.unit}`);

    qs(panel, ".band-text").textContent = "Low to high within " + bucketWords(d.bucketMs);

    const empty = qs(panel, ".empty");
    empty.hidden = filled.length > 0;
    empty.textContent = `No readings in ${RANGE_TEXT[range]}. They appear here as the sensor sends them.`;

    $("chart-" + key).setAttribute("aria-label",
        filled.length
            ? `${m.name[0]!.toUpperCase() + m.name.slice(1)} over ${RANGE_TEXT[range]}: low ${one(s.min)}, high ${one(s.max)}, average ${one(s.avg)} ${m.unit}.`
            : `No ${m.name} readings in ${RANGE_TEXT[range]}.`);

    const details = qs<HTMLDetailsElement>(panel, "details");
    if (details.open) renderTable(key);
}

export function renderTable(key: MetricKey): void {
    const d = state.last;
    if (!d) return;
    const { grid, range } = state;
    const m = METRICS[key];
    const wrap = qs($("panel-" + key), ".table-wrap");
    const scroll = wrap.scrollTop;
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    for (const h of ["Time", `Average (${m.unit})`, `Low (${m.unit})`, `High (${m.unit})`, "Readings"]) {
        const th = document.createElement("th");
        th.textContent = h;
        head.append(th);
    }
    const body = table.createTBody();
    for (let i = grid.length - 1; i >= 0; i--) {
        const p = grid[i];
        if (!p || p.empty) continue;
        const tr = body.insertRow();
        for (const v of [spanText(p.t, d.bucketMs, range), one(m.avg(p)), one(m.lo(p)), one(m.hi(p)), p.samples.toLocaleString()]) {
            tr.insertCell().textContent = v;
        }
    }
    if (!body.rows.length) {
        const td = body.insertRow().insertCell();
        td.colSpan = 5;
        td.textContent = `No readings in ${RANGE_TEXT[range]}.`;
    }
    wrap.replaceChildren(table);
    wrap.scrollTop = scroll;
}

function changeText(m: Metric, v: number | null | undefined): string | null {
    if (v === null || v === undefined) return null;
    if (Math.abs(v) < m.steady) return `${m.name} held steady`;
    return `${m.name} ${v > 0 ? "rose" : "fell"} ${Math.abs(v).toFixed(1)} ${m.unit}`;
}

export function render(d: Series): void {
    state.last = d;
    state.grid = buildGrid(d);
    const { grid, range } = state;
    const s = d.stats;

    $("now-temp").textContent = one(s.temperature.current);
    $("now-hum").textContent = one(s.humidity.current);

    const parts = [changeText(METRICS.temp, s.temperature.change), changeText(METRICS.hum, s.humidity.change)].filter(Boolean);
    let summary = parts.length
        ? `Over ${RANGE_TEXT[range]}, ${parts.join(" and ")}.`
        : `No readings in ${RANGE_TEXT[range]} yet.`;
    if (s.dewPoint !== null) summary += ` Dew point is ${one(s.dewPoint)} °C.`;
    $("summary").textContent = summary;

    // Liveness: a flat line looks the same whether the room is stable or
    // the sensor died, so say which.
    const live = $("live");
    const age = s.latestTs === null ? null : d.now - s.latestTs;
    if (age === null) {
        live.dataset["state"] = "none";
        $("live-state").textContent = "Waiting for data";
        $("live-age").textContent = "";
    } else {
        live.dataset["state"] = age < 30_000 ? "good" : age < 5 * 60_000 ? "warn" : "bad";
        $("live-state").textContent = age < 30_000 ? "Live" : age < 5 * 60_000 ? "Delayed" : "Offline";
        $("live-age").textContent = "last reading " + ago(age);
    }

    renderChart("temp", d);
    renderChart("hum", d);

    const foot = $("foot");
    foot.className = "foot";
    if (s.count === 0 || s.firstTs === null || s.lastTs === null) {
        foot.textContent = `No readings in ${RANGE_TEXT[range]}.`;
    } else {
        const span = s.lastTs - s.firstTs;
        const every = s.count > 1 && span > 0 ? (span / (s.count - 1) / 1000) : null;
        // Coverage counts buckets that actually hold readings, so an outage
        // in the middle of the range shows up here and not just as a gap.
        const cover = Math.round(grid.filter(isFilled).length / grid.length * 100);
        foot.textContent =
            `${s.count.toLocaleString()} readings in ${RANGE_TEXT[range]}` +
            (every ? `, about one every ${every < 10 ? every.toFixed(1) : Math.round(every)} seconds.` : ".") +
            ` Readings cover ${cover}% of the period` +
            (cover < 97 ? "; gaps in the charts are times the sensor sent nothing." : ".");
    }

    $("main").classList.remove("refreshing");
}
