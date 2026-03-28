from __future__ import annotations

from datetime import timedelta

from homeassistant.const import Platform

DOMAIN = "bluestar"
PLATFORMS: list[Platform] = [Platform.CLIMATE]

SERVICE_EXECUTE_COMMAND = "execute_command"
SERVICE_FORCE_SYNC = "force_sync"
SERVICE_SEND_RAW_PATCH = "send_raw_patch"

CONF_AUTH_ID = "auth_id"
CONF_PASSWORD = "password"

BASE_URL = "https://n3on22cp53.execute-api.ap-south-1.amazonaws.com/prod"
LOGIN_URL = f"{BASE_URL}/auth/login"
THINGS_URL = f"{BASE_URL}/things"

APP_VERSION_HEADER = "v4.13.12-148"
OS_NAME_HEADER = "Android"
OS_VERSION_HEADER = "v15-35"
USER_AGENT_HEADER = "com.bluestarindia.bluesmart"

AWS_REGION = "ap-south-1"
AWS_IOT_SERVICE = "iotdevicegateway"
MQTT_KEEPALIVE_SECONDS = 30

DEFAULT_SCAN_INTERVAL = timedelta(minutes=10)

SOURCE_KEY = "src"
SOURCE_MQTT = "anmq"
SOURCE_WLAN = "anlan"
SOURCE_BLE = "anble"

FORCE_SYNC_KEY = "fpsh"
