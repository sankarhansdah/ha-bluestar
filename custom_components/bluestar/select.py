from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import BluestarEntryData
from .const import DOMAIN
from .coordinator import BluestarCoordinator
from .models import ThingData
from .runtime import BluestarRuntime

OPTION_CELSIUS = "Celsius"
OPTION_FAHRENHEIT = "Fahrenheit"
UNIT_OPTIONS = [OPTION_CELSIUS, OPTION_FAHRENHEIT]


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
    known_ids: set[str] = set()

    def _add_missing_entities() -> None:
        new_entities: list[BluestarTemperatureUnitSelectEntity] = []
        for thing_id in sorted(coordinator.data):
            if thing_id in known_ids:
                continue
            known_ids.add(thing_id)
            new_entities.append(BluestarTemperatureUnitSelectEntity(coordinator, runtime, thing_id))
        if new_entities:
            async_add_entities(new_entities)

    _add_missing_entities()
    entry.async_on_unload(coordinator.async_add_listener(_add_missing_entities))


class BluestarTemperatureUnitSelectEntity(CoordinatorEntity[BluestarCoordinator], SelectEntity):
    _attr_has_entity_name = True
    _attr_icon = "mdi:thermometer"

    def __init__(self, coordinator: BluestarCoordinator, runtime: BluestarRuntime, thing_id: str) -> None:
        super().__init__(coordinator)
        self._runtime = runtime
        self._thing_id = thing_id
        self._attr_options = UNIT_OPTIONS

    @property
    def _thing(self) -> ThingData | None:
        data = self.coordinator.data
        if not data:
            return None
        return data.get(self._thing_id)

    @property
    def unique_id(self) -> str:
        return f"{self._thing_id}_temperature_unit"

    @property
    def name(self) -> str:
        return "Temperature Unit"

    @property
    def available(self) -> bool:
        return self._thing is not None

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
    def current_option(self) -> str | None:
        thing = self._thing
        if thing is None:
            return None
        return OPTION_FAHRENHEIT if _coerce_int(thing.state.raw.get("displayunit"), 0) == 1 else OPTION_CELSIUS

    async def async_select_option(self, option: str) -> None:
        if option not in UNIT_OPTIONS:
            raise ValueError(f"Unsupported temperature unit option: {option}")
        await self._runtime.async_execute_exact_command(
            self._thing_id,
            "temperature-unit",
            {"value": 1 if option == OPTION_FAHRENHEIT else 0},
        )
