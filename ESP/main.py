from machine import Pin
import dht
import time

sensor = dht.DHT22(Pin(4))

while True:
    try:
        sensor.measure()
        temp = sensor.temperature()
        hum = sensor.humidity()
        print("Temp: {}C  Humidity: {}%".format(temp, hum))
    except OSError as e:
        print("Read failed:", e)
    time.sleep(2)