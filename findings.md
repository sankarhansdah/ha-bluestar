# Blue Star Smart AC Findings

This file is the working reference for the Blue Star Smart AC reverse engineering effort, the localhost test webapp, and the Home Assistant custom integration in this repo.

## Scope

- Android app version analyzed: `4.13.12`
- Primary cloud region: `ap-south-1`
- Main API base: `https://n3on22cp53.execute-api.ap-south-1.amazonaws.com/prod`
- Current working implementations:
  - Web test app: [webapp/server.mjs](/Users/sankarkumarhansdah/Projects/Bluestar/webapp/server.mjs)
  - Home Assistant custom component: [custom_components/bluestar](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar)

## App transport order

The Android app does not use only one path. The control order in the app is:

1. BLE if a direct BLE session is active.
2. AWS IoT MQTT if the cloud broker connection is active.
3. LAN UDP if recent local discovery/presence exists.

For the current repo, the working control path is AWS IoT MQTT. LAN UDP and BLE are documented here but are not wired into the shipped implementations yet.

## Cloud login and inventory

### Login

Endpoint:

- `POST /auth/login`

Request body:

```json
{
  "auth_id": "<email-or-phone>",
  "auth_type": 0,
  "password": "<password>"
}
```

Notes:

- `auth_type = 1` for a 10-digit phone number.
- `auth_type = 0` for email.

Headers used by the app:

- `X-APP-VER: v4.13.12-148`
- `X-OS-NAME: Android`
- `X-OS-VER: v15-35`
- `User-Agent: com.bluestarindia.bluesmart`

Important response fields:

- `session`: required for `X-APP-SESSION`
- `mi`: base64 of `<aws_iot_endpoint>::<access_key>::<secret_key>`

### Inventory

Endpoints:

- `GET /things`
- `GET /groups`

Important `GET /things` behavior:

- Device identity may be `thing_id` instead of `id`.
- Current server state comes back in `states[thing_id]`.
- `user_config.uat` is the device access token used by LAN UDP and BLE.
- `model_config` contains the mode, fan, temp range, display-digit, remote-type, and eco configuration needed to mirror the app behavior exactly.

Important discovery pitfall:

- The API may return `thing_id` without `id`. Both the webapp and HA integration now handle this.

## AWS IoT MQTT

### Connection

- Service: AWS IoT Device Gateway over SigV4-signed WebSocket
- Region: `ap-south-1`
- MQTT client ID: `u-<session_id>`

### Topics

- Publish desired state: `$aws/things/<thing_id>/shadow/update`
- Publish force sync: `things/<thing_id>/control`
- Subscribe reported state: `things/<thing_id>/state/reported`
- Subscribe presence: `$aws/events/presence/+/<thing_id>`

### Desired shadow payload

The app wraps desired-state writes like this:

```json
{
  "state": {
    "desired": {
      "...": "...",
      "ts": 1710000000000,
      "src": "anmq"
    }
  }
}
```

Notes:

- `src` for MQTT is `anmq`.
- `ts` is added before publishing.
- The current implementations optimistically update local state after publish, then reconcile against reported-state MQTT messages.

### Force sync payload

```json
{
  "fpsh": 1
}
```

## LAN UDP

The app supports direct LAN control, but this repo does not implement it yet.

Known details:

- Port: `44542/udp`
- Source key: `anlan`
- Outbound cleartext envelope:

```json
{
  "type": 1,
  "uat": "<device_uat>",
  "state": {
    "desired": {
      "...": "...",
      "src": "anlan"
    }
  }
}
```

Encryption details from the app:

- AES/CBC/PKCS7Padding for outbound packets
- Key is the first 16 characters of `uat`
- Packets are sent repeatedly, `25` times, with about `100 ms` delay

Inbound LAN packets are wrapped as:

- `(<mac>|<base64_payload>)`

## BLE

The app uses Espressif BLUFI for onboarding and local command paths. This repo does not implement BLE.

Known custom BLE message types:

- `0`: bind request
- `1`: state update
- `2`: Wi-Fi configure
- `3`: Wi-Fi scan
- `4`: onboarding completion/status
- `5`: encrypted state wrapper
- `6`: bind response/product info
- `7`: stop onboarding

BLE desired-state envelope mirrors LAN/MQTT, but uses `src: "anble"`.

## Important state keys

Core keys used in the app and now supported by the exact command layer:

- `pow`: power
- `stemp`: set temperature
- `ctemp`: current/ambient temperature
- `mode`: HVAC mode
- `fspd`: fan speed
- `hswing`: horizontal swing
- `vswing`: vertical swing
- `swing_4way`: 4-way swing
- `turbo`: turbo/powerful
- `sleep`: sleep mode
- `displayunit`: Celsius/Fahrenheit display unit
- `display`: panel display on/off
- `eco`: eco or 5-in-1/6-in-1 mode family
- `esave`: energy saver
- `health`: purifier/health mode
- `irest`: iRest
- `fixlock`: fixed-mode lock
- `prf`: user preference profile
- `ai`: AI Pro+
- `climate`: climate preset
- `m_buz`: buzzer
- `on_lock`
- `off_lock`
- `stemp_lock`
- `mode_lock`
- `fspd_lock`
- `rtll`: lower temperature limit
- `rtul`: upper temperature limit
- `flt_alarm_rst`: filter alarm reset
- `s_clean`: self clean
- `df_clean`: defrost clean

## Exact app command mapping

The webapp and HA integration now expose the mapped app-style command catalog. The following are the important command shapes.

### Simple commands

| Command | Payload | Notes |
| --- | --- | --- |
| `power` | `{"pow":1}` or `{"pow":0}` | Mirrors `setPowerState` |
| `temperature` | `{"stemp":"24.0"}` | Sent in the currently displayed unit |
| `temperature-unit` | `{"displayunit":0}` or `{"displayunit":1}` | Celsius/Fahrenheit display setting |
| `fan` | `{"fspd":4}` | Mirrors `setFanSpeed` |
| `horizontal-swing` | `{"hswing":0}` | Mirrors `setHorizontalSwingState` |
| `vertical-swing` | `{"vswing":0}` | Mirrors `setVerticalSwingState` |
| `four-way-swing` | `{"swing_4way":{"louver":1,"position":0}}` | Mirrors `set4WaySwingState` |
| `display` | `{"display":1}` or `{"display":0}` | Panel display |
| `self-clean` | `{"s_clean":1}` or `{"s_clean":0}` | |
| `defrost-clean` | `{"df_clean":1}` or `{"df_clean":0}` | |
| `filter-reset` | `{"flt_alarm_rst":0}` | |
| `health` | `{"health":1}` or `{"health":0}` | |
| `buzzer` | `{"m_buz":1}` | Numeric value from the app |
| `comfort-sleep` | `{"sleep":1}` or `{"sleep":0}` | Device-side sleep toggle only |
| `on-lock` | `{"on_lock":1}` or `{"on_lock":0}` | |
| `off-lock` | `{"off_lock":1}` or `{"off_lock":0}` | |
| `temperature-lock` | `{"stemp_lock":1}` or `{"stemp_lock":0}` | |
| `mode-lock` | `{"mode_lock":1}` or `{"mode_lock":0}` | |
| `fan-speed-lock` | `{"fspd_lock":1}` or `{"fspd_lock":0}` | |
| `lower-temperature-limit` | `{"rtll":"18"}` | String in the payload |
| `upper-temperature-limit` | `{"rtul":"28"}` | String in the payload |
| `fix-and-lock` | `{"fixlock":1}` | Numeric |

### Mode command

Normal mode change payload:

```json
{
  "mode": {
    "value": 2,
    "stemp": "24",
    "fspd": 4
  }
}
```

Important app behavior:

- If no explicit temperature is supplied, the app uses the per-mode configured temperature from `user_config.mode.<mode>.stemp`, else the mode default from `model_config.mode.<mode>.stemp.default`.
- If display unit is Fahrenheit, the outgoing default/configured temperature is converted before sending.
- If no explicit fan speed is supplied, the app uses the per-mode configured fan speed from `user_config.mode.<mode>.fspd`, else the mode default.
- If `prf != 0`, the app first sends `{"prf":{"value":0}}`, waits about `200 ms`, then sends the mode payload.
- For older heat firmware, the app uses a legacy sequence:
  - `{"mode":{"value":<heat>}}`
  - `{"stemp":"..."}`
  - `{"fspd":...}`

### Turbo

Base payload:

```json
{
  "turbo": 1
}
```

Commercial AC behavior when enabling:

- Also sets `fspd` to high/turbo
- Also sets `stemp` to `16` or `16.0` depending on display-digit config

Commercial AC behavior when disabling:

- If `user_config.before_turbo` exists, the app restores `fspd` and `stemp`

### AI Pro+

Payload shape:

```json
{
  "ai": {
    "value": 1,
    "mode": 2,
    "stemp": "24",
    "fspd": 0
  }
}
```

Behavior:

- Enabling forces cool mode plus the cool-mode default/configured temperature and auto fan
- Disabling may restore the cool-mode fan value

### Climate presets

Top-level shape:

```json
{
  "climate": 2,
  "mode": {
    "value": 2,
    "stemp": "24",
    "fspd": 4
  }
}
```

Behavior:

- If enabling climate on commercial AC while `sleep == 1`, the app also clears sleep
- The nested `mode` payload depends on `climate`, `remote_type`, `display_digit`, and `before_climate`
- `climate = 0` restores `user_config.before_climate` if present

### iRest

Primary payload:

```json
{
  "irest": {
    "value": 1,
    "mode": 2,
    "fspd": 4,
    "stemp": "24",
    "hswing": 6,
    "vswing": 6,
    "irest_tmr": 60
  }
}
```

Follow-up behavior:

- If 4-way swing values are provided, the app sends follow-up `swing_4way` payloads after the main `irest` write

To disable:

```json
{
  "irest": {
    "value": 0
  }
}
```

### Preference profile

Primary payload:

```json
{
  "prf": {
    "value": 1,
    "mode": 2,
    "stemp": "24",
    "fspd": 4,
    "hswing": 6,
    "vswing": 6
  }
}
```

Behavior:

- If turbo is active on commercial AC, the app also includes `turbo: 0`
- If 4-way swing values are supplied:
  - all values identical: one write with `louver: 0`
  - mixed values: one write per louver

To disable:

```json
{
  "prf": {
    "value": 0
  }
}
```

### Eco

Payload shape:

```json
{
  "eco": {
    "value": 1,
    "fspd": 3
  }
}
```

Behavior:

- `value = 0` falls back to the cool-mode configured/default fan or low fan
- non-zero values may use `model_config.eco.values.<value>.fspd`

### ESave

Sequence:

1. `{"esave":1}`
2. `{"stemp":"24"}` or Fahrenheit-equivalent display value

## Webapp implementation

Relevant files:

- [webapp/server.mjs](/Users/sankarkumarhansdah/Projects/Bluestar/webapp/server.mjs)
- [webapp/public/index.html](/Users/sankarkumarhansdah/Projects/Bluestar/webapp/public/index.html)
- [webapp/public/app.js](/Users/sankarkumarhansdah/Projects/Bluestar/webapp/public/app.js)
- [webapp/README.md](/Users/sankarkumarhansdah/Projects/Bluestar/webapp/README.md)

What the webapp now supports:

- exact cloud login flow
- device discovery from `/things`
- AWS IoT MQTT over SigV4 WebSocket
- reported-state and presence subscriptions
- raw JSON shadow patch publishing
- exact command catalog for the mapped app commands
- advanced per-device command runner at `POST /api/devices/:thing_id/exact/:command`
- debug output showing the last published topic and payload

Useful endpoints:

- `GET /api/state`
- `GET /api/debug`
- `GET /api/commands`
- `POST /api/login`
- `POST /api/logout`
- `POST /api/refresh`
- `POST /api/devices/:thing_id/control`
- `POST /api/devices/:thing_id/exact/:command`
- `POST /api/devices/:thing_id/sync`

## Home Assistant implementation

Relevant files:

- [custom_components/bluestar/__init__.py](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/__init__.py)
- [custom_components/bluestar/runtime.py](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/runtime.py)
- [custom_components/bluestar/protocol.py](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/protocol.py)
- [custom_components/bluestar/climate.py](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/climate.py)
- [custom_components/bluestar/services.yaml](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/services.yaml)

What the custom component now supports:

- Blue Star account login
- `/things` inventory parsing with `id` or `thing_id`
- AWS IoT MQTT shadow control
- climate entity for normal AC usage
- exact command execution service for all mapped app-style commands
- raw patch service
- force-sync service

Registered services:

- `bluestar.execute_command`
- `bluestar.force_sync`
- `bluestar.send_raw_patch`

Practical HA usage:

- Use the climate entity for standard power, mode, target temp, and fan operations.
- Use `bluestar.execute_command` for anything more exact, such as turbo, display, self-clean, AI Pro+, climate presets, locks, iRest, preference profiles, eco, and esave.

## HACS packaging

The repository now includes the basic HACS scaffolding:

- [hacs.json](/Users/sankarkumarhansdah/Projects/Bluestar/hacs.json)
- [README.md](/Users/sankarkumarhansdah/Projects/Bluestar/README.md)
- [.github/workflows/hassfest.yaml](/Users/sankarkumarhansdah/Projects/Bluestar/.github/workflows/hassfest.yaml)

What this means:

- The repo is structured correctly for HACS as a custom integration repository.
- Users can install it from HACS as a custom repository once it is on public GitHub.
- The integration metadata is now wired for `https://github.com/sankarhansdah/ha-bluestar`.
- The Home Assistant integration now includes local brand images from the Android app launcher icon at [custom_components/bluestar/brand/icon.png](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/brand/icon.png) and [custom_components/bluestar/brand/logo.png](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/brand/logo.png).
- Service actions now have custom icons via [custom_components/bluestar/icons.json](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/icons.json).

## Known gaps

- LAN UDP direct control is documented but not implemented.
- BLE onboarding/control is documented but not implemented.
- Group control and preference cloud endpoints are not currently exposed in the webapp or HA integration.
- The mobile app also persists some user-preference data back to API endpoints. The current integrations focus on device control via MQTT shadow updates.

## Recommended next steps

1. Implement LAN UDP control as a fallback path using `uat` and the AES/CBC envelope.
2. Add group support if Blue Star group operations matter for your setup.
3. Expand the Home Assistant integration with optional entities for turbo, display, eco, health, and sleep if you want them surfaced as native HA controls instead of service calls.
4. Capture a few packet-level examples from real devices for each advanced command to validate the remaining edge cases.
