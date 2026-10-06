# Copy this file to secrets.py and fill it in. secrets.py is gitignored, so
# your real credentials never get committed.
WIFI_SSID = "your-network-name"
WIFI_PASSWORD = "your-wifi-password"

# Where readings go. On your own network, the server's Network address:
#   SERVER_URL = "http://192.168.0.208:3001/api/readings"
# Over the internet, the HTTPS address the server is published at:
#   SERVER_URL = "https://example.com/sensor/api/readings"
SERVER_URL = "http://192.168.0.208:3001/api/readings"

# Must match SENSOR_TOKEN on the server. Leave empty if the server has none.
SENSOR_TOKEN = ""

# For https:// only: check the server's certificate against ca.pem, so nobody
# on the way can pose as the server and collect the token. Turn off only to
# rule it out while debugging.
VERIFY_TLS = True
