from machine import Pin
import dht
import time
import network
import mip
import urequests
from secrets import WIFI_SSID, WIFI_PASSWORD

# mip.install("urequests")


def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        wlan.connect(WIFI_SSID, WIFI_PASSWORD)
        timeout = 10
        while not wlan.isconnected() and timeout > 0:
            time.sleep(1)
            timeout -= 1
    if wlan.isconnected():
        print("Connected, IP:", wlan.ifconfig()[0])
    else:
        print("WiFi connection failed")


sensor = dht.DHT22(Pin(4))
SERVER_URL = "http://192.168.0.208:3001/api/readings"
# One reading a minute: room air changes slowly, and every post is a DB write.
INTERVAL_MS = 60 * 1000


def send_reading(temp, hum):
    try:
        response = urequests.post(
            SERVER_URL, json={"temperature": temp, "humidity": hum}
        )
        print("Server responded:", response.status_code)
        response.close()
    except Exception as e:
        print("POST failed:", e)


connect_wifi()

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
