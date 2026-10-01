import type { GridPoint, RangeKey, Series } from "./types.js";

// Mutable view state shared across modules. An object rather than exported
// `let`s, because importers can't reassign an imported binding.
export const state: {
    range: RangeKey;
    /** last successful payload */
    last: Series | null;
    /** full bucket grid for the current payload */
    grid: GridPoint[];
} = {
    range: "1h",
    last: null,
    grid: [],
};
