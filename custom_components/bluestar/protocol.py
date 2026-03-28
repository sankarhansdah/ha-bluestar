from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .models import ThingData

REMOTE_TYPE_4_RAD = 10
COMMAND_DELAY_MS = 200

COMMAND_CATALOG: tuple[dict[str, Any], ...] = (
    {"name": "power", "params": {"value": True}, "description": "ThingService.setPowerState"},
    {"name": "mode", "params": {"value": 2}, "description": "ThingService.setACMode"},
    {"name": "temperature", "params": {"value": "24.0"}, "description": "ThingService.setACTemperature"},
    {"name": "fan", "params": {"value": 4}, "description": "ThingService.setFanSpeed"},
    {"name": "temperature-unit", "params": {"value": 0}, "description": "ThingService.setTemperatureUnit"},
    {"name": "turbo", "params": {"value": 1}, "description": "ThingService.setCoolingMode"},
    {"name": "horizontal-swing", "params": {"value": 0}, "description": "ThingService.setHorizontalSwingState"},
    {"name": "vertical-swing", "params": {"value": 0}, "description": "ThingService.setVerticalSwingState"},
    {"name": "four-way-swing", "params": {"louver": 1, "position": 0}, "description": "ThingService.set4WaySwingState"},
    {"name": "display", "params": {"value": True}, "description": "ThingService.setDisplay"},
    {"name": "self-clean", "params": {"value": True}, "description": "ThingService.setSelfClean"},
    {"name": "defrost-clean", "params": {"value": True}, "description": "ThingService.setDeFrostClean"},
    {"name": "filter-reset", "params": {}, "description": "ThingService.setAlarmFilterCleanReset"},
    {"name": "ai-pro-plus", "params": {"value": True}, "description": "ThingService.setAiProPlusState"},
    {"name": "health", "params": {"value": True}, "description": "ThingService.setHealthState"},
    {"name": "buzzer", "params": {"value": 1}, "description": "ThingService.setBuzzerState"},
    {"name": "comfort-sleep", "params": {"value": True}, "description": "ThingService.setComfortSleepMode"},
    {"name": "climate", "params": {"value": 1}, "description": "ThingService.setClimateMode"},
    {"name": "on-lock", "params": {"value": True}, "description": "ThingService.setACOnLock"},
    {"name": "off-lock", "params": {"value": True}, "description": "ThingService.setACOffLock"},
    {"name": "temperature-lock", "params": {"value": True}, "description": "ThingService.setTemperatureLock"},
    {"name": "mode-lock", "params": {"value": True}, "description": "ThingService.setModeLock"},
    {"name": "fan-speed-lock", "params": {"value": True}, "description": "ThingService.setFanSpeedLock"},
    {"name": "lower-temperature-limit", "params": {"value": "18"}, "description": "ThingService.setLowerTemperatureLimit"},
    {"name": "upper-temperature-limit", "params": {"value": "28"}, "description": "ThingService.setUpperTemperatureLimit"},
    {
        "name": "irest",
        "params": {
            "mode": 2,
            "fanSpeed": 4,
            "temperature": "24",
            "horizontalSwing": 6,
            "verticalSwing": 6,
            "timer": 60,
            "fourWay": [0, 0, 0, 0],
        },
        "description": "ThingService.setIRest",
    },
    {"name": "irest-off", "params": {}, "description": "ThingService.turnOffIRest"},
    {
        "name": "preference",
        "params": {
            "value": 1,
            "mode": 2,
            "fanSpeed": 4,
            "temperature": "24",
            "horizontalSwing": 6,
            "verticalSwing": 6,
            "fourWay": [0, 0, 0, 0],
        },
        "description": "ThingService.setUserPreference",
    },
    {"name": "preference-off", "params": {}, "description": "ThingService.turnOffPreference"},
    {"name": "fix-and-lock", "params": {"value": 1}, "description": "ThingService.setFixAndLock"},
    {"name": "eco", "params": {"value": 1}, "description": "ThingService.setEcoMode"},
    {"name": "esave", "params": {"value": True}, "description": "ThingService.setESaveMode"},
)


class BluestarProtocolError(ValueError):
    """Raised when exact command parameters are invalid."""


def _coerce_int(value: Any, default: int | None = None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_float(value: Any, default: float | None = None) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "on", "yes", "enable", "enabled"}
    return bool(value)


def _c_to_f(value_c: float) -> int:
    return round(((value_c * 9.0) / 5.0) + 32.0)


def _parse_firmware(version: Any) -> tuple[int, int]:
    major_raw, _, minor_raw = str(version or "0.0").partition(".")
    return _coerce_int(major_raw, 0) or 0, _coerce_int(minor_raw, 0) or 0


def _format_mode_temperature_from_celsius(thing: ThingData, value_c: float) -> str:
    if thing.display_uses_fahrenheit():
        return str(_c_to_f(value_c))
    if thing.display_digits() == 2:
        return str(round(value_c))
    return f"{value_c:.1f}"


def _display_value_string(thing: ThingData, value: Any) -> str:
    parsed = _coerce_float(value)
    if parsed is None:
        raise BluestarProtocolError("Temperature must be numeric")
    return f"{parsed:.1f}"


def _integer_temperature_string(thing: ThingData, value_c: float) -> str:
    if thing.display_uses_fahrenheit():
        return str(_c_to_f(value_c))
    if thing.display_digits() == 2:
        return str(round(value_c))
    return f"{value_c:.1f}"


def _cool_mode_value(thing: ThingData) -> int | None:
    return thing.cool_mode_value() or thing.default_mode_value()


def _dry_mode_value(thing: ThingData) -> int | None:
    return thing.dry_mode_value() or thing.default_mode_value()


def _high_fan_value(thing: ThingData) -> int | None:
    return thing.fan_value_for_label("high", "high high", "turbo") or max(thing.fan_options(), default=None)


def _mid_fan_value(thing: ThingData) -> int | None:
    return thing.fan_value_for_label("medium", "med") or _high_fan_value(thing)


def _low_fan_value(thing: ThingData) -> int | None:
    return thing.fan_value_for_label("low") or min(thing.fan_options(), default=None)


def _auto_fan_value(thing: ThingData) -> int | None:
    return thing.fan_value_for_label("auto") or _low_fan_value(thing)


def _turbo_fan_value(thing: ThingData) -> int | None:
    return thing.fan_value_for_label("turbo") or _high_fan_value(thing)


def _mode_temperature_value(thing: ThingData, mode_value: int, override: Any = None) -> str | None:
    if override not in (None, ""):
        return str(override)

    configured = thing.configured_temperature_for_mode(mode_value)
    if configured in (None, ""):
        return None

    parsed = _coerce_float(configured)
    if parsed is None:
        return str(configured)

    return _format_mode_temperature_from_celsius(thing, parsed)


def _mode_fan_value(thing: ThingData, mode_value: int, override: Any = None) -> int | None:
    if override not in (None, ""):
        parsed = _coerce_int(override)
        if parsed is None:
            raise BluestarProtocolError("Fan speed must be numeric")
        return parsed

    configured = thing.configured_fan_speed_for_mode(mode_value)
    parsed = _coerce_int(configured)
    return parsed


def _season_settings(thing: ThingData, climate_value: int) -> dict[str, Any] | None:
    if climate_value == 0:
        mode_value = _cool_mode_value(thing)
        fan_value = _low_fan_value(thing)
        temp_value = _integer_temperature_string(thing, thing.min_temperature_c())
        before_climate = thing.before_climate_state()
        if before_climate:
            mode_value = _coerce_int(before_climate.get("mode"), mode_value)
            fan_value = _coerce_int(before_climate.get("fspd"), fan_value)
            temp_value = str(before_climate.get("stemp", temp_value))
        if mode_value is None:
            return None
        payload: dict[str, Any] = {"value": mode_value}
        if temp_value not in ("", None):
            payload["stemp"] = temp_value
        if fan_value is not None:
            payload["fspd"] = fan_value
        return payload

    if thing.model_type != 2:
        return None

    remote_type = thing.remote_type()
    if climate_value == 1:
        if remote_type == REMOTE_TYPE_4_RAD:
            mode_value = _cool_mode_value(thing)
            temp_value = "26" if thing.display_digits() == 2 else "26.0"
        else:
            mode_value = thing.heat_mode_value() or _cool_mode_value(thing)
            temp_value = "21" if thing.display_digits() == 2 else "21.0"
        fan_value = _mid_fan_value(thing)
    elif climate_value == 2:
        mode_value = _cool_mode_value(thing)
        fan_value = _turbo_fan_value(thing) if remote_type == REMOTE_TYPE_4_RAD else _high_fan_value(thing)
        temp_value = "24" if thing.display_digits() == 2 else "24.0"
    elif climate_value == 3:
        mode_value = _dry_mode_value(thing)
        fan_value = _low_fan_value(thing)
        if remote_type == REMOTE_TYPE_4_RAD:
            temp_value = "24" if thing.display_digits() == 2 else "24.0"
        else:
            temp_value = "25" if thing.display_digits() == 2 else "25.0"
    else:
        return None

    if mode_value is None:
        return None

    payload: dict[str, Any] = {"value": mode_value}
    if fan_value is not None:
        payload["fspd"] = fan_value
    payload["stemp"] = temp_value
    return payload


def build_exact_command_sequence(thing: ThingData, command: str, params: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    payload = dict(params or {})
    name = command.strip().lower()

    if name == "power":
        return [{"pow": 1 if _truthy(payload.get("value", True)) else 0}]

    if name == "temperature":
        return [{"stemp": _display_value_string(thing, payload.get("value"))}]

    if name == "temperature-unit":
        unit_value = _coerce_int(payload.get("value"))
        if unit_value is None:
            raise BluestarProtocolError("Temperature unit value must be numeric")
        return [{"displayunit": unit_value}]

    if name == "fan":
        fan_value = _coerce_int(payload.get("value"))
        if fan_value is None:
            raise BluestarProtocolError("Fan speed must be numeric")
        return [{"fspd": fan_value}]

    if name == "mode":
        mode_value = _coerce_int(payload.get("value"))
        if mode_value is None:
            raise BluestarProtocolError("Mode value must be numeric")

        mode_payload: dict[str, Any] = {"value": mode_value}
        resolved_temperature = _mode_temperature_value(thing, mode_value, payload.get("temperature"))
        if resolved_temperature not in (None, ""):
            mode_payload["stemp"] = resolved_temperature

        resolved_fan = _mode_fan_value(thing, mode_value, payload.get("fanSpeed"))
        if resolved_fan is not None:
            mode_payload["fspd"] = resolved_fan

        top_level: dict[str, Any] = {"mode": mode_payload}
        if thing.model_type == 2:
            if _coerce_int(thing.state.raw.get("climate"), 0) != 0:
                top_level["climate"] = 0
            if _coerce_int(thing.state.raw.get("turbo"), 0) != 0:
                top_level["turbo"] = 0
            if _coerce_int(thing.state.raw.get("sleep"), 0) == 1:
                top_level["sleep"] = 0

        firmware_major, firmware_minor = _parse_firmware(thing.raw.get("f_ver"))
        if mode_value == thing.heat_mode_value() and firmware_major == 0 and firmware_minor <= 1:
            sequence: list[dict[str, Any]] = [{"mode": {"value": mode_value}}]
            if "stemp" in mode_payload:
                sequence.append({"stemp": mode_payload["stemp"]})
            if "fspd" in mode_payload:
                sequence.append({"fspd": mode_payload["fspd"]})
            return sequence

        if _coerce_int(thing.state.raw.get("prf"), 0) != 0:
            return [{"prf": {"value": 0}}, top_level]

        return [top_level]

    if name == "turbo":
        turbo_value = _coerce_int(payload.get("value"))
        if turbo_value is None:
            raise BluestarProtocolError("Turbo value must be numeric")
        turbo_payload: dict[str, Any] = {"turbo": turbo_value}
        if thing.model_type == 2 and turbo_value != 0:
            high_fan = _high_fan_value(thing)
            if high_fan is not None:
                turbo_payload["fspd"] = high_fan
            turbo_payload["stemp"] = "16" if thing.display_digits() == 2 else "16.0"
        elif turbo_value == 0:
            before_turbo = thing.before_turbo_state()
            if before_turbo:
                if before_turbo.get("fspd") not in (None, ""):
                    turbo_payload["fspd"] = _coerce_int(before_turbo.get("fspd"))
                if before_turbo.get("stemp") not in (None, ""):
                    turbo_payload["stemp"] = str(before_turbo.get("stemp"))
        return [turbo_payload]

    simple_boolean_commands = {
        "display": "display",
        "self-clean": "s_clean",
        "defrost-clean": "df_clean",
        "health": "health",
        "comfort-sleep": "sleep",
        "on-lock": "on_lock",
        "off-lock": "off_lock",
        "temperature-lock": "stemp_lock",
        "mode-lock": "mode_lock",
        "fan-speed-lock": "fspd_lock",
        "esave": "esave",
    }
    if name in simple_boolean_commands and name != "esave":
        return [{simple_boolean_commands[name]: 1 if _truthy(payload.get("value", True)) else 0}]

    if name == "horizontal-swing":
        swing_value = _coerce_int(payload.get("value"))
        if swing_value is None:
            raise BluestarProtocolError("Horizontal swing value must be numeric")
        return [{"hswing": swing_value}]

    if name == "vertical-swing":
        swing_value = _coerce_int(payload.get("value"))
        if swing_value is None:
            raise BluestarProtocolError("Vertical swing value must be numeric")
        return [{"vswing": swing_value}]

    if name == "four-way-swing":
        louver = _coerce_int(payload.get("louver"))
        position = _coerce_int(payload.get("position"))
        if louver is None or position is None:
            raise BluestarProtocolError("4-way swing requires numeric louver and position values")
        return [{"swing_4way": {"louver": louver, "position": position}}]

    if name == "filter-reset":
        return [{"flt_alarm_rst": 0}]

    if name == "ai-pro-plus":
        enabled = _truthy(payload.get("value", True))
        cool_mode = _cool_mode_value(thing)
        ai_payload: dict[str, Any] = {"value": 1 if enabled else 0}
        if enabled:
            if cool_mode is not None:
                ai_payload["mode"] = cool_mode
                temperature = _mode_temperature_value(thing, cool_mode)
                if temperature not in (None, ""):
                    ai_payload["stemp"] = temperature
            auto_fan = _auto_fan_value(thing)
            if auto_fan is not None:
                ai_payload["fspd"] = auto_fan
        elif cool_mode is not None:
            cool_fan = _mode_fan_value(thing, cool_mode)
            if cool_fan is not None:
                ai_payload["fspd"] = cool_fan
        return [{"ai": ai_payload}]

    if name == "buzzer":
        level = _coerce_int(payload.get("value"))
        if level is None:
            raise BluestarProtocolError("Buzzer level must be numeric")
        return [{"m_buz": level}]

    if name == "climate":
        climate_value = _coerce_int(payload.get("value"))
        if climate_value is None:
            raise BluestarProtocolError("Climate value must be numeric")
        climate_payload: dict[str, Any] = {"climate": climate_value}
        if climate_value != 0 and thing.model_type == 2 and _coerce_int(thing.state.raw.get("sleep"), 0) == 1:
            climate_payload["sleep"] = 0
        season_settings = _season_settings(thing, climate_value)
        if season_settings is not None:
            climate_payload["mode"] = season_settings
        return [climate_payload]

    if name == "lower-temperature-limit":
        value = payload.get("value")
        if value in (None, ""):
            raise BluestarProtocolError("Lower temperature limit value is required")
        return [{"rtll": str(value)}]

    if name == "upper-temperature-limit":
        value = payload.get("value")
        if value in (None, ""):
            raise BluestarProtocolError("Upper temperature limit value is required")
        return [{"rtul": str(value)}]

    if name == "irest":
        mode_value = _coerce_int(payload.get("mode"))
        fan_value = _coerce_int(payload.get("fanSpeed"))
        timer_value = _coerce_int(payload.get("timer"))
        if mode_value is None or fan_value is None or timer_value is None:
            raise BluestarProtocolError("iRest requires numeric mode, fanSpeed, and timer values")
        irest_payload = {
            "value": 1,
            "mode": mode_value,
            "fspd": fan_value,
            "stemp": str(payload.get("temperature", "24")),
            "hswing": _coerce_int(payload.get("horizontalSwing"), 6) or 6,
            "vswing": _coerce_int(payload.get("verticalSwing"), 6) or 6,
            "irest_tmr": timer_value,
        }
        sequence: list[dict[str, Any]] = [{"irest": irest_payload}]
        four_way = payload.get("fourWay")
        if isinstance(four_way, list):
            for index, position in enumerate(four_way, start=1):
                parsed_position = _coerce_int(position)
                if parsed_position is not None:
                    sequence.append({"swing_4way": {"louver": index, "position": parsed_position}})
        return sequence

    if name == "irest-off":
        return [{"irest": {"value": 0}}]

    if name == "preference":
        pref_value = _coerce_int(payload.get("value"))
        mode_value = _coerce_int(payload.get("mode"))
        fan_value = _coerce_int(payload.get("fanSpeed"))
        if pref_value is None or mode_value is None or fan_value is None:
            raise BluestarProtocolError("Preference requires numeric value, mode, and fanSpeed fields")
        pref_payload: dict[str, Any] = {
            "value": pref_value,
            "mode": mode_value,
            "stemp": str(payload.get("temperature", "24")),
            "fspd": fan_value,
        }
        horizontal = _coerce_int(payload.get("horizontalSwing"))
        vertical = _coerce_int(payload.get("verticalSwing"))
        if horizontal is not None:
            pref_payload["hswing"] = horizontal
        if vertical is not None:
            pref_payload["vswing"] = vertical

        top_level: dict[str, Any] = {"prf": pref_payload}
        if thing.model_type == 2 and _coerce_int(thing.state.raw.get("turbo"), 0) != 0:
            top_level["turbo"] = 0

        sequence = [top_level]
        four_way = payload.get("fourWay")
        if isinstance(four_way, list) and four_way:
            parsed_positions = [_coerce_int(item) for item in four_way]
            if parsed_positions and all(item is not None for item in parsed_positions):
                first = parsed_positions[0]
                if all(item == first for item in parsed_positions):
                    sequence.append({"swing_4way": {"louver": 0, "position": first}})
                else:
                    for index, position in enumerate(parsed_positions, start=1):
                        sequence.append({"swing_4way": {"louver": index, "position": position}})
        return sequence

    if name == "preference-off":
        return [{"prf": {"value": 0}}]

    if name == "fix-and-lock":
        value = _coerce_int(payload.get("value"))
        if value is None:
            raise BluestarProtocolError("Fix-and-lock value must be numeric")
        return [{"fixlock": value}]

    if name == "eco":
        eco_value = _coerce_int(payload.get("value"))
        if eco_value is None:
            raise BluestarProtocolError("Eco value must be numeric")
        eco_payload: dict[str, Any] = {"value": eco_value}
        if eco_value == 0:
            cool_mode = _cool_mode_value(thing)
            eco_payload["fspd"] = _mode_fan_value(thing, cool_mode or thing.default_mode_value() or 0) or _low_fan_value(thing)
        else:
            eco_config = thing.model_config.get("eco") or {}
            if isinstance(eco_config, dict):
                values = eco_config.get("values") or {}
                if isinstance(values, dict):
                    selected = values.get(str(eco_value)) or {}
                    if isinstance(selected, dict):
                        fan_speed = _coerce_int(selected.get("fspd"))
                        if fan_speed:
                            eco_payload["fspd"] = fan_speed
        return [{"eco": eco_payload}]

    if name == "esave":
        enabled = _truthy(payload.get("value", True))
        sequence = [{"esave": 1 if enabled else 0}]
        if enabled:
            sequence.append({"stemp": _integer_temperature_string(thing, 24.0)})
        return sequence

    raise BluestarProtocolError(f"Unsupported exact command: {command}")


def apply_optimistic_payload(thing: ThingData, payload: Mapping[str, Any], timestamp_ms: int) -> None:
    next_state = dict(thing.state.raw)

    for key, value in payload.items():
        if key == "mode" and isinstance(value, Mapping):
            if value.get("value") not in (None, ""):
                next_state["mode"] = value["value"]
            if value.get("stemp") not in (None, ""):
                next_state["stemp"] = str(value["stemp"])
            if value.get("fspd") not in (None, ""):
                next_state["fspd"] = value["fspd"]
            continue

        if isinstance(value, Mapping) and value.get("value") not in (None, ""):
            next_state[key] = value["value"]
            for child_key in ("mode", "stemp", "fspd", "hswing", "vswing", "irest_tmr"):
                if value.get(child_key) not in (None, ""):
                    next_state[child_key] = value[child_key]
            continue

        next_state[key] = value

    thing.state.raw = next_state
    if timestamp_ms >= thing.state.state_ts:
        thing.state.state_ts = timestamp_ms
