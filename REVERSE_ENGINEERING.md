## Blue Star Smart AC protocol notes

The `4.13.12` Android app uses three control paths for AC devices:

1. Cloud MQTT over AWS IoT.
2. Local UDP on the LAN.
3. Local BLE for onboarding and near-device commands.

### Cloud API

Base API:

- `https://n3on22cp53.execute-api.ap-south-1.amazonaws.com/prod`

Relevant endpoints:

- `POST /auth/login`
- `GET /things`
- `GET /groups`
- `PUT /groups/{id}/state`
- `PUT /things/{id}/preferences`
- `PUT /groups/{id}/preferences`

Login request body:

```json
{
  "auth_id": "<email-or-phone>",
  "auth_type": 0,
  "password": "<password>"
}
```

`auth_type` is `1` for a 10-digit phone number, otherwise `0`.

Important login response fields:

- `session`: user session token, sent back as `X-APP-SESSION`
- `mi`: base64 blob that decodes to `<aws_iot_endpoint>::<access_key>::<secret_key>`

The app mimics these headers on API calls:

- `X-APP-VER: v4.13.12-148`
- `X-OS-NAME: Android`
- `X-OS-VER: v15-35`
- `User-Agent: com.bluestarindia.bluesmart`
- `X-APP-SESSION: <session>`

### Device inventory

`GET /things` returns:

- `things`: list of device objects
- `states`: map of `thing_id -> {state, state_ts, connected, conn_ts}`

Each thing includes `user_config.uat`, which is the device access token used for BLE and LAN control.

### MQTT

The app connects to AWS IoT in `ap-south-1` with client ID:

- `u-<session_id>`

Topics:

- Publish desired state: `$aws/things/<thing_id>/shadow/update`
- Publish force-sync: `things/<thing_id>/control`
- Subscribe device state: `things/<thing_id>/state/reported`
- Subscribe presence: `$aws/events/presence/+/<thing_id>`
- Subscribe group state: `groups/<group_id>/state/reported`

Desired state payload sent by the app:

```json
{
  "state": {
    "desired": {
      "...": "...",
      "src": "anmq"
    }
  }
}
```

Force-sync payload:

```json
{
  "fpsh": 1
}
```

Presence topics use the topic name itself to signal online/offline:

- topic containing `disconnected` => offline
- otherwise => online

### LAN UDP

Port:

- `44542/udp`

Outbound local control payload before encryption:

```json
{
  "type": 1,
  "uat": "<device_user_access_token>",
  "state": {
    "desired": {
      "...": "...",
      "src": "anlan"
    }
  }
}
```

The app encrypts LAN payloads with:

- AES/CBC/PKCS7Padding
- key = first 16 chars of `uat`
- transport value = base64(ciphertext)

Inbound LAN messages are wrapped like:

- `(<mac>|<base64_payload>)`

The base64 payload decrypts with:

- AES/CBC/NoPadding
- key = first 16 chars of `uat`

### BLE / BLUFI

The app uses Espressif BLUFI for onboarding and custom commands.

Custom BLE message types:

- `0`: bind request, generates a new `uat`
- `1`: state update
- `2`: Wi-Fi configure
- `3`: Wi-Fi scan
- `4`: Wi-Fi completion/status
- `5`: encrypted state report wrapper
- `6`: bind response / product info
- `7`: stop onboarding

BLE state update payload:

```json
{
  "type": 1,
  "uat": "<device_user_access_token>",
  "state": {
    "desired": {
      "...": "...",
      "src": "anble"
    }
  }
}
```

### State keys

Important feature keys extracted from the app:

- `pow`: power
- `stemp`: set temperature
- `ctemp`: ambient temperature
- `mode`: HVAC mode
- `fspd`: fan speed
- `hswing`: horizontal swing
- `vswing`: vertical swing
- `swing_4way`: 4-way swing
- `turbo`: turbo / powerful
- `sleep`: sleep mode
- `displayunit`: temperature unit
- `display`: panel display
- `eco`: eco / 5-in-1 / 6-in-1 family
- `esave`: energy saver
- `health`: health / purifier
- `irest`: iRest
- `fixlock`: fix-and-lock

### Home Assistant implementation strategy

The first viable HA path is:

1. Log in to the cloud API.
2. Fetch `/things` to get device metadata, current state, `uat`, and `model_config`.
3. Decode `mi` from login.
4. Connect to AWS IoT over signed WebSocket MQTT.
5. Publish shadow desired-state updates and consume `state/reported` plus presence topics.

That is what the custom component in `custom_components/bluestar` implements.
