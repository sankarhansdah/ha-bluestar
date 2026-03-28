from __future__ import annotations

from typing import Any

from homeassistant.components.climate import ClimateEntity
from homeassistant.components.climate.const import ClimateEntityFeature, HVACMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import BluestarEntryData
from .const import DOMAIN
from .coordinator import BluestarCoordinator
from .models import ThingData

ATTR_HVAC_MODE = "hvac_mode"
ATTR_TEMPERATURE = "temperature"


def _c_to_f(value: float) -> float:
    return round(((value * 9.0) / 5.0) + 32.0)


def _f_to_c(value: float) -> float:
    return round(((value - 32.0) * 5.0) / 9.0)


def _coerce_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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
        new_entities: list[BluestarClimateEntity] = []
        for thing_id in sorted(coordinator.data):
            if thing_id in known_ids:
                continue
            known_ids.add(thing_id)
            new_entities.append(BluestarClimateEntity(coordinator, runtime, entry.entry_id, thing_id))
        if new_entities:
            async_add_entities(new_entities)

    _add_missing_entities()
    entry.async_on_unload(coordinator.async_add_listener(_add_missing_entities))


class BluestarClimateEntity(CoordinatorEntity[BluestarCoordinator], ClimateEntity):
    """Blue Star AC climate entity backed by AWS IoT shadow updates."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: BluestarCoordinator,
        runtime,
        entry_id: str,
        thing_id: str,
    ) -> None:
        super().__init__(coordinator)
        self._runtime = runtime
        self._thing_id = thing_id
        self._entry_id = entry_id

    @property
    def _thing(self) -> ThingData | None:
        return self.coordinator.data.get(self._thing_id)

    @property
    def unique_id(self) -> str:
        return f"{self._entry_id}_{self._thing_id}"

    @property
    def name(self) -> str:
        thing = self._thing
        return thing.name if thing is not None else self._thing_id

    @property
    def available(self) -> bool:
        return self._thing is not None and self._runtime.ready

    @property
    def should_poll(self) -> bool:
        return False

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
    def extra_state_attributes(self) -> dict[str, Any]:
        thing = self._thing
        if thing is None:
            return {}

        return {
            "thing_id": thing.id,
            "device_online": thing.state.connected,
            "model_id": thing.model_id,
            "model_type": thing.model_type,
            "product_category": thing.product_category,
            "last_state_ts": thing.state.state_ts,
            "last_connection_ts": thing.state.conn_ts,
            "raw_state": thing.state.raw,
        }

    @property
    def supported_features(self) -> ClimateEntityFeature:
        thing = self._thing
        if thing is None:
            return ClimateEntityFeature(0)

        features = ClimateEntityFeature.TARGET_TEMPERATURE | ClimateEntityFeature.TURN_ON | ClimateEntityFeature.TURN_OFF
        if thing.fan_options():
            features |= ClimateEntityFeature.FAN_MODE
        return features

    def _display_uses_fahrenheit(self, thing: ThingData) -> bool:
        return thing.display_uses_fahrenheit()

    def _display_temp(self, thing: ThingData, value: float | None) -> float | None:
        if value is None:
            return None
        if self._display_uses_fahrenheit(thing):
            return _c_to_f(value)
        return value

    def _device_temp(self, thing: ThingData, value: float | None) -> float | None:
        if value is None:
            return None
        if self._display_uses_fahrenheit(thing):
            return _f_to_c(value)
        return value

    @property
    def temperature_unit(self) -> str:
        thing = self._thing
        if thing is not None and self._display_uses_fahrenheit(thing):
            return UnitOfTemperature.FAHRENHEIT
        return UnitOfTemperature.CELSIUS

    @property
    def target_temperature_step(self) -> float:
        if self.temperature_unit == UnitOfTemperature.FAHRENHEIT:
            return 1.0
        return 0.5

    @property
    def min_temp(self) -> float:
        thing = self._thing
        if thing is None:
            return 16.0
        return self._display_temp(thing, thing.min_temperature_c()) or 16.0

    @property
    def max_temp(self) -> float:
        thing = self._thing
        if thing is None:
            return 30.0
        return self._display_temp(thing, thing.max_temperature_c()) or 30.0

    @property
    def current_temperature(self) -> float | None:
        thing = self._thing
        if thing is None:
            return None
        return self._display_temp(thing, _coerce_float(thing.state.raw.get("ctemp")))

    @property
    def target_temperature(self) -> float | None:
        thing = self._thing
        if thing is None:
            return None
        return self._display_temp(thing, _coerce_float(thing.state.raw.get("stemp")))

    def _mode_label_to_hvac(self, label: str) -> HVACMode | None:
        label = label.lower()
        if label == "cool":
            return HVACMode.COOL
        if label == "heat":
            return HVACMode.HEAT
        if label == "dry":
            return HVACMode.DRY
        if label == "fan":
            return HVACMode.FAN_ONLY
        if label in {"auto", "aipro"}:
            return HVACMode.AUTO
        return None

    def _mode_value_for_hvac(self, thing: ThingData, hvac_mode: HVACMode) -> int | None:
        for value, label in thing.mode_options().items():
            mapped = self._mode_label_to_hvac(label)
            if mapped == hvac_mode:
                return value
        return thing.default_mode_value()

    @property
    def hvac_modes(self) -> list[HVACMode]:
        thing = self._thing
        if thing is None:
            return [HVACMode.OFF, HVACMode.COOL]

        modes: list[HVACMode] = [HVACMode.OFF]
        for _, label in sorted(thing.mode_options().items()):
            hvac_mode = self._mode_label_to_hvac(label)
            if hvac_mode is not None and hvac_mode not in modes:
                modes.append(hvac_mode)
        if len(modes) == 1:
            modes.append(HVACMode.COOL)
        return modes

    @property
    def hvac_mode(self) -> HVACMode:
        thing = self._thing
        if thing is None:
            return HVACMode.OFF

        if _coerce_int(thing.state.raw.get("pow"), 0) == 0:
            return HVACMode.OFF

        mode_value = _coerce_int(thing.state.raw.get("mode"))
        if mode_value is None:
            return HVACMode.COOL

        label = thing.mode_options().get(mode_value, "")
        return self._mode_label_to_hvac(label) or HVACMode.COOL

    @property
    def fan_modes(self) -> list[str] | None:
        thing = self._thing
        if thing is None:
            return None

        options = [label for _, label in sorted(thing.fan_options().items()) if label]
        return options or None

    @property
    def fan_mode(self) -> str | None:
        thing = self._thing
        if thing is None:
            return None

        fan_value = _coerce_int(thing.state.raw.get("fspd"))
        if fan_value is None:
            return None
        return thing.fan_options().get(fan_value)

    async def async_turn_off(self) -> None:
        await self._runtime.async_execute_exact_command(self._thing_id, "power", {"value": False})

    async def async_turn_on(self) -> None:
        await self._runtime.async_execute_exact_command(self._thing_id, "power", {"value": True})

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        if hvac_mode == HVACMode.OFF:
            await self.async_turn_off()
            return

        thing = self._thing
        if thing is None:
            return

        if _coerce_int(thing.state.raw.get("pow"), 0) == 0:
            await self.async_turn_on()

        mode_value = self._mode_value_for_hvac(thing, hvac_mode)
        if mode_value is not None:
            await self._runtime.async_execute_exact_command(self._thing_id, "mode", {"value": mode_value})

    async def async_set_temperature(self, **kwargs: Any) -> None:
        thing = self._thing
        if thing is None:
            return

        hvac_mode = kwargs.get(ATTR_HVAC_MODE)
        if hvac_mode is not None:
            if hvac_mode == HVACMode.OFF:
                await self.async_turn_off()
                return

            if _coerce_int(thing.state.raw.get("pow"), 0) == 0:
                await self.async_turn_on()

        target_temp = kwargs.get(ATTR_TEMPERATURE)
        mode_value = self._mode_value_for_hvac(thing, hvac_mode) if hvac_mode not in (None, HVACMode.OFF) else None
        if mode_value is not None:
            params: dict[str, Any] = {"value": mode_value}
            if target_temp is not None:
                params["temperature"] = str(float(target_temp))
            await self._runtime.async_execute_exact_command(self._thing_id, "mode", params)
            return

        if target_temp is not None:
            await self._runtime.async_execute_exact_command(
                self._thing_id,
                "temperature",
                {"value": str(float(target_temp))},
            )

    async def async_set_fan_mode(self, fan_mode: str) -> None:
        thing = self._thing
        if thing is None:
            return

        target = fan_mode.lower()
        for value, label in thing.fan_options().items():
            if label == target:
                await self._runtime.async_execute_exact_command(self._thing_id, "fan", {"value": value})
                return
