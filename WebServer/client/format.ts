import type { RangeKey } from "./types.js";

export const one = (v: number | null | undefined): string =>
    (v === null || v === undefined || Number.isNaN(v)) ? "–" : v.toFixed(1);

// ---------- time formatting ----------
export const hm = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const day = (d: Date) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
export const wd = (d: Date) => d.toLocaleDateString([], { weekday: "short" });

export function bucketWords(ms: number): string {
    if (ms === 60_000) return "each minute";
    if (ms === 15 * 60_000) return "each 15 minutes";
    if (ms === 60 * 60_000) return "each hour";
    return "each bucket";
}

// What one point on the chart covers, e.g. "Tue 14:15–14:30".
export function spanText(t: number, bucketMs: number, r: RangeKey): string {
    const a = new Date(t), b = new Date(t + bucketMs);
    if (r === "15m" || r === "1h") return `${hm(a)}–${hm(b)}`;
    if (r === "1d") return `${wd(a)} ${hm(a)}–${hm(b)}`;
    return `${day(a)}, ${hm(a)}–${hm(b)}`;
}

// When an extreme happened, at the precision the range can support.
export function whenText(t: number, r: RangeKey): string {
    const d = new Date(t);
    if (r === "15m" || r === "1h") return "at " + hm(d);
    return "on " + wd(d) + " at " + hm(d);
}

export function ago(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
}
