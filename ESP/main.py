# Firmware: read the DHT-22 once a minute and POST it to the dashboard server.
# All settings live in secrets.py (template: secrets.example.py).
from machine import Pin
import dht
import json
import network
import socket
import time
import secrets as cfg

SERVER_URL = cfg.SERVER_URL
SENSOR_TOKEN = getattr(cfg, "SENSOR_TOKEN", "")
VERIFY_TLS = getattr(cfg, "VERIFY_TLS", True)
CA_FILE = "ca.pem"
# One reading a minute: room air changes slowly, and every post is a DB write.
INTERVAL_MS = 60 * 1000

sensor = dht.DHT22(Pin(4))
wlan = network.WLAN(network.STA_IF)


def connect_wifi():
    """Connect if not connected. Called before every post, so a router reboot
    or a dropped link heals by itself instead of needing a power cycle."""
    if wlan.isconnected():
        return True
    wlan.active(True)
    try:
        wlan.disconnect()  # clears a half-finished attempt, or connect() errors
    except OSError:
        pass
    wlan.connect(cfg.WIFI_SSID, cfg.WIFI_PASSWORD)
    for _ in range(15):
        if wlan.isconnected():
            print("Connected, IP:", wlan.ifconfig()[0])
            return True
        time.sleep(1)
    print("WiFi connection failed")
    return False


clock_set = False


def set_clock():
    """Certificates are only valid between two dates, and the ESP32 boots
    thinking it's 2000. Retried on every post until it works once."""
    global clock_set
    if clock_set:
        return
    try:
        import ntptime
        ntptime.settime()
        clock_set = True
    except Exception as e:
        print("Clock sync failed:", e)


def tls_context():
    import ssl
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    if VERIFY_TLS:
        ctx.verify_mode = ssl.CERT_REQUIRED
        with open(CA_FILE) as f:
            ctx.load_verify_locations(cadata=f.read())
    else:
        if hasattr(ctx, "check_hostname"):
            ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


HTTPS = SERVER_URL.startswith("https:")
ctx = tls_context() if HTTPS else None


def post(body):
    """POST body to SERVER_URL and return the HTTP status code. Written out by
    hand because urequests never checks the server's certificate."""
    proto, _, hostport, path = SERVER_URL.split("/", 3)
    host, port = hostport, (443 if HTTPS else 80)
    if ":" in hostport:
        host, port = hostport.split(":", 1)
        port = int(port)
    addr = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)[0][-1]
    s = socket.socket()
    try:
        s.settimeout(20)
        s.connect(addr)
        if HTTPS:
            s = ctx.wrap_socket(s, server_hostname=host)
        head = "POST /{} HTTP/1.0\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n".format(
            path, hostport, len(body))
        if SENSOR_TOKEN:
            head += "X-Sensor-Token: {}\r\n".format(SENSOR_TOKEN)
        s.write(head.encode() + b"\r\n" + body)
        return int(s.readline().split()[1])
    finally:
        s.close()


def send_reading(temp, hum):
    try:
        if not connect_wifi():
            return
        if HTTPS and VERIFY_TLS:
            set_clock()
        status = post(json.dumps({"temperature": temp, "humidity": hum}).encode())
        print("Server responded:", status)
        if status == 401:
            print("  -> SENSOR_TOKEN in secrets.py doesn't match the server's")
    except Exception as e:
        print("POST failed:", e)
        # -9984 is MBEDTLS_ERR_X509_CERT_VERIFY_FAILED
        if HTTPS and VERIFY_TLS and ("X509" in str(e) or "-9984" in str(e)):
            print("  -> certificate check failed: update ca.pem, or set VERIFY_TLS = False to rule it out")


while True:
    started = time.ticks_ms()
    try:
        sensor.measure()
        temp = sensor.temperature()
        hum = sensor.humidity()
        print("Temp: {}C  Humidity: {}%".format(temp, hum))
        send_reading(temp, hum)
    except OSError as e:
        print("Read failed:", e)
    # Sleep for what's left of the interval, so measuring and posting don't
    # make each cycle drift past 60 s.
    elapsed = time.ticks_diff(time.ticks_ms(), started)
    time.sleep_ms(max(0, INTERVAL_MS - elapsed))
