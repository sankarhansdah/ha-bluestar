# Blue Star test web app

This is a standalone test harness for the Blue Star Smart AC cloud path we mapped from the Android app.

What it does:

- logs in with the same `POST /auth/login` flow as the mobile app
- fetches devices from `GET /things`
- opens the AWS IoT MQTT connection used by the app
- publishes shadow desired-state updates to control the AC
- exposes an exact app-command runner for the functions mapped from `ThingService`
- streams live state changes back into the browser

Current scope:

- single-user server session
- cloud MQTT control path only
- raw JSON patch support for protocol experiments
- exact command coverage for the app functions documented in `findings.md`

## Run

```bash
cd webapp
npm install
npm start
```

Then open `http://127.0.0.1:8787`.

## Endpoints

- `GET /api/state`
- `GET /api/commands`
- `GET /api/events`
- `POST /api/login`
- `POST /api/logout`
- `POST /api/refresh`
- `POST /api/devices/:thing_id/control`
- `POST /api/devices/:thing_id/exact/:command`
- `POST /api/devices/:thing_id/sync`

## Notes

- The server keeps Blue Star credentials and MQTT publishing on the backend. The browser never receives the Blue Star password or AWS secret key.
- The browser does receive the device inventory and raw reported state. That is intentional for debugging.
- There is no persistent session store or user auth around this test app. Keep it on localhost.
- LAN UDP and BLE are not wired into this web app yet.
- The exact command runner mirrors the app command shapes we mapped, including multi-step sequences like preference resets, climate presets, and legacy heat-mode handling.
