from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any

from aiohttp import ClientError, ClientResponseError, ClientSession

from .const import (
    APP_VERSION_HEADER,
    LOGIN_URL,
    OS_NAME_HEADER,
    OS_VERSION_HEADER,
    THINGS_URL,
    USER_AGENT_HEADER,
)
from .models import BrokerInfo


class BluestarError(Exception):
    """Base Blue Star integration error."""


class BluestarApiError(BluestarError):
    """Blue Star API error."""

    def __init__(self, status_code: int, code: str | None = None, message: str | None = None) -> None:
        super().__init__(message or code or f"API request failed with status {status_code}")
        self.status_code = status_code
        self.code = code


class BluestarAuthError(BluestarApiError):
    """Authentication or authorization failure."""


@dataclass(slots=True, frozen=True)
class LoginResponse:
    session_id: str
    broker_info: BrokerInfo


class BluestarApiClient:
    """Small async client that mirrors the mobile app's cloud calls."""

    def __init__(self, session: ClientSession, auth_id: str, password: str) -> None:
        self._session = session
        self._auth_id = auth_id.strip()
        self._password = password

    def _headers(self, session_id: str | None = None) -> dict[str, str]:
        headers = {
            "X-APP-VER": APP_VERSION_HEADER,
            "X-OS-NAME": OS_NAME_HEADER,
            "X-OS-VER": OS_VERSION_HEADER,
            "User-Agent": USER_AGENT_HEADER,
        }
        if session_id:
            headers["X-APP-SESSION"] = session_id
        return headers

    @staticmethod
    def _auth_type(auth_id: str) -> int:
        return 1 if len(auth_id) == 10 and auth_id.isdigit() else 0

    @staticmethod
    def decode_broker_info(encoded_value: str) -> BrokerInfo:
        try:
            decoded = base64.b64decode(encoded_value).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as err:
            raise BluestarApiError(200, code="invalid_broker_info", message="Unable to decode broker info") from err

        try:
            endpoint, access_key, secret_key = decoded.split("::", 2)
        except ValueError as err:
            raise BluestarApiError(200, code="invalid_broker_info", message="Unexpected broker info format") from err

        return BrokerInfo(
            endpoint=endpoint.strip(),
            access_key=access_key.strip(),
            secret_key=secret_key.strip(),
        )

    async def async_login(self) -> LoginResponse:
        payload = {
            "auth_id": self._auth_id,
            "auth_type": self._auth_type(self._auth_id),
            "password": self._password,
        }

        try:
            async with self._session.post(
                LOGIN_URL,
                json=payload,
                headers=self._headers(),
            ) as response:
                data = await response.json(content_type=None)
        except (ClientError, ClientResponseError, ValueError) as err:
            raise BluestarApiError(0, code="login_failed", message="Unable to reach Blue Star login API") from err

        if response.status >= 400:
            code = data.get("code") if isinstance(data, dict) else None
            exc_cls = BluestarAuthError if response.status in {400, 401, 403} else BluestarApiError
            raise exc_cls(response.status, code=code)

        if not isinstance(data, dict):
            raise BluestarApiError(response.status, code="invalid_response", message="Unexpected login response")

        session_id = str(data.get("session", "")).strip()
        broker_info = self.decode_broker_info(str(data.get("mi", "")).strip())
        if not session_id:
            raise BluestarAuthError(response.status, code="missing_session", message="Login did not return a session token")

        return LoginResponse(session_id=session_id, broker_info=broker_info)

    async def async_get_things(self, session_id: str) -> dict[str, Any]:
        try:
            async with self._session.get(
                THINGS_URL,
                headers=self._headers(session_id),
            ) as response:
                data = await response.json(content_type=None)
        except (ClientError, ClientResponseError, ValueError) as err:
            raise BluestarApiError(0, code="things_failed", message="Unable to fetch devices from Blue Star API") from err

        if response.status >= 400:
            code = data.get("code") if isinstance(data, dict) else None
            exc_cls = BluestarAuthError if response.status == 401 else BluestarApiError
            raise exc_cls(response.status, code=code)

        if not isinstance(data, dict):
            raise BluestarApiError(response.status, code="invalid_response", message="Unexpected devices response")

        return data
