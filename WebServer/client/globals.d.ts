import type { Chart as ChartJS } from "chart.js";

// Chart.js is loaded as a UMD <script> from the CDN (see index.html), which
// defines a global `Chart`. The npm package is installed only for its types.
declare global {
    const Chart: typeof ChartJS;
}
