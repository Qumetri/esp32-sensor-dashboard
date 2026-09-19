import Database from "better-sqlite3";
import fs from "node:fs"

fs.mkdirSync("WebServer/data", { recursive: true })

const db = new Database("WebServer/data/readings.db")

db.exec('CREATE TABLE IF NOT EXISTS readings(id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, temperature REAL, humidity REAL)')

// Every range query filters and sorts on timestamp. Without this index SQLite
// scans the whole table each time; with it, range lookups stay fast as rows grow.
db.exec('CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp)')

const insertStmt = db.prepare("INSERT INTO readings (timestamp, temperature, humidity) VALUES (?,?,?)")

const selectAllStmt = db.prepare("SELECT timestamp, temperature, humidity FROM readings ORDER BY timestamp")

// Floor the timestamp into a bucket, then multiply back to get the bucket's
// start time. GROUP BY that value and SQLite collapses thousands of raw rows
// into one point per bucket.
//
// CAST(... AS INTEGER) is load-bearing: better-sqlite3 binds JS numbers as REAL
// (JS has only doubles), so `timestamp / ?` is *floating-point* division and
// every row lands in its own fractional bucket — GROUP BY then groups nothing,
// silently returning one bucket per row. The CAST forces the truncation that
// makes bucketing actually happen.
const bucketStmt = db.prepare(`
    SELECT
        CAST(timestamp / ? AS INTEGER) * ? AS bucket,
        AVG(temperature)    AS tAvg,
        MIN(temperature)    AS tMin,
        MAX(temperature)    AS tMax,
        AVG(humidity)       AS hAvg,
        MIN(humidity)       AS hMin,
        MAX(humidity)       AS hMax,
        COUNT(*)            AS samples
    FROM readings
    WHERE timestamp >= ?
    GROUP BY bucket
    ORDER BY bucket
`)

// Aggregates computed in SQL so we never load raw rows into memory — this stays
// cheap whether the range covers 400 rows or 400,000.
// AVG(x*x) is here so variance can be derived as E[x²] - E[x]² (SQLite has no
// built-in stddev); the square root is taken in JS.
const summaryStmt = db.prepare(`
    SELECT
        COUNT(*)                        AS count,
        MIN(timestamp)                  AS firstTs,
        MAX(timestamp)                  AS lastTs,
        MIN(temperature)                AS tMin,
        MAX(temperature)                AS tMax,
        AVG(temperature)                AS tAvg,
        AVG(temperature * temperature)  AS tSq,
        MIN(humidity)                   AS hMin,
        MAX(humidity)                   AS hMax,
        AVG(humidity)                   AS hAvg,
        AVG(humidity * humidity)        AS hSq
    FROM readings
    WHERE timestamp >= ?
`)

const firstInRangeStmt = db.prepare(
    "SELECT timestamp, temperature, humidity FROM readings WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT 1"
)

const lastInRangeStmt = db.prepare(
    "SELECT timestamp, temperature, humidity FROM readings WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 1"
)

const latestStmt = db.prepare(
    "SELECT timestamp, temperature, humidity FROM readings ORDER BY timestamp DESC LIMIT 1"
)

export interface Reading {
    timestamp: number
    temperature: number
    humidity: number
}

export interface Bucket {
    bucket: number
    tAvg: number
    tMin: number
    tMax: number
    hAvg: number
    hMin: number
    hMax: number
    samples: number
}

export interface RawSummary {
    count: number
    firstTs: number | null
    lastTs: number | null
    tMin: number | null
    tMax: number | null
    tAvg: number | null
    tSq: number | null
    hMin: number | null
    hMax: number | null
    hAvg: number | null
    hSq: number | null
}

export function addReading(reading: Reading): void {
    insertStmt.run(reading.timestamp, reading.temperature, reading.humidity)
}

export function getReadings(): Reading[] {
    return selectAllStmt.all() as Reading[]
}

export function getBuckets(since: number, bucketMs: number): Bucket[] {
    return bucketStmt.all(bucketMs, bucketMs, since) as Bucket[]
}

export function getSummary(since: number): RawSummary {
    return summaryStmt.get(since) as RawSummary
}

export function getFirstInRange(since: number): Reading | undefined {
    return firstInRangeStmt.get(since) as Reading | undefined
}

export function getLastInRange(since: number): Reading | undefined {
    return lastInRangeStmt.get(since) as Reading | undefined
}

export function getLatest(): Reading | undefined {
    return latestStmt.get() as Reading | undefined
}
