// Dashboard entry point: fetching, range and theme controls, polling.
import { buildCharts } from "./charts.js";
import { isRangeKey, METRIC_KEYS, POLL_MS } from "./config.js";
import { $, qs } from "./dom.js";
import { render, renderTable } from "./render.js";
import { state } from "./state.js";
import type { RangeKey, Series } from "./types.js";

async function refresh(): Promise<void> {
    const asked = state.range;
    try {
        const res = await fetch("/api/series?range=" + asked);
        if (!res.ok) throw new Error("the server answered " + res.status);
        const d = await res.json() as Series;
        if (asked !== state.range) return; // a newer range was picked meanwhile
        render(d);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        $("main").classList.remove("refreshing");
        const foot = $("foot");
        foot.className = "foot error";
        foot.textContent = state.last
            ? `Can't reach the server (${message}). Showing the last data received and retrying every ${POLL_MS / 1000} seconds.`
            : `Can't reach the server (${message}). Retrying every ${POLL_MS / 1000} seconds.`;
    }
}

// ---------- wiring ----------
function selectRange(r: RangeKey, { fetchNow }: { fetchNow: boolean }): void {
    state.range = r;
    for (const b of $("range").querySelectorAll<HTMLButtonElement>("button")) {
        b.setAttribute("aria-pressed", String(b.dataset["range"] === r));
    }
    if (location.hash !== "#" + r) history.replaceState(null, "", "#" + r);
    if (fetchNow) {
        // Keep the previous charts on screen, dimmed, until the new range lands.
        $("main").classList.add("refreshing");
        void refresh();
    }
}

$("range").addEventListener("click", e => {
    const btn = (e.target as Element).closest<HTMLButtonElement>("button");
    const r = btn?.dataset["range"];
    if (!isRangeKey(r) || r === state.range) return;
    selectRange(r, { fetchNow: true });
});

// The URL hash holds the range, so a view can be bookmarked (/#1w).
const fromHash = location.hash.slice(1);
if (isRangeKey(fromHash)) selectRange(fromHash, { fetchNow: false });

for (const key of METRIC_KEYS) {
    const details = qs<HTMLDetailsElement>($("panel-" + key), "details");
    details.addEventListener("toggle", () => {
        if (details.open && state.last) renderTable(key);
    });
}

// ---------- theme ----------
// Canvas colours are read from CSS tokens when a chart is built, so a theme
// change rebuilds the charts rather than just swapping stylesheet values.
type Theme = "light" | "dark";

function applyTheme(t: Theme): void {
    document.documentElement.dataset["theme"] = t;
    $("theme").setAttribute("aria-pressed", String(t === "dark"));
    buildCharts();
    if (state.last) render(state.last);
}

$("theme").setAttribute("aria-pressed", String(document.documentElement.dataset["theme"] === "dark"));

$("theme").addEventListener("click", () => {
    const next: Theme = document.documentElement.dataset["theme"] === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch { }
    applyTheme(next);
});

// Until someone picks a theme, keep following the OS setting.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", e => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("theme"); } catch { }
    if (!saved) applyTheme(e.matches ? "dark" : "light");
});

buildCharts();
void refresh();
setInterval(refresh, POLL_MS);

// Canvas text is measured at draw time; redraw once the webfont is in.
void document.fonts?.ready.then(() => {
    buildCharts();
    if (state.last) render(state.last);
});
