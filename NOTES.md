# ESP32 Sensor Dashboard — Project Notes

Working notes for a learning project: an ESP32 running MicroPython reads a DHT-22
(and later an INA219), POSTs readings over WiFi to an Express + TypeScript server,
which stores them and serves a web page that displays them.

Hardware on hand: ESP32 dev board, DHT-22, INA219, 18650 cell.

**This file gets updated as we go** — checklist below reflects real progress,
not the plan. New findings/gotchas get added to their relevant section as they
come up.

---

## 1. System shape

```
ESP32 + DHT-22  ──HTTP POST JSON──>  Express (TS)  ──>  storage
                                          │
                                          └──GET /api──> browser page (table → chart)
```

Four decisions, with the choice made for the first build:

| Decision | Options | Chosen |
|---|---|---|
| ESP32 → server | HTTP POST, MQTT, WebSocket | **HTTP POST JSON** — no broker, debuggable with curl |
| Server → browser | polling, SSE, WebSocket | **polling** first, then SSE |
| Storage | in-memory array, SQLite, time-series DB | **in-memory**, then SQLite (`better-sqlite3`) |
| UI | server-rendered, static page + JSON API | **static page + JSON API** |

MQTT and WebSockets are the "proper IoT" answers but hide the request/response
fundamentals. Both swap in later without changing the data model.

---

## 2. Build order / checklist

Check items off here as they're done. Keep this in sync each session.

- [x] ESP32 firmware flashed with MicroPython (ESP32-WROOM-32, `ESP32_GENERIC` build, via `esptool`)
- [x] VSCode set up for device dev (MicroPico extension, confirmed working)
- [x] **Step 0** — DHT-22 wired (GPIO 4, 3.3V) and read successfully from `main.py` on-device
- [x] **Step 1** — Bare Express + TS, one `GET /health` — get the dev loop and tsconfig working
- [x] **Step 2** — `POST /api/readings` + `GET /api/readings`, in-memory array — test with curl
- [ ] **Step 3 (deferred, optional)** — Python fake sensor on the laptop. Originally
      meant to decouple "is the server right?" from "is the ESP32 right?", but
      both are already independently verified (sensor reads clean from the REPL,
      Express round-trips via curl) — so skipping straight to real hardware.
      Worth revisiting later for bulk test data or iterating without the board
      nearby, just not a gate anymore.
- [x] **Step 4** — ESP32 posting for real (doing this next, ahead of step 3)
- [x] **Step 6** — Swap array for SQLite *(reordered: doing this before step 5, so
      chart work isn't built on data that vanishes on every `tsx watch` restart)*
- [x] **Step 6b** — Split `db` into its own module, keep `index.ts` thin
- [x] **Step 8a** — zod validation on the POST body
- [ ] **Step 8b** — env config: port + DB path via `node --env-file=.env` (no dotenv dep needed on Node 22)
- [ ] **Step 8c** — Prettier (format on save)
- [ ] **Step 8d** — A few `vitest` + `supertest` route tests — mainly a safety net for the SQLite refactor
- [x] **Step 5** — Static page → Chart.js (skipped the intermediate table stage)
- [ ] **Step 7** — Replace polling with SSE
- [ ] Later — INA219 current monitoring
- [ ] Later — 18650 battery power + deep sleep restructure

---

## 3. Express + TypeScript

### Setup
- `typescript`, `@types/node`, `@types/express`
- `tsx` to run TS directly with a watch mode (simpler than the older `ts-node-dev`).
  Node 22+ can run TS natively too, but tsx is less fussy.
- **Dropped `nodemon`.** It doesn't understand `.ts` on its own — running it
  required `nodemon --exec tsx ...`, which is two watchers layered for no benefit
  over just `tsx watch WebServer/index.ts` directly. `dev` script simplified to
  the latter; one less dependency, one less thing that can drift out of sync.

### Concepts, roughly in the order they bite
- **Middleware** — a function `(req, res, next)` running in registration order.
  This is 80% of Express.
- **`app.use(express.json())`** — parses a JSON body. Without it `req.body` is
  `undefined`. The single most common beginner trap.
- **Routing** — `app.get('/path', handler)`, then `express.Router()` once there
  are more than a few routes.
- **Typing requests** — `Request` is generic:
  `Request<Params, ResBody, ReqBody, Query>`. To type a POST body:
  `Request<{}, {}, SensorReading>`. Worth learning instead of reaching for `any`.
- **Error handling** — a middleware with *four* params `(err, req, res, next)`.
  The arity is how Express detects it.
- **Static files** — `express.static()`. If Express serves the HTML page, page and
  API share an origin and CORS never comes up. Serve them separately and it will.

### Migrated to ESM (Sept 2026)
Project was CommonJS, which forced the awkward `import Express = require("express")`
syntax and would have made a `db.ts` module painful (`export =` allows only one
export per file). Fixed by adding `"type": "module"` to `package.json` — one line.

Now uses standard `import express from "express"`, which is what every modern
tutorial/example shows.

**ESM gotcha:** relative imports need a **`.js` extension**, even though the
files are `.ts`:
```ts
import { addReading } from "./db.js"   // correct — yes, .js
import { addReading } from "./db"      // fails at runtime
```
Looks wrong, is correct — the extension refers to the *output* file. Confuses
everyone once.

### Gotcha: Express 5 vs Express 4
`npm i express` now installs **Express 5**, but most tutorials and StackOverflow
answers target Express 4. Differences that cause confusion:
- Async errors propagate automatically (no more `express-async-handler`)
- Wildcard routes changed syntax — `/*` must be named, e.g. `/*splat`
- Make sure `@types/express` is v5 too, or types won't match runtime

### Validation
Don't trust the incoming payload. Reject humidity outside 0–100, temperature
outside −40–80. `zod` is the standard choice and infers TS types from the schema.
A shared secret in a request header is sufficient auth for a LAN project.

---

## 4. MicroPython on the ESP32

### Getting started
1. **USB driver first (Windows).** Most ESP32 boards use a CP2102 or CH340
   USB-serial chip; Windows 11 needs the driver. Unknown device in Device Manager
   instead of a COM port = this.
2. **Flash MicroPython** with `esptool` (`pip install esptool`) — erase flash, then
   write the ESP32 `.bin` from micropython.org/download.
3. **Thonny** is the friendliest way in — REPL, device file browser, handles the
   COM port. `mpremote` is the CLI equivalent later.

### Switched tooling: MicroPico → mpremote
MicroPico (VSCode extension) got unreliable, so switched to `mpremote` CLI
directly — same tool the extension likely wraps under the hood, minus the
flakiness layered on top.
```bash
pip install mpremote
mpremote connect list                        # find the COM port (CH340/wch.cn vendor ID = ESP32)
mpremote connect COM4 run ESP/main.py        # run without installing — good for testing
mpremote connect COM4 cp ESP/main.py :main.py    # install onto device (persists across reboots)
mpremote connect COM4                        # interactive REPL, Ctrl+] to exit
mpremote connect COM4 fs ls                  # list files actually on the device
```
**Gotcha:** `mpremote run <file>` only executes that one file — it does *not*
also upload other local files it imports (like `secrets.py`). Those have to be
`cp`'d onto the device separately first, or the run fails with
`ImportError: no module named 'secrets'` even though the file exists locally
right next to it. Device filesystem and local project folder are separate; this
tripped us up on first run.

The `pip install`ed `mpremote.exe` didn't land on `PATH` automatically — added
`...\Python314\Scripts` to user `PATH` so plain `mpremote` works in new
terminals (didn't apply retroactively to already-open ones).

### Step 0: verify the sensor from the REPL
```python
from machine import Pin
import dht
d = dht.DHT22(Pin(4))
d.measure(); print(d.temperature(), d.humidity())
```
Do this before writing Express. Finding a dead sensor on day three, tangled up
with "is my server broken?", is miserable.

### Pin choice matters
DHT-22 uses a bidirectional single-wire protocol, so the pin must do both input
and output.
- **GPIO 34–39 are input-only and will silently never work**
- Avoid strapping pins (0, 2, 12, 15) which affect boot
- **GPIO 4 is a safe default**

### Firmware notes
- **`boot.py` vs `main.py`** — both run at power-up, `boot.py` first. Convention:
  WiFi connection in `boot.py`, sensor loop in `main.py`. Credentials in a separate
  `secrets.py`.
- **`urequests`** isn't bundled in recent firmware — install on-device with
  `mip.install('urequests')` (needs WiFi up first). Slimmed-down `requests`:
  `urequests.post(url, json={...})`. **Always `.close()` the response** or you leak
  sockets and hang after a few hundred requests.
- **WiFi connect is boilerplate** — `network.WLAN(network.STA_IF)`, activate,
  connect, poll `isconnected()` with a timeout. Write once, reuse forever.
- **Wrap `measure()` in try/except** — the DHT-22 throws `OSError` on checksum
  failures fairly regularly. Skip the reading, don't crash the loop.
- **DHT-22 is slow** — minimum ~2s between reads. Once every 30–60s is plenty.

### Wiring
- 3.3V (not 5V) on ESP32
- 10kΩ pull-up between data and VCC — most breakout boards have it, bare sensors don't

### VSCode editor support for MicroPython imports (cosmetic, not functional)
Pylance can't resolve `machine`/`dht`/`network`/`urequests` by default — they're
firmware-builtin, not real pip packages, so imports show as unresolved and lose
autocomplete/highlighting. **This never affects actual execution** — MicroPico
talks to the device directly, separate from Pylance's static analysis.

Fix: `pip install -U micropython-esp32-stubs` (lands `.pyi` stub files loose in
that Python's site-packages), then point Pylance at that folder via
`.vscode/settings.json`:
```json
{
  "python.analysis.extraPaths": ["<path to that site-packages dir>"],
  "editor.semanticHighlighting.enabled": true
}
```
Reload window after creating/editing this file — Pylance caches analysis and
won't pick it up otherwise. Dot-autocomplete working is the real confirmation
it's resolved; full syntax coloring is theme-dependent and not worth chasing
further if completion already works.

---

## 5. Networking snags

- **`localhost` won't work from the ESP32.** It needs the PC's LAN IP (`ipconfig`
  on Windows, `ipconfig getifaddr en0` on macOS).
- **Windows Firewall will silently block that inbound connection.** Node has to be
  allowed through. This wastes a lot of evenings.
- **Stamp timestamps on the server** when readings arrive. The ESP32 has no real
  clock unless NTP is set up.

---

## 6. INA219 current monitoring (deferred)

Goal: measure consumption of the whole circuit.

### Sensor hookup is trivial — I2C, two pins
| INA219 | ESP32 |
|---|---|
| VCC | 3.3V |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

21/22 are conventional on ESP32 dev boards; MicroPython can remap. The DHT-22 on
GPIO 4 is unaffected — different protocol. I2C is a bus, so future I2C sensors
share the same two pins.

**Power it from 3.3V, not 5V** — these breakouts have I2C pull-ups tied to VCC, so
5V would put 5V on the ESP32's SDA/SCL lines.

### The real change: it sits *in series* with the supply
Current flows through the INA219's internal shunt from `Vin+` to `Vin−`.
Everything being measured hangs off `Vin−`:

```
supply + ──> [Vin+  INA219  Vin−] ──> ESP32 VIN (and everything else)
supply − ──────────────┬──────────────> common GND
                    (INA219 GND too — shared ground required for I2C)
```

Not "add a sensor" — it's "cut the positive supply line and route it through the
INA219."

**Consequence: this can't be done over USB power.** USB power enters through the
connector with nowhere to insert the shunt. Total-consumption measurement means
running from an external supply or battery into VIN, USB unplugged — so no serial
REPL while measuring. Fine, since the WiFi + Express server *is* the readout.

Caution: check whether the specific board tolerates USB and VIN connected at once.
Most have a protection diode; some back-feed.

### Limits
- Standard 0.1Ω shunt → current LSB ≈ **0.1 mA**
- ESP32 on WiFi draws ~80–150 mA, spikes past 250 mA on transmit — well in range,
  and the TX spikes are visible and interesting
- **Deep sleep (~10 µA) cannot be resolved** — it reads zero. Needs a different
  instrument or a much larger shunt.
- Mildly self-referential: it measures a circuit including the ESP32 that reads it.
  Taking and transmitting a measurement costs power that appears in the measurement.

### Verify from the REPL first
```python
from machine import Pin, I2C
i2c = I2C(0, scl=Pin(22), sda=Pin(21))
print([hex(a) for a in i2c.scan()])
```
Want `0x40` (default address) in that list. Empty = wiring or power, found in
thirty seconds instead of debugging a library.

MicroPython has **no built-in INA219 driver** (unlike `dht`) — `micropython-ina219`
is the common choice, via `mip` or copied to the device.

---

## 7. 18650 battery power (deferred)

### The core problem
An 18650 is 4.2V full, ~3.0V empty, nominal 3.7V. The ESP32 needs 3.3V — and the
battery range sits both **above and below** that. So it can't be wired directly
either way:

- **Into VIN** — the typical dev board's AMS1117 LDO needs ~4.5V+ input (~1.1V
  dropout). A 4.2V cell barely works at full charge and fails almost immediately.
  This is the classic mistake.
- **Straight to the 3.3V pin** — 4.2V exceeds the ESP32's 3.6V maximum. Risky.

### Regulator options
| Option | Notes |
|---|---|
| **Buck-boost to 3.3V** (e.g. TPS63020 module) | The correct answer. Handles input above *and* below output, uses the full cell. |
| **Low-dropout LDO** (e.g. HT7333, ~0.1V dropout) | Cheap, very low quiescent current, good for low-power. Cuts off ~3.4V, wasting the last chunk of capacity. |
| **Boost to 5V → VIN** | Simple, works with any dev board, but two conversions = wasteful. |

### Protection — the safety-critical part
18650 cells need over-discharge, over-charge, over-current and short protection.
Below ~2.5V permanently damages the cell; above 4.2V is a fire risk.

- **"Protected" cells** have a small PCB in the wrapper (they're ~2mm longer)
- **Unprotected cells** (laptop pulls, Samsung 30Q, etc.) need an external BMS
- **Check which one is on hand before anything else**

### Charging
- **TP4056 module** is the ubiquitous cheap Li-ion charger. Get the version
  **with** protection on board (DW01A + 8205A chips) — versions exist both ways.
  USB-C variants available.
- Charge current is set by a resistor (often 1A default; 0.5A is gentler)
- Don't leave it charging unattended the first few times

### Shopping list
- 18650 holder or JST connector
- Protected cell, or a BMS
- TP4056 **with** protection
- Buck-boost 3.3V module
- *or* skip all of the above with an all-in-one board: Adafruit Feather/HUZZAH32
  (JST battery connector, built-in charging, battery-voltage divider), or a LilyGo
  T-Energy style board with an 18650 holder built in

### Battery monitoring — synergy with the INA219
Placed between the battery and the regulator, the INA219 reports **both** bus
voltage (→ state of charge) and current draw. That's the ideal placement and it
avoids the ESP32 ADC entirely.

If using the ADC instead (voltage divider): **ADC1 pins only (GPIO 32–39)**.
ADC2 pins cannot be read while WiFi is active. ESP32 ADC is also notoriously
nonlinear and needs calibration.

### Deep sleep is the whole game
- WiFi always on: ~80–150 mA average → a 3000mAh cell lasts ~20–30 hours. Poor.
- Deep sleep between readings: wake every 60s, read, post, sleep. Active ~3–5s
  (WiFi connect dominates), sleeping ~10–20 µA → average 1–2 mA → weeks to months.

**Architectural consequence — worth honouring now:** deep sleep is a full reboot,
not a pause. `boot.py`/`main.py` run again from scratch and nothing persists
(except RTC memory). So **write `main.py` as "do one cycle and exit", not as
`while True:`**. Then switching to battery is adding one line —
`machine.deepsleep(60000)` — instead of a rewrite.

Other savings: a static IP instead of DHCP cuts a second or two off WiFi connect.
The DHT-22 draws ~1–1.5 mA continuously, which is significant next to a sleeping
ESP32 — it can be powered from a GPIO pin and cut during sleep.

---

## 8. Data model — decision: wide row

**Decided: wide row**, one row per reading, one column per metric.

```sql
CREATE TABLE readings (
  id INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  temperature REAL,
  humidity REAL
);
```

Simple queries, charts directly off a row. When the INA219 joins later, add
nullable columns (`voltage`, `current_ma`, `power_mw`) — a small migration at
that point, judged an acceptable tradeoff for staying simple now.

(Considered and rejected for now: a narrow `(device_id, metric, value,
timestamp)` table — adds sensors with zero schema changes, but needs a
filter+pivot to chart, more complexity than needed while there's only one
device.)

The in-memory array from step 2 should mirror this shape —
`{ timestamp, temperature, humidity }` per entry — so the eventual swap to
SQLite (step 6) is a storage-layer swap, not a reshape.

---

## 9. Database & visualization libraries

Decided for step 6 (DB) and step 5 (charts):

- **`better-sqlite3`** — single file, synchronous API (no `await` needed for
  local-file DB calls, unlike a networked DB). Node 22 also ships an
  experimental built-in `node:sqlite`, but `better-sqlite3` has far more
  tutorials/community for when something goes wrong — stick with it for now.
- **Raw SQL, no ORM** — prepared statements via `better-sqlite3`
  (`db.prepare('INSERT INTO readings ...').run(...)`). Prisma is overkill at
  this scale (codegen, its own schema DSL, migration engine). Drizzle is a
  reasonable *later* upgrade if the schema grows and hand-typing query results
  gets old — not needed to start.
- **No pandas-equivalent needed.** Danfo.js and Arquero exist (Arquero is the
  better-maintained of the two) but SQL aggregate queries (`GROUP BY`,
  `AVG()`, `strftime()` for time bucketing) do the same job *inside* SQLite,
  before data ever reaches JS — simpler and more efficient at this scale.
  Revisit only if a reshaping need comes up that SQL is genuinely awkward at.
- **Chart.js** for the graphs — canvas-based, drops into the static HTML page
  via a CDN `<script>` tag, no build step, standard choice for time-series line
  charts. (`uPlot` is the fallback if point counts ever get large enough that
  Chart.js gets sluggish — not a concern at this project's scale.)

### Market context (as of Sept 2026) — what industry does vs. what we chose

Project scope is deliberate: solo, personal, not scaling, backend-focused.
Choosing the simpler option *knowingly* where it differs from industry norm.

| Area | Industry standard | Ours | Why deviating is fine here |
|---|---|---|---|
| Framework | Express 5 still most-used; **Fastify** / **Hono** where new projects increasingly start | Express 5 | The "boring default" — most existing code uses it, transfers best |
| DB access | **Drizzle** for new TS projects; Prisma the heavier incumbent | Raw SQL + `better-sqlite3` | Actually learn SQL. Drizzle is a clean upgrade later |
| SQLite | Genuinely production-respectable now (Turso, Litestream, LiteFS) | SQLite | Not a compromise anymore — just correct |
| Validation | **zod** dominant (Valibot the lighter challenger) | zod | Keeping — cheap and universal |
| Testing | **vitest** has displaced jest; `supertest` for HTTP | A few route tests | Keeping a small version |
| Logging | `pino` structured JSON | `console.log` | pino exists for log *aggregation*; no aggregator here, no value |
| Frontend | React + Vite + Recharts for dashboards; **EJS is legacy, don't** | Static HTML + `fetch` + Chart.js | Backend is the learning focus; frontend deliberately minimal |
| Runtime | Node still default; Bun/Deno real but minority. Node 22+ built-ins (`--env-file`, `node:sqlite`, `node:test`) shrinking dep lists | Node 22 | Already current |

**Deliberately skipped:** React, pino, Docker, CI, ORM. ESLint optional for solo
work — TypeScript already catches most of what it would.

**Worth knowing:** for sensor telemetry specifically, many real teams wouldn't
hand-build a dashboard at all — they'd push into InfluxDB/TimescaleDB and point
**Grafana** at it. That's the genuine path of least resistance in industry for
this exact problem domain; it just teaches ops rather than programming.

Also notable: we're on **TypeScript 7**, the new Go-based native compiler port —
very recent, a real ecosystem shift.

### Operational notes ("living with the DB")
- DB file lives at e.g. `WebServer/data/readings.db` — **add to `.gitignore`**,
  same reasoning as `node_modules`: binary, constantly-changing, not source.
- Open **one connection at server startup**, reuse it for every request — no
  connection pool needed, it's just a file handle (unlike Postgres/MySQL).
- No formal migration tooling yet — `CREATE TABLE IF NOT EXISTS ...` run once
  at startup is enough until the schema is actually changing under you.

---

## 10. Progress log

Short dated entries — what got done, anything unexpected. Detailed how-tos live
in the sections above; this is just a timeline.

- **2026-08-28** — Flashed ESP32-WROOM-32 with MicroPython via esptool. Set up
  VSCode + MicroPico extension for on-device dev (no Thonny). Wired DHT-22 to
  GPIO 4 / 3.3V, confirmed working temperature/humidity reads from `main.py`.
- **2026-08-29** — Set up Express + TS project in `WebServer/`, using `tsx` (not
  nodemon alone — nodemon can't execute `.ts` by itself, needs `--exec tsx`) and
  `tsc --init` for `tsconfig.json`. `GET /health` route confirmed working via
  curl. Git repo initialized and pushed to GitHub (private).
  - **Gotcha hit:** `dev` script in `package.json` must point at the real
    entry file path (`WebServer/index.ts`), not a placeholder like `src/index.ts`
    — nodemon/tsx fail with `ERR_MODULE_NOT_FOUND` if the script and actual file
    location drift apart. Worth double-checking after moving/renaming files.
  - Switched `dev` script from `nodemon --exec tsx ...` to plain `tsx watch ...`,
    dropped the `nodemon` dependency. See section 3.
  - **`EADDRINUSE` isn't usually a real bug** — it almost always means a dev
    server from an earlier terminal (yours, or a test one) is still holding the
    port. Check `Get-NetTCPConnection -LocalPort <port>` for the PID before
    assuming the code is broken.
  - Started step 2: added `POST /api/readings` and `GET /api/readings` route
    stubs. Caught a bug before it caused confusion — `app.get("api/readings", ...)`
    was missing its leading slash; Express route paths must start with `/`.
  - Decided DB/viz stack ahead of steps 5–6: `better-sqlite3` + raw SQL (no
    ORM) + Chart.js. Decided data model: **wide row**, not narrow
    metric-per-row. See sections 8–9.
  - Progress check-in: fixed the missing-slash bug. `npm install`ed
    `better-sqlite3`/`@types/better-sqlite3` already (ahead of step 6, fine).
    Step 2 still needs: `express.json()` middleware (not yet added — `req.body`
    will be `undefined` without it), a `Reading` type, the in-memory array
    itself, and real `POST`/`GET` logic (currently a hardcoded string and an
    empty handler that never responds).
  - **Step 2 completed.** Verified round-trip with curl: POST stores + stamps
    timestamp server-side, GET returns the array, empty array on fresh start.
    (Hit a red herring while testing — a zombie `tsx` process from an earlier
    test survived a `kill` on its parent PID and kept answering with stale
    data. `kill $PID` on a backgrounded `npx ...` doesn't reliably kill the
    child process it spawns; had to `Stop-Process` the actual PID bound to the
    port instead. Not a bug in the app code.)
- **2026-09-12** — **Step 4 completed.** Switched from MicroPico to `mpremote`
  CLI (see section 4). Fixed `connect_wifi()` never being called (defined but
  unused — same class of bug as before). Confirmed Windows Firewall already
  allowed Node inbound on both network profiles — no config needed. Ran the
  real ESP32 + DHT-22 end to end: connected to WiFi, read the sensor, POSTed to
  the Express server, got `201` back, confirmed the readings landed via
  `GET /api/readings`. Installed `main.py`/`secrets.py` onto the device so it
  now runs standalone on power-up, no laptop tether required.
- **2026-09-13** — Decided project direction: backend-focused, deliberately
  simple, frontend minimal. Logged market context in section 9 (what industry
  does vs. what we chose, and why each deviation is fine at this scale).
  Migrated project to ESM (see section 3).
  **Step 6 + 6b completed:** `WebServer/db.ts` owns the storage layer —
  connection, `CREATE TABLE IF NOT EXISTS` at startup, prepared statements, and
  `addReading`/`getReadings` exports. `index.ts` route handlers barely changed,
  since the in-memory array was already shaped to match the schema.
  Verified persistence by POSTing, killing the process, restarting, and
  confirming rows survived.
  - **Gotcha:** importing `Reading` from `db.ts` while the old local
    `interface Reading` was still in `index.ts` → `TS2440: Import declaration
    conflicts with local declaration`. Delete the local copy when moving a type
    into a module.
  - **Gotcha:** used `"Webserver/data"` (lowercase `s`) vs the real `WebServer/`
    folder. Windows is case-insensitive so it worked silently; Linux would
    break. Worth watching if this ever moves to the MacBook/CI.
- **2026-09-16** — **Steps 8a + 5 completed.**
  **zod validation:** `ReadingInput` schema validates the POST body with
  `safeParse` → `400` + `error.issues` on failure, `201` on success. Schema
  covers the DHT-22's *physical* ranges (temp -40..80, humidity 0..100), not
  just types — so `humidity: 150` is rejected even though it's a valid number.
  Demonstrated the gap first: pre-validation, `{"temperature":"hello"}` returned
  `201` and SQLite stored the string in a `REAL` column (SQLite uses *type
  affinity* — declared column types are hints, not constraints; it stores what
  it can't convert as-is). That bad row has been deleted.
  - Schema deliberately describes the *incoming payload only* (no `timestamp`)
    — the server stamps time, clients don't get to. Stored shape ≠ accepted shape.
  - `safeParse` not `parse`: invalid client input is expected, deserves a `400`,
    not a thrown exception.
  - Result is a discriminated union — after the `!parsed.success` guard, TS
    knows `parsed.data` is `{temperature: number, humidity: number}`. Runtime
    check and compile-time type agree because one produced the other.
    (`z.infer<typeof Schema>` derives the type if you need it by name.)
  - **Gotcha:** wrote `const ReadingInput: z.ZodObject({...})` — two bugs, `:`
    instead of `=`, and `z.ZodObject` (the *type*) instead of `z.object()` (the
    *factory function*). Produced `TS1005` on line 7, but the editor squiggled
    line 26 — a **syntax** error means the parser gave up, so reported positions
    after it are guesswork. Always fix the first error first.
  **Frontend:** `WebServer/public/index.html` — Chart.js 4 via CDN (UMD build,
  global `Chart`, no bundler), dual Y-axis line chart (temp left, humidity
  right — different units/ranges would flatten each other on a shared axis),
  stat tiles, 5s polling via `setInterval` + `fetch`. Served by
  `app.use(express.static("WebServer/public"))`, so page and API share an
  origin and CORS never comes up.
  - Charts only the last `MAX_POINTS = 100` client-side. Proper fix later is a
    `GET /api/readings?limit=100` param so the whole table isn't shipped every
    5 seconds.
  - Also deleted the dead `const readings: Reading[] = []` from `index.ts` —
    leftover from before SQLite.
- **2026-09-18** — **Dashboard rebuilt** with separate per-metric charts, four
  time ranges, and real statistics. Stayed vanilla (no React) — see reasoning
  below.
  **New endpoint `GET /api/series?range=15m|1h|1d|1w`** returning bucketed
  points + summary stats. `range` validated with `z.enum().default("1h")`.
  - **Why this is backend work, not frontend work:** at 2s posting intervals a
    1-week range is ~300k rows. Shipping those to a browser to draw a 900px
    chart is the actual problem, and no frontend framework helps. SQL
    aggregation does: 1d now collapses ~22k rows → 63 points, 1w ~35k → 31.
  - Bucket sizes chosen per range to land on ~60-170 points: 15m/15s, 1h/1min,
    1d/15min, 1w/1h.
  - Stats computed **in SQL** (`COUNT/MIN/MAX/AVG`), never by loading rows — so
    cost is flat whether the range holds 400 rows or 400,000. SQLite has no
    `stddev`, so `AVG(x*x)` is selected and variance derived as E[x²] - E[x]²
    with the square root taken in JS.
  - Added `CREATE INDEX idx_readings_timestamp` — every range query filters and
    sorts on `timestamp`; without it SQLite scans the whole table each time.
  - **Serious gotcha (silent, plausible-looking wrong answer):**
    `(timestamp / ?) * ?` did **no bucketing at all**. better-sqlite3 binds JS
    numbers as **REAL** (JS has only doubles), so the division was
    floating-point — `1789715032236 / 15000 = 119314335.4824` — giving every row
    a unique fractional bucket, so `GROUP BY` grouped nothing and returned one
    bucket per row. The endpoint looked fine; only the bucket-count-equals-row-
    count tell gave it away. Fix: `CAST(timestamp / ? AS INTEGER) * ?`.
    Lesson: check the *numbers*, not just the status code.
  **Frontend:** separate temperature and humidity charts, each showing avg line
  + min/max band per bucket (band preserves volatility an average would hide),
  range tabs, per-metric min/avg/max/stddev/change, plus dew point (Magnus
  formula), sample rate, coverage %, bucket resolution, and a liveness dot
  (live / stale / offline based on newest reading age — tells you the sensor
  died rather than showing a flat line).
  - **Deliberately no React/Vite**, despite it being offered: the page is four
    buttons and two charts. A framework would add a second `package.json`, a
    build step and a dev-server proxy for no gain, against a stated preference
    for backend focus. Revisit if the UI grows real state.
- **2026-10-01** — Added `README.md` (GitHub-facing setup tutorial, clone →
  flash → wire → configure → upload → dashboard, plus API reference and
  troubleshooting) and `ESP/secrets.example.py` as a committed template, since
  `secrets.py` itself is gitignored. Verified the README's commands against the
  real tools: esptool v5 uses hyphenated `erase-flash`/`write-flash`;
  `mpremote mip install urequests` installs from the host, so the device needs
  no WiFi for that step. Confirmed `secrets.py` was never committed to history.
  - The startup banner lists *every* adapter as a "Network" address (VPN,
    VirtualBox `192.168.56.x`, link-local `169.254.x`) and labels each one
    "use this in SERVER_URL" — only the LAN one works. README explains how to
    pick; filtering link-local/virtual adapters in `index.ts` would be a small
    cleanup.
- **2026-10-01** — **Dashboard redesigned for chart readability**, using the
  `frontend-design` plugin (installed mid-session, so its SKILL.md was read
  from the plugin cache rather than loaded) plus the `dataviz` guidance.
  Still vanilla HTML + Chart.js, no build step. Verified by headless-Chrome
  screenshots of every range, dark mode, a true 390px width (via an iframe —
  headless Chrome won't go below ~500px window width) and a simulated hover.
  - **Concept:** hygrothermograph — the analog instrument that pens
    temperature and humidity on two separate gridded charts, red and blue ink.
    Palette validated with the dataviz script in both modes (dark inks first
    failed the lightness band and were stepped down). Follows the OS light/dark
    setting. Typeface: Atkinson Hyperlegible Next (designed for legibility).
  - **Readability fixes, most important first:**
    - *Gaps are now honest.* The server only returns non-empty buckets; the
      client lays them onto a full time grid, so outages show as breaks instead
      of a line silently joined across hours. Caught a real one on first render
      (11:30–11:44, when no server was running).
    - *No zooming into noise.* Y-axis has a minimum span (2 °C / 6 %) so the
      DHT-22's 0.1-step jitter doesn't look like a swing.
    - *Selective direct labels:* current value at the line end, High/Low marked
      on the band — suppressed when next to the end point to avoid doubling.
    - *Tooltip* says what a point covers ("Thu 01:30–01:45"), value first,
      then range and reading count; crosshair hairline under the data.
    - *Regular x labels* (every 3 h, each midnight, each day) instead of
      autoSkip's picks; step doubles on narrow screens.
    - Text in ink colours, identity via pen-stroke keys; change described in
      words ("rose 0.6 %"), not green/red — warmer isn't "good".
    - Table view ("Show the numbers") under every chart; range kept in the URL
      hash so views are bookmarkable (`/#1w`).
  - **Gotcha:** `.empty { display: flex }` overrode the browser's `[hidden]`
    rule, so the "No readings" message showed on top of real data. Fixed with
    a global `[hidden] { display: none !important }`.
  - **Gotcha:** coverage % was first-to-last-reading span, so it said 100%
    across a visible outage. Now counts non-empty buckets.
- **2026-10-01** — **Theme switch + README screenshots.** Dark theme existed
  but only via the OS setting; added a "Dark theme" toggle (`aria-pressed`)
  that's remembered in `localStorage`. Restructured so dark tokens live in one
  `:root[data-theme="dark"]` block, and a tiny inline `<head>` script sets
  `data-theme` before first paint (saved choice, else OS) — no light flash.
  With no saved choice it keeps following OS changes. Charts are rebuilt on
  switch because Chart.js reads colours from CSS tokens only at build time.
  README now has light (24 h) and dark (7 d) screenshots in
  `docs/screenshots/`, captured at 2× with headless Chrome, and an updated
  features list / step 9 / troubleshooting.
  - **Gotcha (headless Chrome):** with Chrome already open, `--headless
    --screenshot` silently hands off to the running browser and writes
    nothing. Needs its own `--user-data-dir`.
