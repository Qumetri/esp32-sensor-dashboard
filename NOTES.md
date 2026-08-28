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
- [ ] **Step 1** — Bare Express + TS, one `GET /health` — get the dev loop and tsconfig working
- [ ] **Step 2** — `POST /api/readings` + `GET /api/readings`, in-memory array — test with curl
- [ ] **Step 3** — Python fake sensor on the laptop — decouples "is the server right?" from "is the ESP32 right?"
- [ ] **Step 4** — ESP32 posting for real
- [ ] **Step 5** — Static page: table → Chart.js
- [ ] **Step 6** — Swap array for SQLite
- [ ] **Step 7** — Replace polling with SSE
- [ ] **Step 8** — Polish: zod validation, error middleware, auth header, config
- [ ] Later — INA219 current monitoring
- [ ] Later — 18650 battery power + deep sleep restructure

---

## 3. Express + TypeScript

### Setup
- `typescript`, `@types/node`, `@types/express`
- `tsx` to run TS directly with a watch mode (simpler than the older `ts-node-dev`).
  Node 22+ can run TS natively too, but tsx is less fussy.

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

## 8. Data model note

Once the INA219 joins, a reading grows from `{temp, humidity}` to roughly
`{temp, humidity, bus_voltage, current_ma, power_mw}`.

**Design the schema for that at step 2**, rather than hardcoding two fields and
rewriting the API and SQLite table later. Two approaches to weigh:

- A **wide row** with nullable columns — simple, easy to query, needs a migration
  per new metric
- A **narrow `(device_id, metric, value, timestamp)` table** — add sensors freely
  with no migrations, slightly more work to query and chart

---

## 9. Progress log

Short dated entries — what got done, anything unexpected. Detailed how-tos live
in the sections above; this is just a timeline.

- **2026-08-28** — Flashed ESP32-WROOM-32 with MicroPython via esptool. Set up
  VSCode + MicroPico extension for on-device dev (no Thonny). Wired DHT-22 to
  GPIO 4 / 3.3V, confirmed working temperature/humidity reads from `main.py`.
