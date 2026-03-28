from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import BluestarApiClient, BluestarApiError, BluestarAuthError
from .const import CONF_AUTH_ID, CONF_PASSWORD, DOMAIN


STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_AUTH_ID): str,
        vol.Required(CONF_PASSWORD): str,
    }
)


class BluestarConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Config flow for Blue Star Smart AC."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors: dict[str, str] = {}

        if user_input is not None:
            api = BluestarApiClient(
                session=async_get_clientsession(self.hass),
                auth_id=user_input[CONF_AUTH_ID],
                password=user_input[CONF_PASSWORD],
            )

            try:
                await api.async_login()
            except BluestarAuthError:
                errors["base"] = "invalid_auth"
            except BluestarApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(user_input[CONF_AUTH_ID].strip().lower())
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"Blue Star ({user_input[CONF_AUTH_ID]})",
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )
