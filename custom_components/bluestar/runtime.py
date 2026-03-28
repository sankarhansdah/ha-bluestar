from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .api import BluestarApiClient, BluestarApiError, BluestarAuthError
from .models import BrokerInfo, ThingData
from .mqtt import BluestarMqttClient
from .protocol import (
    COMMAND_CATALOG,
    COMMAND_DELAY_MS,
    BluestarProtocolError,
    apply_optimistic_payload,
    build_exact_command_sequence,
)


class BluestarRuntime:
    """Holds auth state, device cache, and the MQTT bridge."""

    def __init__(self, hass: HomeAssistant, api: BluestarApiClient) -> None:
        self.hass = hass
        self.api = api
        self.devices: dict[str, ThingData] = {}
        self.ready = False

        self._session_id: str | None = None
        self._broker_info: BrokerInfo | None = None
        self._mqtt: BluestarMqttClient | None = None
        self._update_callback: Callable[[dict[str, ThingData]], None] | None = None

    def set_update_callback(self, callback: Callable[[dict[str, ThingData]], None]) -> None:
        self._update_callback = callback

    @property
    def mqtt_connected(self) -> bool:
        return self._mqtt is not None and self._mqtt.is_connected

    @property
    def command_catalog(self) -> tuple[dict[str, Any], ...]:
        return COMMAND_CATALOG

    async def async_refresh_devices(self, force_login: bool = False) -> dict[str, ThingData]:
        session_changed = False
        if force_login or self._session_id is None or self._broker_info is None:
            login = await self.api.async_login()
            session_changed = login.session_id != self._session_id or login.broker_info != self._broker_info
            self._session_id = login.session_id
            self._broker_info = login.broker_info

        assert self._session_id is not None

        try:
            payload = await self.api.async_get_things(self._session_id)
        except BluestarAuthError:
            if force_login:
                raise
            return await self.async_refresh_devices(force_login=True)

        devices = self._parse_devices(payload)
        self.devices = devices

        if session_changed or self._mqtt is None:
            await self._async_restart_mqtt()
        elif self._mqtt is not None:
            await self.hass.async_add_executor_job(self._mqtt.update_thing_ids, set(self.devices))

        self.ready = True
        self._push_updates()
        return self.devices

    async def async_send_state_update(self, thing_id: str, payload: dict[str, Any]) -> None:
        thing = self.devices.get(thing_id)
        if thing is None:
            raise HomeAssistantError(f"Unknown Blue Star device: {thing_id}")

        await self._async_publish_payload(thing, payload)

    async def async_execute_exact_command(self, thing_id: str, command: str, params: dict[str, Any] | None = None) -> None:
        thing = self.devices.get(thing_id)
        if thing is None:
            raise HomeAssistantError(f"Unknown Blue Star device: {thing_id}")

        try:
            sequence = build_exact_command_sequence(thing, command, params or {})
        except BluestarProtocolError as err:
            raise HomeAssistantError(str(err)) from err

        if not sequence:
            raise HomeAssistantError(f"Exact command produced no payloads: {command}")

        for index, payload in enumerate(sequence):
            await self._async_publish_payload(thing, payload)
            if index < len(sequence) - 1:
                await asyncio.sleep(COMMAND_DELAY_MS / 1000)

    async def async_force_sync(self, thing_id: str) -> None:
        if self._mqtt is None or not self._mqtt.is_connected:
            raise HomeAssistantError("Blue Star MQTT client is not connected")

        await self.hass.async_add_executor_job(self._mqtt.force_sync, thing_id)

    async def async_shutdown(self) -> None:
        mqtt_client = self._mqtt
        self._mqtt = None
        if mqtt_client is not None:
            await self.hass.async_add_executor_job(mqtt_client.disconnect)

    def handle_state_report(self, thing_id: str, payload: dict[str, Any]) -> None:
        device = self.devices.get(thing_id)
        if device is None:
            return

        try:
            report_type = int(payload.get("type", -1))
        except (TypeError, ValueError):
            return
        if report_type != 0:
            return

        if device.state.merge_report(payload):
            self._push_updates()

    def handle_presence(self, thing_id: str, connected: bool, timestamp: int) -> None:
        device = self.devices.get(thing_id)
        if device is None:
            return

        if device.state.update_presence(connected, timestamp):
            self._push_updates()

    def _parse_devices(self, payload: dict[str, Any]) -> dict[str, ThingData]:
        raw_things = payload.get("things") or []
        raw_states = payload.get("states") or {}
        devices: dict[str, ThingData] = {}

        if not isinstance(raw_things, list):
            raise BluestarApiError(200, code="invalid_things_response", message="`things` was not a list")

        if not isinstance(raw_states, dict):
            raw_states = {}

        for raw_thing in raw_things:
            if not isinstance(raw_thing, dict):
                continue

            thing_id = str(raw_thing.get("id") or raw_thing.get("thing_id") or "").strip()
            if not thing_id:
                continue

            device = ThingData.from_api(raw_thing, raw_states.get(thing_id))
            previous = self.devices.get(thing_id)
            if previous is not None:
                device.merge_runtime_state(previous)
            devices[thing_id] = device

        return devices

    async def _async_restart_mqtt(self) -> None:
        if self._broker_info is None or self._session_id is None:
            return

        previous = self._mqtt
        self._mqtt = BluestarMqttClient(
            broker_info=self._broker_info,
            session_id=self._session_id,
            thing_ids=set(self.devices),
            state_callback=self.handle_state_report,
            presence_callback=self.handle_presence,
        )

        if previous is not None:
            await self.hass.async_add_executor_job(previous.disconnect)
        await self.hass.async_add_executor_job(self._mqtt.connect)

    async def _async_publish_payload(self, thing: ThingData, payload: dict[str, Any]) -> None:
        if self._mqtt is None or not self._mqtt.is_connected:
            raise HomeAssistantError("Blue Star MQTT client is not connected")

        message = dict(payload)
        message["ts"] = int(message.get("ts") or (time.time() * 1000))
        await self.hass.async_add_executor_job(self._mqtt.publish_shadow_update, thing.id, message)
        apply_optimistic_payload(thing, message, int(message["ts"]))
        self._push_updates()

    def _push_updates(self) -> None:
        if self._update_callback is None:
            return

        snapshot = dict(self.devices)
        self.hass.loop.call_soon_threadsafe(self._update_callback, snapshot)
