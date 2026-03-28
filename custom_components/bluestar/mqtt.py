from __future__ import annotations

import hashlib
import hmac
import json
import logging
import ssl
import threading
from collections.abc import Callable, Collection
from datetime import datetime, timezone
from urllib.parse import quote, urlencode

import paho.mqtt.client as mqtt

from .const import (
    AWS_IOT_SERVICE,
    AWS_REGION,
    FORCE_SYNC_KEY,
    MQTT_KEEPALIVE_SECONDS,
    SOURCE_KEY,
    SOURCE_MQTT,
)
from .models import BrokerInfo

_LOGGER = logging.getLogger(__name__)


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _build_signed_websocket_path(broker_info: BrokerInfo) -> str:
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    credential_scope = f"{date_stamp}/{AWS_REGION}/{AWS_IOT_SERVICE}/aws4_request"

    query_params = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{broker_info.access_key}/{credential_scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": "86400",
        "X-Amz-SignedHeaders": "host",
    }

    canonical_querystring = urlencode(
        sorted(query_params.items()),
        quote_via=quote,
        safe="~",
    )
    canonical_headers = f"host:{broker_info.endpoint}\n"
    payload_hash = hashlib.sha256(b"").hexdigest()
    canonical_request = "\n".join(
        [
            "GET",
            "/mqtt",
            canonical_querystring,
            canonical_headers,
            "host",
            payload_hash,
        ]
    )

    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )

    k_date = _sign(f"AWS4{broker_info.secret_key}".encode("utf-8"), date_stamp)
    k_region = _sign(k_date, AWS_REGION)
    k_service = _sign(k_region, AWS_IOT_SERVICE)
    k_signing = _sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    return f"/mqtt?{canonical_querystring}&X-Amz-Signature={signature}"


class BluestarMqttClient:
    """Threaded MQTT client for Blue Star AWS IoT traffic."""

    def __init__(
        self,
        broker_info: BrokerInfo,
        session_id: str,
        thing_ids: Collection[str],
        state_callback: Callable[[str, dict], None],
        presence_callback: Callable[[str, bool, int], None],
    ) -> None:
        self._broker_info = broker_info
        self._session_id = session_id
        self._thing_ids = set(thing_ids)
        self._state_callback = state_callback
        self._presence_callback = presence_callback
        self._client: mqtt.Client | None = None
        self._connected = threading.Event()
        self._subscribed_topics: set[str] = set()
        self._lock = threading.Lock()

    @property
    def is_connected(self) -> bool:
        return self._connected.is_set()

    def connect(self) -> None:
        with self._lock:
            self.disconnect()

            client = mqtt.Client(
                client_id=f"u-{self._session_id}",
                transport="websockets",
                protocol=mqtt.MQTTv311,
                clean_session=True,
            )
            client.enable_logger(_LOGGER)
            client.tls_set_context(ssl.create_default_context())
            client.ws_set_options(path=_build_signed_websocket_path(self._broker_info))
            client.on_connect = self._on_connect
            client.on_disconnect = self._on_disconnect
            client.on_message = self._on_message
            client.connect_async(self._broker_info.endpoint, port=443, keepalive=MQTT_KEEPALIVE_SECONDS)
            client.loop_start()
            self._client = client

    def disconnect(self) -> None:
        client = self._client
        self._client = None
        self._connected.clear()
        self._subscribed_topics.clear()

        if client is None:
            return

        try:
            client.disconnect()
        finally:
            client.loop_stop()

    def update_thing_ids(self, thing_ids: Collection[str]) -> None:
        self._thing_ids = set(thing_ids)
        if self._client is None or not self.is_connected:
            return

        desired_topics = self._desired_topics()
        to_subscribe = desired_topics - self._subscribed_topics
        to_unsubscribe = self._subscribed_topics - desired_topics

        for topic in to_subscribe:
            self._client.subscribe(topic, qos=1)
        for topic in to_unsubscribe:
            self._client.unsubscribe(topic)

        self._subscribed_topics = desired_topics

    def publish_shadow_update(self, thing_id: str, payload: dict) -> None:
        if self._client is None:
            raise RuntimeError("MQTT client is not initialized")

        message = dict(payload)
        message[SOURCE_KEY] = SOURCE_MQTT
        wrapped = {"state": {"desired": message}}
        self._client.publish(
            f"$aws/things/{thing_id}/shadow/update",
            json.dumps(wrapped, separators=(",", ":")),
            qos=0,
        )

    def force_sync(self, thing_id: str) -> None:
        if self._client is None:
            raise RuntimeError("MQTT client is not initialized")

        self._client.publish(
            f"things/{thing_id}/control",
            json.dumps({FORCE_SYNC_KEY: 1}, separators=(",", ":")),
            qos=0,
        )

    def _desired_topics(self) -> set[str]:
        topics: set[str] = set()
        for thing_id in self._thing_ids:
            topics.add(f"things/{thing_id}/state/reported")
            topics.add(f"$aws/events/presence/+/{thing_id}")
        return topics

    def _on_connect(self, client: mqtt.Client, userdata, flags, reason_code, properties=None) -> None:
        rc = getattr(reason_code, "value", reason_code)
        if rc != 0:
            _LOGGER.warning("Blue Star MQTT connect failed with reason code %s", rc)
            self._connected.clear()
            return

        self._connected.set()
        self._subscribed_topics.clear()
        for topic in self._desired_topics():
            client.subscribe(topic, qos=1)
        self._subscribed_topics = self._desired_topics()
        _LOGGER.debug("Blue Star MQTT connected")

    def _on_disconnect(self, client: mqtt.Client, userdata, reason_code, properties=None) -> None:
        self._connected.clear()
        self._subscribed_topics.clear()
        rc = getattr(reason_code, "value", reason_code)
        _LOGGER.debug("Blue Star MQTT disconnected: %s", rc)

    def _on_message(self, client: mqtt.Client, userdata, message: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(message.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            _LOGGER.debug("Ignoring non-JSON Blue Star MQTT payload on %s", message.topic)
            return

        topic = message.topic
        if topic.startswith("things/") and topic.endswith("/state/reported"):
            thing_id = topic.split("/")[1]
            if isinstance(payload, dict):
                self._state_callback(thing_id, payload)
            return

        if topic.startswith("$aws/events/presence/"):
            try:
                thing_id = topic.rsplit("/", 1)[1]
                connected = "disconnected" not in topic
                timestamp = int(payload.get("timestamp", 0))
            except (TypeError, ValueError, AttributeError):
                return
            self._presence_callback(thing_id, connected, timestamp)
