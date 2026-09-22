import express from "express";
import os from "node:os"
import {
    addReading,
    getReadings,
    getBuckets,
    getSummary,
    getFirstInRange,
    getLastInRange,
    getLatest,
    type Reading,
} from "./db.js";
import z from "zod"
const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(express.json())
app.use(express.static("WebServer/public"))

app.use((req, res, next) => {
    const start = Date.now()
    res.on("finish", () => {
        console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`)
    })
    next()
})

/** Non-internal IPv4 addresses this machine is reachable at on the LAN — this is
 * the address the ESP32 needs in SERVER_URL, and it changes across networks. */
function lanAddresses(): string[] {
    return Object.values(os.networkInterfaces())
        .flat()
        .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === "IPv4" && !i.internal)
        .map(i => i.address)
}

const ReadingInput = z.object({
    temperature: z.number().min(-40).max(80),
    humidity: z.number().min(0).max(100),
})

// Each range picks a bucket size that lands on ~60-170 points. Enough detail to
// read the shape, few enough that the browser isn't drawing thousands of points
// it can't physically display on a ~900px-wide canvas.
const RANGES = {
    "15m": { ms: 15 * 60_000, bucketMs: 15_000, label: "15 minutes" },
    "1h": { ms: 60 * 60_000, bucketMs: 60_000, label: "1 hour" },
    "1d": { ms: 24 * 60 * 60_000, bucketMs: 15 * 60_000, label: "24 hours" },
    "1w": { ms: 7 * 24 * 60 * 60_000, bucketMs: 60 * 60_000, label: "7 days" },
} as const

const RangeQuery = z.object({
    range: z.enum(["15m", "1h", "1d", "1w"]).default("1h"),
})

/** Magnus formula — the temperature at which this air would start condensing. */
function dewPoint(tempC: number, rh: number): number | null {
    if (rh <= 0) return null
    const a = 17.27, b = 237.7
    const gamma = Math.log(rh / 100) + (a * tempC) / (b + tempC)
    return (b * gamma) / (a - gamma)
}

/** Population standard deviation from E[x²] - E[x]², guarded against fp noise. */
function stdev(avg: number | null, avgOfSquares: number | null): number | null {
    if (avg === null || avgOfSquares === null) return null
    return Math.sqrt(Math.max(0, avgOfSquares - avg * avg))
}


app.get("/health", (req, res) => {
    res.send("Meow! I'm healthy and thriving.")
})

app.post("/api/readings", (req, res) => {
    const parsed = ReadingInput.safeParse(req.body)

    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues })
        return
    }

    const reading: Reading = {
        timestamp: Date.now(),
        temperature: parsed.data.temperature,
        humidity: parsed.data.humidity,
    }
    addReading(reading)
    res.status(201).json(reading)
})

app.get("/api/readings", (req, res) => {
    res.json(getReadings())
})

app.get("/api/series", (req, res) => {
    const parsed = RangeQuery.safeParse(req.query)

    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues })
        return
    }

    const range = RANGES[parsed.data.range]
    const since = Date.now() - range.ms

    const buckets = getBuckets(since, range.bucketMs)
    const s = getSummary(since)
    const first = getFirstInRange(since)
    const last = getLastInRange(since)
    const latest = getLatest()

    res.json({
        range: parsed.data.range,
        rangeLabel: range.label,
        bucketMs: range.bucketMs,
        since,
        now: Date.now(),

        points: buckets.map(b => ({
            t: b.bucket,
            tAvg: b.tAvg,
            tMin: b.tMin,
            tMax: b.tMax,
            hAvg: b.hAvg,
            hMin: b.hMin,
            hMax: b.hMax,
            samples: b.samples,
        })),

        stats: {
            count: s.count,
            firstTs: s.firstTs,
            lastTs: s.lastTs,
            // Age of the newest reading overall (not just in range) — this is how
            // the UI can tell "sensor is alive" from "sensor died an hour ago".
            latestTs: latest?.timestamp ?? null,
            temperature: {
                current: latest?.temperature ?? null,
                min: s.tMin,
                max: s.tMax,
                avg: s.tAvg,
                stdev: stdev(s.tAvg, s.tSq),
                first: first?.temperature ?? null,
                last: last?.temperature ?? null,
                change:
                    first && last ? last.temperature - first.temperature : null,
            },
            humidity: {
                current: latest?.humidity ?? null,
                min: s.hMin,
                max: s.hMax,
                avg: s.hAvg,
                stdev: stdev(s.hAvg, s.hSq),
                first: first?.humidity ?? null,
                last: last?.humidity ?? null,
                change: first && last ? last.humidity - first.humidity : null,
            },
            dewPoint:
                latest ? dewPoint(latest.temperature, latest.humidity) : null,
        },
    })
})

app.listen(PORT, () => {
    console.log(`\nSensor dashboard listening on port ${PORT}\n`)
    console.log(`  Local:    http://localhost:${PORT}`)
    for (const addr of lanAddresses()) {
        console.log(`  Network:  http://${addr}:${PORT}  (use this in the ESP32's SERVER_URL)`)
    }
    console.log(`  Health:   http://localhost:${PORT}/health`)
    console.log(`  Started:  ${new Date().toLocaleString()}\n`)
})