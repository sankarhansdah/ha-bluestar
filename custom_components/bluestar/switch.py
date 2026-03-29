from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import BluestarEntryData
from .const import DOMAIN
from .coordinator import BluestarCoordinator
from .models import ThingData
from .runtime import BluestarRuntime


def _coerce_int(value: Any, default: int | None = None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    data: BluestarEntryData = hass.data[DOMAIN][entry.entry_id]
    coordinator = data.coordinator
    runtime = data.runtime
    known_ids: set[tuple[str, str]] = set()

    def _add_missing_entities() -> None:
        new_entities: list[BluestarSwitchEntity] = []
        for thing_id in sorted(coordinator.data):
            for key, factory in (
                ("power", BluestarPowerSwitchEntity),
                ("display", BluestarDisplaySwitchEntity),
            ):
                entity_key = (thing_id, key)
                if entity_key in known_ids:
                    continue
                known_ids.add(entity_key)
                new_entities.append(factory(coordinator, runtime, thing_id))
        if new_entities:
            async_add_entities(new_entities)

    _add_missing_entities()
    entry.async_on_unload(coordinator.async_add_listener(_add_missing_entities))


class BluestarSwitchEntity(CoordinatorEntity[BluestarCoordinator], SwitchEntity):
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: BluestarCoordinator,
        runtime: BluestarRuntime,
        thing_id: str,
        key: str,
        label: str,
        state_key: str,
        command: str,
        icon: str,
    ) -> None:
        super().__init__(coordinator)
        self._runtime = runtime
        self._thing_id = thing_id
        self._key = key
        self._label = label
        self._state_key = state_key
        self._command = command
        self._attr_icon = icon

    @property
    def _thing(self) -> ThingData | None:
        data = self.coordinator.data
        if not data:
            return None
        return data.get(self._thing_id)

    @property
    def unique_id(self) -> str:
        return f"{self._thing_id}_{self._key}"

    @property
    def name(self) -> str:
        return self._label

    @property
    def available(self) -> bool:
        return self._thing is not None and self._runtime.mqtt_connected

    @property
    def device_info(self) -> dict[str, Any]:
        thing = self._thing
        if thing is None:
            return {"identifiers": {(DOMAIN, self._thing_id)}}

        return {
            "identifiers": {(DOMAIN, thing.id)},
            "manufacturer": "Blue Star",
            "model": thing.model_id or "Smart AC",
            "name": thing.name,
        }

    @property
    def is_on(self) -> bool | None:
        thing = self._thing
        if thing is None:
            return None
        return _coerce_int(thing.state.raw.get(self._state_key), 0) == 1

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._runtime.async_execute_exact_command(self._thing_id, self._command, {"value": True})

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._runtime.async_execute_exact_command(self._thing_id, self._command, {"value": False})


class BluestarPowerSwitchEntity(BluestarSwitchEntity):
    def __init__(self, coordinator: BluestarCoordinator, runtime: BluestarRuntime, thing_id: str) -> None:
        super().__init__(
            coordinator=coordinator,
            runtime=runtime,
            thing_id=thing_id,
            key="power",
            label="Power",
            state_key="pow",
            command="power",
            icon="mdi:power",
        )


class BluestarDisplaySwitchEntity(BluestarSwitchEntity):
    def __init__(self, coordinator: BluestarCoordinator, runtime: BluestarRuntime, thing_id: str) -> None:
        super().__init__(
            coordinator=coordinator,
            runtime=runtime,
            thing_id=thing_id,
            key="display",
            label="Display",
            state_key="display",
            command="display",
            icon="mdi:monitor",
        )
