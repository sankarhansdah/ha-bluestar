from __future__ import annotations

from dataclasses import dataclass

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import BluestarApiClient
from .const import (
    CONF_AUTH_ID,
    CONF_PASSWORD,
    DOMAIN,
    PLATFORMS,
    SERVICE_EXECUTE_COMMAND,
    SERVICE_FORCE_SYNC,
    SERVICE_SEND_RAW_PATCH,
)
from .coordinator import BluestarCoordinator
from .runtime import BluestarRuntime


@dataclass(slots=True)
class BluestarEntryData:
    api: BluestarApiClient
    coordinator: BluestarCoordinator
    runtime: BluestarRuntime


def _resolve_entry_data(hass: HomeAssistant, entry_id: str | None) -> BluestarEntryData:
    entries: dict[str, BluestarEntryData] = hass.data.get(DOMAIN, {})
    if entry_id:
        data = entries.get(entry_id)
        if data is None:
            raise HomeAssistantError(f"Unknown Blue Star entry_id: {entry_id}")
        return data

    if len(entries) == 1:
        return next(iter(entries.values()))

    raise HomeAssistantError("Multiple Blue Star entries are configured; provide entry_id")


async def _async_handle_execute_command(hass: HomeAssistant, call: ServiceCall) -> None:
    data = _resolve_entry_data(hass, call.data.get("entry_id"))
    await data.runtime.async_execute_exact_command(
        call.data["thing_id"],
        call.data["command"],
        call.data.get("params") or {},
    )


async def _async_handle_force_sync(hass: HomeAssistant, call: ServiceCall) -> None:
    data = _resolve_entry_data(hass, call.data.get("entry_id"))
    await data.runtime.async_force_sync(call.data["thing_id"])


async def _async_handle_send_raw_patch(hass: HomeAssistant, call: ServiceCall) -> None:
    data = _resolve_entry_data(hass, call.data.get("entry_id"))
    await data.runtime.async_send_state_update(call.data["thing_id"], call.data["payload"])


def _async_register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_EXECUTE_COMMAND):
        return

    async def _handle_execute_command(call: ServiceCall) -> None:
        await _async_handle_execute_command(hass, call)

    async def _handle_force_sync(call: ServiceCall) -> None:
        await _async_handle_force_sync(hass, call)

    async def _handle_send_raw_patch(call: ServiceCall) -> None:
        await _async_handle_send_raw_patch(hass, call)

    hass.services.async_register(
        DOMAIN,
        SERVICE_EXECUTE_COMMAND,
        _handle_execute_command,
        schema=vol.Schema(
            {
                vol.Required("thing_id"): str,
                vol.Required("command"): str,
                vol.Optional("params", default={}): dict,
                vol.Optional("entry_id"): str,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_FORCE_SYNC,
        _handle_force_sync,
        schema=vol.Schema(
            {
                vol.Required("thing_id"): str,
                vol.Optional("entry_id"): str,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SEND_RAW_PATCH,
        _handle_send_raw_patch,
        schema=vol.Schema(
            {
                vol.Required("thing_id"): str,
                vol.Required("payload"): dict,
                vol.Optional("entry_id"): str,
            }
        ),
    )


def _async_unregister_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_EXECUTE_COMMAND):
        hass.services.async_remove(DOMAIN, SERVICE_EXECUTE_COMMAND)
    if hass.services.has_service(DOMAIN, SERVICE_FORCE_SYNC):
        hass.services.async_remove(DOMAIN, SERVICE_FORCE_SYNC)
    if hass.services.has_service(DOMAIN, SERVICE_SEND_RAW_PATCH):
        hass.services.async_remove(DOMAIN, SERVICE_SEND_RAW_PATCH)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    session = async_get_clientsession(hass)
    api = BluestarApiClient(
        session=session,
        auth_id=entry.data[CONF_AUTH_ID],
        password=entry.data[CONF_PASSWORD],
    )
    runtime = BluestarRuntime(hass, api)
    coordinator = BluestarCoordinator(hass, runtime)
    runtime.set_update_callback(coordinator.async_set_updated_data)

    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = BluestarEntryData(
        api=api,
        coordinator=coordinator,
        runtime=runtime,
    )
    _async_register_services(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unload_ok:
        return False

    data: BluestarEntryData = hass.data[DOMAIN].pop(entry.entry_id)
    await data.runtime.async_shutdown()
    if not hass.data[DOMAIN]:
        _async_unregister_services(hass)
    return True


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
