from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntryAuthFailed
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import BluestarApiError, BluestarAuthError
from .const import DEFAULT_SCAN_INTERVAL
from .models import ThingData
from .runtime import BluestarRuntime

_LOGGER = logging.getLogger(__name__)


class BluestarCoordinator(DataUpdateCoordinator[dict[str, ThingData]]):
    """Polls the cloud inventory while MQTT handles push state changes."""

    def __init__(self, hass: HomeAssistant, runtime: BluestarRuntime) -> None:
        super().__init__(
            hass,
            logger=_LOGGER,
            name="Blue Star Smart AC",
            update_interval=DEFAULT_SCAN_INTERVAL,
        )
        self.runtime = runtime

    async def _async_update_data(self) -> dict[str, ThingData]:
        try:
            return await self.runtime.async_refresh_devices()
        except BluestarAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except BluestarApiError as err:
            raise UpdateFailed(str(err)) from err
