from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_float(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _f_to_c(value: float) -> float:
    return round(((value - 32.0) * 5.0) / 9.0, 1)


def _normalize_state_temperatures(payload: dict[str, Any], default_displayunit: int = 0) -> dict[str, Any]:
    normalized = dict(payload)
    displayunit = _coerce_int(normalized.get("displayunit"), default_displayunit)
    if displayunit != 1:
        return normalized

    for key in ("stemp", "ctemp"):
        value = _coerce_float(normalized.get(key))
        if value is not None:
            normalized[key] = f"{_f_to_c(value):.1f}"
    return normalized


@dataclass(slots=True, frozen=True)
class BrokerInfo:
    endpoint: str
    access_key: str
    secret_key: str


@dataclass(slots=True)
class ThingStateData:
    raw: dict[str, Any] = field(default_factory=dict)
    state_ts: int = 0
    connected: bool = False
    conn_ts: int = 0

    def merge_api_state(self, payload: dict[str, Any]) -> bool:
        state_ts = _coerce_int(payload.get("state_ts"), 0)
        if state_ts < self.state_ts:
            return False

        state_payload = payload.get("state") or {}
        if isinstance(state_payload, dict):
            self.raw = _normalize_state_temperatures(
                state_payload,
                _coerce_int(self.raw.get("displayunit"), 0),
            )

        self.state_ts = state_ts
        self.connected = bool(payload.get("connected", self.connected))
        self.conn_ts = _coerce_int(payload.get("conn_ts"), self.conn_ts)
        return True

    def merge_report(self, payload: dict[str, Any]) -> bool:
        state_ts = _coerce_int(payload.get("ts"), 0)
        if state_ts < self.state_ts:
            return False

        self.raw = _normalize_state_temperatures(
            payload,
            _coerce_int(self.raw.get("displayunit"), 0),
        )
        self.state_ts = state_ts
        return True

    def update_presence(self, connected: bool, timestamp: int) -> bool:
        if timestamp < self.conn_ts:
            return False

        self.connected = connected
        self.conn_ts = timestamp
        return True


@dataclass(slots=True)
class ThingData:
    id: str
    name: str
    model_type: int
    model_id: str
    product_category: str
    user_access_token: str
    raw: dict[str, Any]
    model_config: dict[str, Any]
    state: ThingStateData = field(default_factory=ThingStateData)

    @classmethod
    def from_api(
        cls,
        payload: dict[str, Any],
        state_payload: dict[str, Any] | None,
    ) -> "ThingData":
        thing_id = str(payload.get("id") or payload.get("thing_id") or "").strip()
        user_config = payload.get("user_config") or {}
        if not isinstance(user_config, dict):
            user_config = {}

        name = str(user_config.get("name") or f"AC-{thing_id[-4:]}")
        model_config = payload.get("model_config") or {}
        if not isinstance(model_config, dict):
            model_config = {}

        thing = cls(
            id=thing_id,
            name=name,
            model_type=_coerce_int(payload.get("model_type"), 0),
            model_id=str(payload.get("model_id", "")),
            product_category=str(user_config.get("product_category") or payload.get("product_category") or "7"),
            user_access_token=str(user_config.get("uat", "")),
            raw=dict(payload),
            model_config=model_config,
        )
        if isinstance(state_payload, dict):
            thing.state.merge_api_state(state_payload)
        return thing

    def merge_runtime_state(self, previous: "ThingData") -> None:
        if previous.state.state_ts > self.state.state_ts:
            self.state.raw = dict(previous.state.raw)
            self.state.state_ts = previous.state.state_ts

        if previous.state.conn_ts > self.state.conn_ts:
            self.state.connected = previous.state.connected
            self.state.conn_ts = previous.state.conn_ts

    def mode_options(self) -> dict[int, str]:
        options: dict[int, str] = {}
        raw_modes = self.model_config.get("mode") or {}
        if not isinstance(raw_modes, dict):
            return options

        for key, value in raw_modes.items():
            if not isinstance(value, dict):
                continue
            try:
                options[int(key)] = str(value.get("name", "")).strip().lower()
            except (TypeError, ValueError):
                continue
        return options

    def mode_value_for_label(self, *labels: str) -> int | None:
        normalized = {label.strip().lower() for label in labels}
        for value, label in self.mode_options().items():
            if label in normalized:
                return value
        return None

    def fan_options(self) -> dict[int, str]:
        options: dict[int, str] = {}
        raw_fans = self.model_config.get("fspd") or {}
        if not isinstance(raw_fans, dict):
            return options

        for key, value in raw_fans.items():
            try:
                options[int(key)] = str(value).strip().lower()
            except (TypeError, ValueError):
                continue
        return options

    def fan_value_for_label(self, *labels: str) -> int | None:
        normalized = {label.strip().lower() for label in labels}
        for value, label in self.fan_options().items():
            if label in normalized:
                return value
        return None

    def default_mode_value(self) -> int | None:
        modes = self.mode_options()
        if not modes:
            return None

        for preferred in ("cool", "auto", "heat", "dry", "fan"):
            for value, label in modes.items():
                if label == preferred:
                    return value

        return next(iter(sorted(modes)))

    def cool_mode_value(self) -> int | None:
        return self.mode_value_for_label("cool")

    def heat_mode_value(self) -> int | None:
        return self.mode_value_for_label("heat")

    def dry_mode_value(self) -> int | None:
        return self.mode_value_for_label("dry")

    def auto_mode_value(self) -> int | None:
        return self.mode_value_for_label("auto", "aipro")

    def default_temperature_for_mode(self, mode_value: int | None) -> float | None:
        if mode_value is None:
            return None

        raw_modes = self.model_config.get("mode") or {}
        mode_payload = raw_modes.get(str(mode_value)) or {}
        if not isinstance(mode_payload, dict):
            return None

        temp_payload = mode_payload.get("stemp") or {}
        if not isinstance(temp_payload, dict):
            return None

        return _coerce_float(temp_payload.get("default"))

    def default_temperature_string_for_mode(self, mode_value: int | None) -> str | None:
        if mode_value is None:
            return None

        raw_modes = self.model_config.get("mode") or {}
        mode_payload = raw_modes.get(str(mode_value)) or {}
        if not isinstance(mode_payload, dict):
            return None

        temp_payload = mode_payload.get("stemp") or {}
        if not isinstance(temp_payload, dict):
            return None

        value = temp_payload.get("default")
        if value in (None, ""):
            return None
        return str(value)

    def default_fan_speed_for_mode(self, mode_value: int | None) -> int | None:
        if mode_value is None:
            return None

        raw_modes = self.model_config.get("mode") or {}
        mode_payload = raw_modes.get(str(mode_value)) or {}
        if not isinstance(mode_payload, dict):
            return None

        fan_payload = mode_payload.get("fspd") or {}
        if not isinstance(fan_payload, dict):
            return None

        return _coerce_int(fan_payload.get("default"))

    def default_fan_speed_string_for_mode(self, mode_value: int | None) -> str | None:
        if mode_value is None:
            return None

        raw_modes = self.model_config.get("mode") or {}
        mode_payload = raw_modes.get(str(mode_value)) or {}
        if not isinstance(mode_payload, dict):
            return None

        fan_payload = mode_payload.get("fspd") or {}
        if not isinstance(fan_payload, dict):
            return None

        value = fan_payload.get("default")
        if value in (None, ""):
            return None
        return str(value)

    def min_temperature_c(self) -> float:
        return float(_coerce_int(self.model_config.get("min_temp"), 16))

    def max_temperature_c(self) -> float:
        return float(_coerce_int(self.model_config.get("max_temp"), 30))

    def display_uses_fahrenheit(self) -> bool:
        return _coerce_int(self.state.raw.get("displayunit"), 0) == 1

    def display_digits(self) -> int:
        return _coerce_int(self.model_config.get("display_digit"), 2)

    def remote_type(self) -> int:
        return _coerce_int(self.model_config.get("remote_type"), 1000)

    def configured_temperature_for_mode(self, mode_value: int | None) -> str | None:
        if mode_value is None:
            return None

        user_config = self.raw.get("user_config") or {}
        if isinstance(user_config, dict):
            mode_config = user_config.get("mode") or {}
            if isinstance(mode_config, dict):
                selected_mode = mode_config.get(str(mode_value)) or {}
                if isinstance(selected_mode, dict):
                    value = selected_mode.get("stemp")
                    if value not in (None, ""):
                        return str(value)

        return self.default_temperature_string_for_mode(mode_value)

    def configured_fan_speed_for_mode(self, mode_value: int | None) -> str | None:
        if mode_value is None:
            return None

        user_config = self.raw.get("user_config") or {}
        if isinstance(user_config, dict):
            mode_config = user_config.get("mode") or {}
            if isinstance(mode_config, dict):
                selected_mode = mode_config.get(str(mode_value)) or {}
                if isinstance(selected_mode, dict):
                    value = selected_mode.get("fspd")
                    if value not in (None, ""):
                        return str(value)

        return self.default_fan_speed_string_for_mode(mode_value)

    def before_turbo_state(self) -> dict[str, Any] | None:
        user_config = self.raw.get("user_config") or {}
        if not isinstance(user_config, dict):
            return None
        payload = user_config.get("before_turbo")
        return payload if isinstance(payload, dict) else None

    def before_climate_state(self) -> dict[str, Any] | None:
        user_config = self.raw.get("user_config") or {}
        if not isinstance(user_config, dict):
            return None
        payload = user_config.get("before_climate")
        return payload if isinstance(payload, dict) else None
