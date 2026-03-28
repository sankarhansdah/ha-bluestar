import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mqtt from "mqtt";

const BASE_URL = "https://n3on22cp53.execute-api.ap-south-1.amazonaws.com/prod";
const LOGIN_URL = `${BASE_URL}/auth/login`;
const THINGS_URL = `${BASE_URL}/things`;
const GROUPS_URL = `${BASE_URL}/groups`;

const APP_VERSION_HEADER = "v4.13.12-148";
const OS_NAME_HEADER = "Android";
const OS_VERSION_HEADER = "v15-35";
const USER_AGENT_HEADER = "com.bluestarindia.bluesmart";

const AWS_REGION = "ap-south-1";
const AWS_IOT_SERVICE = "iotdevicegateway";
const MQTT_KEEPALIVE_SECONDS = 30;
const SOURCE_MQTT = "anmq";
const REMOTE_TYPE_4_RAD = 10;
const EXACT_COMMAND_DELAY_MS = 200;

const EXACT_COMMAND_CATALOG = [
  { name: "power", params: { value: true }, description: "ThingService.setPowerState" },
  { name: "mode", params: { value: 2 }, description: "ThingService.setACMode" },
  { name: "temperature", params: { value: "24.0" }, description: "ThingService.setACTemperature" },
  { name: "fan", params: { value: 4 }, description: "ThingService.setFanSpeed" },
  { name: "temperature-unit", params: { value: 0 }, description: "ThingService.setTemperatureUnit" },
  { name: "turbo", params: { value: 1 }, description: "ThingService.setCoolingMode" },
  { name: "horizontal-swing", params: { value: 0 }, description: "ThingService.setHorizontalSwingState" },
  { name: "vertical-swing", params: { value: 0 }, description: "ThingService.setVerticalSwingState" },
  { name: "four-way-swing", params: { louver: 1, position: 0 }, description: "ThingService.set4WaySwingState" },
  { name: "display", params: { value: true }, description: "ThingService.setDisplay" },
  { name: "self-clean", params: { value: true }, description: "ThingService.setSelfClean" },
  { name: "defrost-clean", params: { value: true }, description: "ThingService.setDeFrostClean" },
  { name: "filter-reset", params: {}, description: "ThingService.setAlarmFilterCleanReset" },
  { name: "ai-pro-plus", params: { value: true }, description: "ThingService.setAiProPlusState" },
  { name: "health", params: { value: true }, description: "ThingService.setHealthState" },
  { name: "buzzer", params: { value: 1 }, description: "ThingService.setBuzzerState" },
  { name: "comfort-sleep", params: { value: true }, description: "ThingService.setComfortSleepMode" },
  { name: "climate", params: { value: 1 }, description: "ThingService.setClimateMode" },
  { name: "on-lock", params: { value: true }, description: "ThingService.setACOnLock" },
  { name: "off-lock", params: { value: true }, description: "ThingService.setACOffLock" },
  { name: "temperature-lock", params: { value: true }, description: "ThingService.setTemperatureLock" },
  { name: "mode-lock", params: { value: true }, description: "ThingService.setModeLock" },
  { name: "fan-speed-lock", params: { value: true }, description: "ThingService.setFanSpeedLock" },
  { name: "lower-temperature-limit", params: { value: "18" }, description: "ThingService.setLowerTemperatureLimit" },
  { name: "upper-temperature-limit", params: { value: "28" }, description: "ThingService.setUpperTemperatureLimit" },
  {
    name: "irest",
    params: {
      mode: 2,
      fanSpeed: 4,
      temperature: "24",
      horizontalSwing: 6,
      verticalSwing: 6,
      timer: 60,
      fourWay: [0, 0, 0, 0],
    },
    description: "ThingService.setIRest",
  },
  { name: "irest-off", params: {}, description: "ThingService.turnOffIRest" },
  {
    name: "preference",
    params: {
      value: 1,
      mode: 2,
      fanSpeed: 4,
      temperature: "24",
      horizontalSwing: 6,
      verticalSwing: 6,
      fourWay: [0, 0, 0, 0],
    },
    description: "ThingService.setUserPreference",
  },
  { name: "preference-off", params: {}, description: "ThingService.turnOffPreference" },
  { name: "fix-and-lock", params: { value: 1 }, description: "ThingService.setFixAndLock" },
  { name: "eco", params: { value: 1 }, description: "ThingService.setEcoMode" },
  { name: "esave", params: { value: true }, description: "ThingService.setESaveMode" },
];

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

class BluestarError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = details.statusCode ?? 500;
    this.code = details.code ?? "bluestar_error";
  }
}

class BluestarApiError extends BluestarError {
  constructor(message, details = {}) {
    super(message, {
      statusCode: details.statusCode ?? 502,
      code: details.code ?? "bluestar_api_error",
    });
  }
}

class BluestarAuthError extends BluestarApiError {
  constructor(message, details = {}) {
    super(message, {
      statusCode: details.statusCode ?? 401,
      code: details.code ?? "authentication_failed",
    });
  }
}

function apiHeaders(sessionId = null) {
  const headers = {
    "X-APP-VER": APP_VERSION_HEADER,
    "X-OS-NAME": OS_NAME_HEADER,
    "X-OS-VER": OS_VERSION_HEADER,
    "User-Agent": USER_AGENT_HEADER,
    "Content-Type": "application/json",
  };

  if (sessionId) {
    headers["X-APP-SESSION"] = sessionId;
  }

  return headers;
}

function apiVersionHeaders(sessionId, version) {
  return {
    ...apiHeaders(sessionId),
    "X-API-VERSION": version,
  };
}

function authType(authId) {
  return /^\d{10}$/.test(authId) ? 1 : 0;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new BluestarApiError("Blue Star API returned invalid JSON", {
      statusCode: response.status,
      code: "invalid_json",
    });
  }
}

function decodeBrokerInfo(encodedValue) {
  let decoded = "";
  try {
    decoded = Buffer.from(encodedValue, "base64").toString("utf8");
  } catch (error) {
    throw new BluestarApiError("Unable to decode broker metadata", {
      statusCode: 502,
      code: "invalid_broker_info",
    });
  }

  const [endpoint, accessKey, secretKey] = decoded.split("::", 3).map((value) => value?.trim() ?? "");
  if (!endpoint || !accessKey || !secretKey) {
    throw new BluestarApiError("Blue Star login did not include usable broker metadata", {
      statusCode: 502,
      code: "invalid_broker_info",
    });
  }

  return {
    endpoint,
    accessKey,
    secretKey,
  };
}

async function loginRequest(authIdValue, password) {
  let response;
  try {
    response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        auth_id: authIdValue,
        auth_type: authType(authIdValue),
        password,
      }),
    });
  } catch (error) {
    throw new BluestarApiError("Unable to reach the Blue Star login API", {
      statusCode: 502,
      code: "login_request_failed",
    });
  }

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "Blue Star login failed";
    const ErrorType = [400, 401, 403].includes(response.status) ? BluestarAuthError : BluestarApiError;
    throw new ErrorType(message, {
      statusCode: response.status,
      code: data?.code ?? "login_failed",
    });
  }

  const sessionId = String(data?.session ?? "").trim();
  const brokerInfo = decodeBrokerInfo(String(data?.mi ?? "").trim());

  if (!sessionId) {
    throw new BluestarAuthError("Blue Star login did not return a session token", {
      statusCode: 502,
      code: "missing_session",
    });
  }

  return {
    sessionId,
    brokerInfo,
  };
}

async function fetchThings(sessionId) {
  let response;
  try {
    response = await fetch(THINGS_URL, {
      method: "GET",
      headers: apiHeaders(sessionId),
    });
  } catch (error) {
    throw new BluestarApiError("Unable to reach the Blue Star device API", {
      statusCode: 502,
      code: "things_request_failed",
    });
  }

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "Unable to fetch Blue Star devices";
    const ErrorType = response.status === 401 ? BluestarAuthError : BluestarApiError;
    throw new ErrorType(message, {
      statusCode: response.status,
      code: data?.code ?? "things_failed",
    });
  }

  return data;
}

async function fetchGroups(sessionId) {
  let response;
  try {
    response = await fetch(GROUPS_URL, {
      method: "GET",
      headers: apiVersionHeaders(sessionId, "v1"),
    });
  } catch (error) {
    throw new BluestarApiError("Unable to reach the Blue Star groups API", {
      statusCode: 502,
      code: "groups_request_failed",
    });
  }

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "Unable to fetch Blue Star groups";
    const ErrorType = response.status === 401 ? BluestarAuthError : BluestarApiError;
    throw new ErrorType(message, {
      statusCode: response.status,
      code: data?.code ?? "groups_failed",
    });
  }

  return data;
}

function coerceInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coerceFloat(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function celsiusToFahrenheit(value) {
  return Math.round(((value * 9) / 5) + 32);
}

function fahrenheitToCelsius(value) {
  return Math.round(((value - 32) * 5) / 9);
}

function displayUsesFahrenheit(thing) {
  return coerceInt(thing.state.raw.displayunit, 0) === 1;
}

function displayTemperature(thing, value) {
  if (value === null || value === undefined) {
    return null;
  }

  return displayUsesFahrenheit(thing) ? celsiusToFahrenheit(value) : value;
}

function formatOneDecimal(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed.toFixed(1);
}

function truthy(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["1", "true", "on", "yes", "enable", "enabled"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function parseFirmwareVersion(version) {
  const [majorRaw = "0", minorRaw = "0"] = String(version ?? "").split(".");
  return {
    major: Number.parseInt(majorRaw, 10) || 0,
    minor: Number.parseInt(minorRaw, 10) || 0,
  };
}

function parseModeOptions(modelConfig) {
  const rawModes = modelConfig?.mode;
  if (!rawModes || typeof rawModes !== "object") {
    return [];
  }

  return Object.entries(rawModes)
    .map(([key, value]) => {
      const parsed = Number.parseInt(key, 10);
      if (!Number.isFinite(parsed) || !value || typeof value !== "object") {
        return null;
      }

      return {
        value: parsed,
        label: String(value.name ?? "").trim().toLowerCase(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.value - right.value);
}

function parseFanOptions(modelConfig) {
  const rawFans = modelConfig?.fspd;
  if (!rawFans || typeof rawFans !== "object") {
    return [];
  }

  return Object.entries(rawFans)
    .map(([key, value]) => {
      const parsed = Number.parseInt(key, 10);
      if (!Number.isFinite(parsed)) {
        return null;
      }

      return {
        value: parsed,
        label: String(value ?? "").trim().toLowerCase(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.value - right.value);
}

function defaultModeValue(thing) {
  const preferredOrder = ["cool", "auto", "heat", "dry", "fan"];
  for (const preferred of preferredOrder) {
    const match = thing.modeOptions.find((option) => option.label === preferred);
    if (match) {
      return match.value;
    }
  }

  return thing.modeOptions[0]?.value ?? null;
}

function heatModeValue(thing) {
  const match = thing.modeOptions.find((option) => option.label === "heat");
  return match?.value ?? null;
}

function defaultTemperatureForMode(thing, modeValue) {
  if (modeValue === null || modeValue === undefined) {
    return null;
  }

  const rawModes = thing.modelConfig?.mode;
  const modePayload = rawModes?.[String(modeValue)];
  const temperaturePayload = modePayload?.stemp;
  if (!temperaturePayload || typeof temperaturePayload !== "object") {
    return null;
  }

  return coerceFloat(temperaturePayload.default, null);
}

function displayTemperatureForMode(thing, modeValue) {
  const defaultTemp = defaultTemperatureForMode(thing, modeValue);
  if (defaultTemp === null || defaultTemp === undefined) {
    return null;
  }

  if (displayUsesFahrenheit(thing)) {
    return String(celsiusToFahrenheit(defaultTemp));
  }

  return String(defaultTemp);
}

function defaultTemperatureStringForMode(thing, modeValue) {
  const defaultTemp = defaultTemperatureForMode(thing, modeValue);
  if (defaultTemp === null || defaultTemp === undefined) {
    return null;
  }
  return String(defaultTemp);
}

function modeValueByLabel(thing, ...labels) {
  const normalized = new Set(labels.map((label) => String(label).trim().toLowerCase()));
  const match = thing.modeOptions.find((option) => normalized.has(option.label));
  return match?.value ?? null;
}

function fanValueByLabel(thing, ...labels) {
  const normalized = new Set(labels.map((label) => String(label).trim().toLowerCase()));
  const match = thing.fanOptions.find((option) => normalized.has(option.label));
  return match?.value ?? null;
}

function defaultFanForMode(thing, modeValue) {
  if (modeValue === null || modeValue === undefined) {
    return null;
  }

  const rawModes = thing.modelConfig?.mode;
  const modePayload = rawModes?.[String(modeValue)];
  const fanPayload = modePayload?.fspd;
  if (!fanPayload || typeof fanPayload !== "object") {
    return null;
  }

  return coerceInt(fanPayload.default, null);
}

function configuredTemperatureForMode(thing, modeValue) {
  const configured = thing.raw?.user_config?.mode?.[String(modeValue)]?.stemp;
  if (configured !== null && configured !== undefined && configured !== "") {
    return String(configured);
  }

  return defaultTemperatureStringForMode(thing, modeValue);
}

function configuredFanForMode(thing, modeValue) {
  const configured = thing.raw?.user_config?.mode?.[String(modeValue)]?.fspd;
  if (configured !== null && configured !== undefined && configured !== "") {
    return String(configured);
  }

  const fallback = defaultFanForMode(thing, modeValue);
  return fallback === null || fallback === undefined ? null : String(fallback);
}

function remoteType(thing) {
  return coerceInt(thing.modelConfig?.remote_type ?? thing.raw?.remote_type, 1000);
}

function displayDigits(thing) {
  return coerceInt(thing.modelConfig?.display_digit, 2);
}

function coolModeValue(thing) {
  return modeValueByLabel(thing, "cool") ?? defaultModeValue(thing);
}

function dryModeValue(thing) {
  return modeValueByLabel(thing, "dry") ?? defaultModeValue(thing);
}

function lowFanValue(thing) {
  return fanValueByLabel(thing, "low") ?? thing.fanOptions[0]?.value ?? null;
}

function midFanValue(thing) {
  return fanValueByLabel(thing, "medium", "med") ?? highFanValue(thing);
}

function highFanValue(thing) {
  return fanValueByLabel(thing, "high", "high high", "turbo") ?? thing.fanOptions.at(-1)?.value ?? null;
}

function turboFanValue(thing) {
  return fanValueByLabel(thing, "turbo") ?? highFanValue(thing);
}

function autoFanValue(thing) {
  return fanValueByLabel(thing, "auto") ?? lowFanValue(thing);
}

function beforeTurboState(thing) {
  const payload = thing.raw?.user_config?.before_turbo;
  return payload && typeof payload === "object" ? payload : null;
}

function beforeClimateState(thing) {
  const payload = thing.raw?.user_config?.before_climate;
  return payload && typeof payload === "object" ? payload : null;
}

function integerTemperatureString(thing, valueC) {
  if (displayUsesFahrenheit(thing)) {
    return String(celsiusToFahrenheit(valueC));
  }
  if (displayDigits(thing) === 2) {
    return String(Math.round(valueC));
  }
  return Number(valueC).toFixed(1);
}

function modeTemperatureValue(thing, modeValue, override = null) {
  if (override !== null && override !== undefined && override !== "") {
    return String(override);
  }

  const configured = configuredTemperatureForMode(thing, modeValue);
  if (configured === null || configured === undefined || configured === "") {
    return null;
  }

  const parsed = Number.parseFloat(configured);
  if (!Number.isFinite(parsed)) {
    return String(configured);
  }

  return integerTemperatureString(thing, parsed);
}

function modeFanValue(thing, modeValue, override = null) {
  if (override !== null && override !== undefined && override !== "") {
    return coerceInt(override, null);
  }
  return coerceInt(configuredFanForMode(thing, modeValue), null);
}

function seasonSettingsPayload(thing, climateValue) {
  if (climateValue === 0) {
    const payload = {
      value: coolModeValue(thing),
      stemp: integerTemperatureString(thing, minTemperatureC(thing)),
      fspd: lowFanValue(thing),
    };
    const beforeClimate = beforeClimateState(thing);
    if (beforeClimate) {
      payload.value = coerceInt(beforeClimate.mode, payload.value);
      payload.stemp = String(beforeClimate.stemp ?? payload.stemp);
      payload.fspd = coerceInt(beforeClimate.fspd, payload.fspd);
    }
    return payload.value === null ? null : payload;
  }

  if (thing.modelType !== 2) {
    return null;
  }

  if (climateValue === 1) {
    return {
      value: remoteType(thing) === REMOTE_TYPE_4_RAD ? coolModeValue(thing) : (heatModeValue(thing) ?? coolModeValue(thing)),
      stemp: displayDigits(thing) === 2 ? (remoteType(thing) === REMOTE_TYPE_4_RAD ? "26" : "21") : (remoteType(thing) === REMOTE_TYPE_4_RAD ? "26.0" : "21.0"),
      fspd: midFanValue(thing),
    };
  }

  if (climateValue === 2) {
    return {
      value: coolModeValue(thing),
      stemp: displayDigits(thing) === 2 ? "24" : "24.0",
      fspd: remoteType(thing) === REMOTE_TYPE_4_RAD ? turboFanValue(thing) : highFanValue(thing),
    };
  }

  if (climateValue === 3) {
    return {
      value: dryModeValue(thing),
      stemp: remoteType(thing) === REMOTE_TYPE_4_RAD ? (displayDigits(thing) === 2 ? "24" : "24.0") : (displayDigits(thing) === 2 ? "25" : "25.0"),
      fspd: lowFanValue(thing),
    };
  }

  return null;
}

function protocolError(message, code = "invalid_command_params") {
  return new BluestarError(message, {
    statusCode: 400,
    code,
  });
}

function displayValueString(value) {
  const formatted = formatOneDecimal(value);
  if (formatted === null) {
    throw protocolError("Temperature must be numeric", "invalid_temperature");
  }
  return formatted;
}

function buildExactCommandSequence(thing, command, params = {}) {
  const payload = params && typeof params === "object" && !Array.isArray(params) ? { ...params } : {};
  const name = String(command ?? "").trim().toLowerCase();

  if (name === "power") {
    return [{ pow: truthy(payload.value ?? true) ? 1 : 0 }];
  }

  if (name === "temperature") {
    return [{ stemp: displayValueString(payload.value) }];
  }

  if (name === "temperature-unit") {
    const unitValue = coerceInt(payload.value, null);
    if (unitValue === null) {
      throw protocolError("Temperature unit value must be numeric", "invalid_temperature_unit");
    }
    return [{ displayunit: unitValue }];
  }

  if (name === "fan") {
    const fanValue = coerceInt(payload.value, null);
    if (fanValue === null) {
      throw protocolError("Fan speed must be numeric", "invalid_fan_speed");
    }
    return [{ fspd: fanValue }];
  }

  if (name === "mode") {
    const modeValue = coerceInt(payload.value, null);
    if (modeValue === null) {
      throw protocolError("Mode value must be numeric", "invalid_mode");
    }

    const modePayload = { value: modeValue };
    const resolvedTemperature = modeTemperatureValue(thing, modeValue, payload.temperature ?? null);
    if (resolvedTemperature !== null && resolvedTemperature !== undefined && resolvedTemperature !== "") {
      modePayload.stemp = resolvedTemperature;
    }

    const resolvedFan = modeFanValue(thing, modeValue, payload.fanSpeed ?? null);
    if (resolvedFan !== null && resolvedFan !== undefined) {
      modePayload.fspd = resolvedFan;
    }

    const topLevel = { mode: modePayload };
    if (thing.modelType === 2) {
      if (coerceInt(thing.state.raw.climate, 0) !== 0) {
        topLevel.climate = 0;
      }
      if (coerceInt(thing.state.raw.turbo, 0) !== 0) {
        topLevel.turbo = 0;
      }
      if (coerceInt(thing.state.raw.sleep, 0) === 1) {
        topLevel.sleep = 0;
      }
    }

    const firmware = parseFirmwareVersion(thing.raw?.f_ver);
    const heatMode = heatModeValue(thing);
    if (modeValue === heatMode && firmware.major === 0 && firmware.minor <= 1) {
      const sequence = [{ mode: { value: modeValue } }];
      if (modePayload.stemp !== undefined) {
        sequence.push({ stemp: modePayload.stemp });
      }
      if (modePayload.fspd !== undefined) {
        sequence.push({ fspd: modePayload.fspd });
      }
      return sequence;
    }

    if (coerceInt(thing.state.raw.prf, 0) !== 0) {
      return [{ prf: { value: 0 } }, topLevel];
    }

    return [topLevel];
  }

  if (name === "turbo") {
    const turboValue = coerceInt(payload.value, null);
    if (turboValue === null) {
      throw protocolError("Turbo value must be numeric", "invalid_turbo");
    }

    const turboPayload = { turbo: turboValue };
    if (thing.modelType === 2 && turboValue !== 0) {
      const highFan = highFanValue(thing);
      if (highFan !== null && highFan !== undefined) {
        turboPayload.fspd = highFan;
      }
      turboPayload.stemp = displayDigits(thing) === 2 ? "16" : "16.0";
    } else if (turboValue === 0) {
      const beforeTurbo = beforeTurboState(thing);
      if (beforeTurbo) {
        const fanSpeed = coerceInt(beforeTurbo.fspd, null);
        if (fanSpeed !== null) {
          turboPayload.fspd = fanSpeed;
        }
        if (beforeTurbo.stemp !== null && beforeTurbo.stemp !== undefined && beforeTurbo.stemp !== "") {
          turboPayload.stemp = String(beforeTurbo.stemp);
        }
      }
    }
    return [turboPayload];
  }

  const simpleBooleanCommands = {
    display: "display",
    "self-clean": "s_clean",
    "defrost-clean": "df_clean",
    health: "health",
    "comfort-sleep": "sleep",
    "on-lock": "on_lock",
    "off-lock": "off_lock",
    "temperature-lock": "stemp_lock",
    "mode-lock": "mode_lock",
    "fan-speed-lock": "fspd_lock",
  };
  if (simpleBooleanCommands[name]) {
    return [{ [simpleBooleanCommands[name]]: truthy(payload.value ?? true) ? 1 : 0 }];
  }

  if (name === "horizontal-swing") {
    const swingValue = coerceInt(payload.value, null);
    if (swingValue === null) {
      throw protocolError("Horizontal swing value must be numeric", "invalid_horizontal_swing");
    }
    return [{ hswing: swingValue }];
  }

  if (name === "vertical-swing") {
    const swingValue = coerceInt(payload.value, null);
    if (swingValue === null) {
      throw protocolError("Vertical swing value must be numeric", "invalid_vertical_swing");
    }
    return [{ vswing: swingValue }];
  }

  if (name === "four-way-swing") {
    const louver = coerceInt(payload.louver, null);
    const position = coerceInt(payload.position, null);
    if (louver === null || position === null) {
      throw protocolError("4-way swing requires numeric louver and position values", "invalid_four_way_swing");
    }
    return [{ swing_4way: { louver, position } }];
  }

  if (name === "filter-reset") {
    return [{ flt_alarm_rst: 0 }];
  }

  if (name === "ai-pro-plus") {
    const enabled = truthy(payload.value ?? true);
    const coolMode = coolModeValue(thing);
    const aiPayload = { value: enabled ? 1 : 0 };
    if (enabled) {
      if (coolMode !== null && coolMode !== undefined) {
        aiPayload.mode = coolMode;
        const temperature = modeTemperatureValue(thing, coolMode);
        if (temperature !== null && temperature !== undefined && temperature !== "") {
          aiPayload.stemp = temperature;
        }
      }
      const autoFan = autoFanValue(thing);
      if (autoFan !== null && autoFan !== undefined) {
        aiPayload.fspd = autoFan;
      }
    } else if (coolMode !== null && coolMode !== undefined) {
      const coolFan = modeFanValue(thing, coolMode);
      if (coolFan !== null && coolFan !== undefined) {
        aiPayload.fspd = coolFan;
      }
    }
    return [{ ai: aiPayload }];
  }

  if (name === "buzzer") {
    const level = coerceInt(payload.value, null);
    if (level === null) {
      throw protocolError("Buzzer level must be numeric", "invalid_buzzer");
    }
    return [{ m_buz: level }];
  }

  if (name === "climate") {
    const climateValue = coerceInt(payload.value, null);
    if (climateValue === null) {
      throw protocolError("Climate value must be numeric", "invalid_climate");
    }
    const climatePayload = { climate: climateValue };
    if (climateValue !== 0 && thing.modelType === 2 && coerceInt(thing.state.raw.sleep, 0) === 1) {
      climatePayload.sleep = 0;
    }
    const seasonSettings = seasonSettingsPayload(thing, climateValue);
    if (seasonSettings) {
      climatePayload.mode = seasonSettings;
    }
    return [climatePayload];
  }

  if (name === "lower-temperature-limit") {
    if (payload.value === null || payload.value === undefined || payload.value === "") {
      throw protocolError("Lower temperature limit value is required", "invalid_lower_limit");
    }
    return [{ rtll: String(payload.value) }];
  }

  if (name === "upper-temperature-limit") {
    if (payload.value === null || payload.value === undefined || payload.value === "") {
      throw protocolError("Upper temperature limit value is required", "invalid_upper_limit");
    }
    return [{ rtul: String(payload.value) }];
  }

  if (name === "irest") {
    const modeValue = coerceInt(payload.mode, null);
    const fanValue = coerceInt(payload.fanSpeed, null);
    const timerValue = coerceInt(payload.timer, null);
    if (modeValue === null || fanValue === null || timerValue === null) {
      throw protocolError("iRest requires numeric mode, fanSpeed, and timer values", "invalid_irest");
    }

    const irestPayload = {
      value: 1,
      mode: modeValue,
      fspd: fanValue,
      stemp: String(payload.temperature ?? "24"),
      hswing: coerceInt(payload.horizontalSwing, 6) ?? 6,
      vswing: coerceInt(payload.verticalSwing, 6) ?? 6,
      irest_tmr: timerValue,
    };
    const sequence = [{ irest: irestPayload }];
    if (Array.isArray(payload.fourWay)) {
      payload.fourWay.forEach((position, index) => {
        const parsedPosition = coerceInt(position, null);
        if (parsedPosition !== null) {
          sequence.push({ swing_4way: { louver: index + 1, position: parsedPosition } });
        }
      });
    }
    return sequence;
  }

  if (name === "irest-off") {
    return [{ irest: { value: 0 } }];
  }

  if (name === "preference") {
    const prefValue = coerceInt(payload.value, null);
    const modeValue = coerceInt(payload.mode, null);
    const fanValue = coerceInt(payload.fanSpeed, null);
    if (prefValue === null || modeValue === null || fanValue === null) {
      throw protocolError("Preference requires numeric value, mode, and fanSpeed fields", "invalid_preference");
    }

    const prefPayload = {
      value: prefValue,
      mode: modeValue,
      stemp: String(payload.temperature ?? "24"),
      fspd: fanValue,
    };
    const horizontal = coerceInt(payload.horizontalSwing, null);
    const vertical = coerceInt(payload.verticalSwing, null);
    if (horizontal !== null) {
      prefPayload.hswing = horizontal;
    }
    if (vertical !== null) {
      prefPayload.vswing = vertical;
    }

    const topLevel = { prf: prefPayload };
    if (thing.modelType === 2 && coerceInt(thing.state.raw.turbo, 0) !== 0) {
      topLevel.turbo = 0;
    }

    const sequence = [topLevel];
    if (Array.isArray(payload.fourWay) && payload.fourWay.length) {
      const parsedPositions = payload.fourWay.map((item) => coerceInt(item, null));
      if (parsedPositions.length && parsedPositions.every((item) => item !== null)) {
        const first = parsedPositions[0];
        if (parsedPositions.every((item) => item === first)) {
          sequence.push({ swing_4way: { louver: 0, position: first } });
        } else {
          parsedPositions.forEach((position, index) => {
            sequence.push({ swing_4way: { louver: index + 1, position } });
          });
        }
      }
    }
    return sequence;
  }

  if (name === "preference-off") {
    return [{ prf: { value: 0 } }];
  }

  if (name === "fix-and-lock") {
    const value = coerceInt(payload.value, null);
    if (value === null) {
      throw protocolError("Fix-and-lock value must be numeric", "invalid_fix_and_lock");
    }
    return [{ fixlock: value }];
  }

  if (name === "eco") {
    const ecoValue = coerceInt(payload.value, null);
    if (ecoValue === null) {
      throw protocolError("Eco value must be numeric", "invalid_eco");
    }

    const ecoPayload = { value: ecoValue };
    if (ecoValue === 0) {
      const coolMode = coolModeValue(thing) ?? defaultModeValue(thing);
      ecoPayload.fspd = modeFanValue(thing, coolMode, null) ?? lowFanValue(thing);
    } else {
      const values = thing.modelConfig?.eco?.values;
      const selected = values?.[String(ecoValue)];
      const fanSpeed = coerceInt(selected?.fspd, null);
      if (fanSpeed) {
        ecoPayload.fspd = fanSpeed;
      }
    }
    return [{ eco: ecoPayload }];
  }

  if (name === "esave") {
    const enabled = truthy(payload.value ?? true);
    const sequence = [{ esave: enabled ? 1 : 0 }];
    if (enabled) {
      sequence.push({ stemp: integerTemperatureString(thing, 24.0) });
    }
    return sequence;
  }

  throw protocolError(`Unsupported exact command: ${command}`, "unsupported_command");
}

function minTemperatureC(thing) {
  return Number(thing.modelConfig?.min_temp ?? 16);
}

function maxTemperatureC(thing) {
  return Number(thing.modelConfig?.max_temp ?? 30);
}

function buildThing(rawThing, rawState, previousThing = null) {
  const userConfig = rawThing?.user_config && typeof rawThing.user_config === "object" ? rawThing.user_config : {};
  const modelConfig = rawThing?.model_config && typeof rawThing.model_config === "object" ? rawThing.model_config : {};
  const thingId = String(rawThing?.id ?? rawThing?.thing_id ?? "").trim();

  const state = {
    raw: {},
    stateTs: 0,
    connected: false,
    connTs: 0,
  };

  if (rawState && typeof rawState === "object") {
    const nextStateTs = coerceInt(rawState.state_ts, 0);
    if (nextStateTs >= state.stateTs && rawState.state && typeof rawState.state === "object") {
      state.raw = { ...rawState.state };
      state.stateTs = nextStateTs;
      state.connected = Boolean(rawState.connected);
      state.connTs = coerceInt(rawState.conn_ts, 0);
    }
  }

  if (previousThing) {
    if (previousThing.state.stateTs > state.stateTs) {
      state.raw = { ...previousThing.state.raw };
      state.stateTs = previousThing.state.stateTs;
    }
    if (previousThing.state.connTs > state.connTs) {
      state.connected = previousThing.state.connected;
      state.connTs = previousThing.state.connTs;
    }
  }

  const thing = {
    id: thingId,
    name: String(userConfig.name ?? `AC-${thingId.slice(-4)}`),
    modelId: String(rawThing?.model_id ?? ""),
    modelType: coerceInt(rawThing?.model_type, 0),
    productCategory: String(userConfig.product_category ?? rawThing?.product_category ?? "7"),
    userAccessToken: String(userConfig.uat ?? ""),
    modelConfig,
    raw: rawThing,
    state,
  };

  thing.modeOptions = parseModeOptions(modelConfig);
  thing.fanOptions = parseFanOptions(modelConfig);
  return thing;
}

function thingToPublicDevice(thing) {
  const targetC = coerceFloat(thing.state.raw.stemp, null);
  const currentC = coerceFloat(thing.state.raw.ctemp, null);
  const modeValue = coerceInt(thing.state.raw.mode, null);
  const fanValue = coerceInt(thing.state.raw.fspd, null);

  return {
    id: thing.id,
    name: thing.name,
    modelId: thing.modelId,
    modelType: thing.modelType,
    productCategory: thing.productCategory,
    online: thing.state.connected,
    stateTs: thing.state.stateTs,
    connTs: thing.state.connTs,
    power: coerceInt(thing.state.raw.pow, 0) === 1,
    modeValue,
    fanValue,
    modeOptions: thing.modeOptions,
    fanOptions: thing.fanOptions,
    defaults: {
      modeValue: defaultModeValue(thing),
      targetTemperatureC: defaultTemperatureForMode(thing, defaultModeValue(thing)),
      fanValue: defaultFanForMode(thing, defaultModeValue(thing)),
    },
    temperature: {
      unit: displayUsesFahrenheit(thing) ? "F" : "C",
      min: displayTemperature(thing, minTemperatureC(thing)),
      max: displayTemperature(thing, maxTemperatureC(thing)),
      current: displayTemperature(thing, currentC),
      target: displayTemperature(thing, targetC),
    },
    rawState: thing.state.raw,
    modelConfig: thing.modelConfig,
  };
}

function buildSignedWebSocketUrl(brokerInfo) {
  const now = new Date();
  const amzDate = now.toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${AWS_REGION}/${AWS_IOT_SERVICE}/aws4_request`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${brokerInfo.accessKey}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "86400",
    "X-Amz-SignedHeaders": "host",
  });

  const canonicalQueryString = [...queryParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%7E/g, "~")}`)
    .join("&");

  const canonicalHeaders = `host:${brokerInfo.endpoint}\n`;
  const payloadHash = createHash("sha256").update("").digest("hex");
  const canonicalRequest = [
    "GET",
    "/mqtt",
    canonicalQueryString,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const sign = (key, value) => createHmac("sha256", key).update(value).digest();
  const kDate = sign(Buffer.from(`AWS4${brokerInfo.secretKey}`, "utf8"), dateStamp);
  const kRegion = sign(kDate, AWS_REGION);
  const kService = sign(kRegion, AWS_IOT_SERVICE);
  const kSigning = sign(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return `wss://${brokerInfo.endpoint}/mqtt?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

class BluestarRuntime {
  constructor() {
    this.credentials = null;
    this.sessionId = null;
    this.brokerInfo = null;
    this.devices = new Map();
    this.mqttClient = null;
    this.mqttConnected = false;
    this.refreshTimer = null;
    this.refreshPromise = null;
    this.subscribers = new Set();
    this.lastRefreshAt = null;
    this.lastError = null;
    this.lastThingsPayload = null;
    this.lastGroupsPayload = null;
    this.lastPublishedTopic = null;
    this.lastPublishedPayload = null;
    this.lastPublishedAt = null;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.snapshot());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  emitSnapshot() {
    const payload = this.snapshot();
    for (const callback of this.subscribers) {
      callback(payload);
    }
  }

  snapshot() {
    return {
      authenticated: Boolean(this.sessionId),
      mqttConnected: this.mqttConnected,
      deviceCount: this.devices.size,
      lastRefreshAt: this.lastRefreshAt,
      lastError: this.lastError,
      debug: this.debugSummary(),
      devices: [...this.devices.values()]
        .map((thing) => thingToPublicDevice(thing))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  debugSummary() {
    const thingsArray = Array.isArray(this.lastThingsPayload?.things) ? this.lastThingsPayload.things : [];
    const groupsArray = Array.isArray(this.lastGroupsPayload?.groups) ? this.lastGroupsPayload.groups : [];
    const statesMap = this.lastThingsPayload?.states && typeof this.lastThingsPayload.states === "object" ? this.lastThingsPayload.states : {};

    return {
      thingsKeys: this.lastThingsPayload && typeof this.lastThingsPayload === "object" ? Object.keys(this.lastThingsPayload) : [],
      groupsKeys: this.lastGroupsPayload && typeof this.lastGroupsPayload === "object" ? Object.keys(this.lastGroupsPayload) : [],
      rawThingsCount: thingsArray.length,
      rawStatesCount: Object.keys(statesMap).length,
      rawGroupsCount: groupsArray.length,
      rawThingIds: thingsArray.map((thing) => String(thing?.id ?? thing?.thing_id ?? "")).filter(Boolean),
      rawGroupIds: groupsArray.map((group) => String(group?.id ?? "")).filter(Boolean),
      lastPublishedTopic: this.lastPublishedTopic,
      lastPublishedPayload: this.lastPublishedPayload,
      lastPublishedAt: this.lastPublishedAt,
    };
  }

  debugPayload() {
    return {
      snapshot: this.snapshot(),
      rawThingsPayload: this.lastThingsPayload,
      rawGroupsPayload: this.lastGroupsPayload,
    };
  }

  async login(authIdValue, password) {
    const authId = String(authIdValue ?? "").trim();
    if (!authId || !password) {
      throw new BluestarAuthError("Auth ID and password are required", {
        statusCode: 400,
        code: "missing_credentials",
      });
    }

    this.credentials = { authId, password };
    const login = await loginRequest(authId, password);
    const sessionChanged = login.sessionId !== this.sessionId || JSON.stringify(login.brokerInfo) !== JSON.stringify(this.brokerInfo);

    this.sessionId = login.sessionId;
    this.brokerInfo = login.brokerInfo;
    this.lastError = null;

    await this.refreshDevices({
      sessionChanged,
      skipRelogin: true,
    });
    this.ensureRefreshTimer();

    return this.snapshot();
  }

  async logout() {
    this.clearRefreshTimer();
    this.disconnectMqtt();
    this.credentials = null;
    this.sessionId = null;
    this.brokerInfo = null;
    this.devices.clear();
    this.lastRefreshAt = null;
    this.lastError = null;
    this.lastThingsPayload = null;
    this.lastGroupsPayload = null;
    this.lastPublishedTopic = null;
    this.lastPublishedPayload = null;
    this.lastPublishedAt = null;
    this.emitSnapshot();
  }

  async refreshDevices(options = {}) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.#refreshDevicesInternal(options).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async #refreshDevicesInternal({ forceRelogin = false, sessionChanged = false, skipRelogin = false } = {}) {
    if ((forceRelogin || !this.sessionId || !this.brokerInfo) && !skipRelogin) {
      await this.relogin();
      sessionChanged = true;
    }

    if (!this.sessionId) {
      throw new BluestarAuthError("Log in before refreshing devices", {
        statusCode: 401,
        code: "not_logged_in",
      });
    }

    let payload;
    try {
      payload = await fetchThings(this.sessionId);
    } catch (error) {
      if (error instanceof BluestarAuthError && !forceRelogin) {
        await this.relogin();
        return this.#refreshDevicesInternal({
          forceRelogin: true,
          sessionChanged: true,
          skipRelogin: true,
        });
      }
      this.lastError = error.message;
      this.emitSnapshot();
      throw error;
    }

    let groupsPayload = null;
    try {
      groupsPayload = await fetchGroups(this.sessionId);
    } catch (error) {
      this.lastError = error.message;
    }

    this.lastThingsPayload = payload;
    this.lastGroupsPayload = groupsPayload;

    this.applyThingsPayload(payload);
    this.lastRefreshAt = new Date().toISOString();
    this.lastError = null;

    if (sessionChanged || !this.mqttClient) {
      this.connectMqtt();
    } else {
      this.syncSubscriptions();
    }

    this.emitSnapshot();
    return this.snapshot();
  }

  async relogin() {
    if (!this.credentials) {
      throw new BluestarAuthError("Log in before controlling devices", {
        statusCode: 401,
        code: "not_logged_in",
      });
    }

    const login = await loginRequest(this.credentials.authId, this.credentials.password);
    const sessionChanged = login.sessionId !== this.sessionId || JSON.stringify(login.brokerInfo) !== JSON.stringify(this.brokerInfo);
    this.sessionId = login.sessionId;
    this.brokerInfo = login.brokerInfo;
    if (sessionChanged) {
      this.connectMqtt();
    }
  }

  applyThingsPayload(payload) {
    const rawThings = Array.isArray(payload?.things) ? payload.things : [];
    const rawStates = payload?.states && typeof payload.states === "object" ? payload.states : {};
    const nextDevices = new Map();

    for (const rawThing of rawThings) {
      if (!rawThing || typeof rawThing !== "object") {
        continue;
      }

      const thingId = String(rawThing.id ?? rawThing.thing_id ?? "").trim();
      if (!thingId) {
        continue;
      }

      const previousThing = this.devices.get(thingId) ?? null;
      const nextThing = buildThing(rawThing, rawStates[thingId], previousThing);
      nextDevices.set(thingId, nextThing);
    }

    this.devices = nextDevices;
  }

  connectMqtt() {
    if (!this.sessionId || !this.brokerInfo) {
      return;
    }

    this.disconnectMqtt();

    const signedUrl = buildSignedWebSocketUrl(this.brokerInfo);
    const client = mqtt.connect(signedUrl, {
      clientId: `u-${this.sessionId}`,
      clean: true,
      keepalive: MQTT_KEEPALIVE_SECONDS,
      reconnectPeriod: 5_000,
      connectTimeout: 30_000,
    });

    client.on("connect", () => {
      this.mqttConnected = true;
      this.syncSubscriptions();
      this.emitSnapshot();
    });

    client.on("close", () => {
      this.mqttConnected = false;
      this.emitSnapshot();
    });

    client.on("offline", () => {
      this.mqttConnected = false;
      this.emitSnapshot();
    });

    client.on("reconnect", () => {
      this.mqttConnected = false;
      this.emitSnapshot();
    });

    client.on("error", (error) => {
      this.lastError = `MQTT: ${error.message}`;
      this.emitSnapshot();
    });

    client.on("message", (topic, payload) => {
      this.handleMqttMessage(topic, payload);
    });

    this.mqttClient = client;
  }

  disconnectMqtt() {
    if (!this.mqttClient) {
      return;
    }

    this.mqttClient.end(true);
    this.mqttClient = null;
    this.mqttConnected = false;
  }

  syncSubscriptions() {
    if (!this.mqttClient || !this.mqttConnected) {
      return;
    }

    const topics = [];
    for (const thingId of this.devices.keys()) {
      topics.push(`things/${thingId}/state/reported`);
      topics.push(`$aws/events/presence/+/${thingId}`);
    }

    if (!topics.length) {
      return;
    }

    this.mqttClient.subscribe(topics, { qos: 1 });
  }

  handleMqttMessage(topic, payloadBuffer) {
    let payload;
    try {
      payload = JSON.parse(payloadBuffer.toString("utf8"));
    } catch (error) {
      return;
    }

    if (topic.startsWith("things/") && topic.endsWith("/state/reported")) {
      const thingId = topic.split("/")[1];
      this.handleStateReport(thingId, payload);
      return;
    }

    if (topic.startsWith("$aws/events/presence/")) {
      const thingId = topic.split("/").at(-1);
      const connected = !topic.includes("disconnected");
      const timestamp = coerceInt(payload?.timestamp, 0);
      this.handlePresence(thingId, connected, timestamp);
    }
  }

  handleStateReport(thingId, payload) {
    const thing = this.devices.get(thingId);
    if (!thing || coerceInt(payload?.type, -1) !== 0) {
      return;
    }

    const stateTs = coerceInt(payload.ts, 0);
    if (stateTs < thing.state.stateTs) {
      return;
    }

    thing.state.raw = { ...payload };
    thing.state.stateTs = stateTs;
    this.lastError = null;
    this.emitSnapshot();
  }

  handlePresence(thingId, connected, timestamp) {
    const thing = this.devices.get(thingId);
    if (!thing || timestamp < thing.state.connTs) {
      return;
    }

    thing.state.connected = connected;
    thing.state.connTs = timestamp;
    this.emitSnapshot();
  }

  getThingOrThrow(thingId) {
    const thing = this.devices.get(thingId);
    if (!thing) {
      throw new BluestarApiError("Unknown Blue Star device", {
        statusCode: 404,
        code: "device_not_found",
      });
    }

    return thing;
  }

  assertMqttAvailable() {
    if (!this.mqttClient || !this.mqttConnected) {
      throw new BluestarApiError("MQTT bridge is not connected", {
        statusCode: 503,
        code: "mqtt_unavailable",
      });
    }
  }

  normalizeOutgoingPayload(payload) {
    const timestamp = Date.now();
    const normalized = {
      ...payload,
      ts: coerceInt(payload?.ts, timestamp),
    };

    return normalized;
  }

  applyOptimisticState(thing, payload) {
    const nextState = { ...thing.state.raw };

    for (const [key, value] of Object.entries(payload)) {
      if (key === "mode" && value && typeof value === "object" && !Array.isArray(value)) {
        if (value.value !== null && value.value !== undefined) {
          nextState.mode = value.value;
        }
        if (value.stemp !== null && value.stemp !== undefined && value.stemp !== "") {
          nextState.stemp = String(value.stemp);
        }
        if (value.fspd !== null && value.fspd !== undefined && value.fspd !== "") {
          nextState.fspd = Number(value.fspd);
        }
        continue;
      }

      if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
        nextState[key] = value.value;
        for (const childKey of ["mode", "stemp", "fspd", "hswing", "vswing", "irest_tmr"]) {
          if (value[childKey] !== null && value[childKey] !== undefined && value[childKey] !== "") {
            nextState[childKey] = value[childKey];
          }
        }
        continue;
      }

      nextState[key] = value;
    }

    thing.state.raw = nextState;
    thing.state.stateTs = Math.max(thing.state.stateTs, coerceInt(payload.ts, Date.now()));
  }

  async publishThingUpdate(thingId, payload) {
    this.assertMqttAvailable();

    const message = this.normalizeOutgoingPayload(payload);
    await this.publish(`$aws/things/${thingId}/shadow/update`, {
      state: {
        desired: {
          ...message,
          src: SOURCE_MQTT,
        },
      },
    });

    const thing = this.getThingOrThrow(thingId);
    this.applyOptimisticState(thing, message);
    this.emitSnapshot();
  }

  async publishThingUpdateSequence(thingId, payloads, delayMs = 200) {
    for (let index = 0; index < payloads.length; index += 1) {
      await this.publishThingUpdate(thingId, payloads[index]);
      if (index < payloads.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async sendControl(thingId, payload) {
    const thing = this.getThingOrThrow(thingId);

    if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.keys(payload).length) {
      throw new BluestarApiError("Control payload must be a JSON object", {
        statusCode: 400,
        code: "invalid_payload",
      });
    }

    await this.publishThingUpdate(thingId, payload);
  }

  async forceSync(thingId) {
    this.getThingOrThrow(thingId);
    this.assertMqttAvailable();

    await this.publish(`things/${thingId}/control`, { fpsh: 1 });
  }

  async runExactCommand(thingId, command, params = {}) {
    const thing = this.getThingOrThrow(thingId);
    const sequence = buildExactCommandSequence(thing, command, params);
    if (!sequence.length) {
      throw protocolError(`Exact command produced no payloads: ${command}`, "empty_command_sequence");
    }
    await this.publishThingUpdateSequence(thing.id, sequence, EXACT_COMMAND_DELAY_MS);
  }

  async setPowerState(thingId, enabled) {
    await this.runExactCommand(thingId, "power", { value: enabled });
  }

  async setTemperature(thingId, value) {
    await this.runExactCommand(thingId, "temperature", { value });
  }

  async setFanSpeed(thingId, value) {
    await this.runExactCommand(thingId, "fan", { value });
  }

  async setMode(thingId, modeValueInput, temperature = null, fanSpeed = null) {
    await this.runExactCommand(thingId, "mode", {
      value: modeValueInput,
      temperature,
      fanSpeed,
    });
  }

  publish(topic, payload) {
    return new Promise((resolve, reject) => {
      this.lastPublishedTopic = topic;
      this.lastPublishedPayload = payload;
      this.lastPublishedAt = new Date().toISOString();
      this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 0 }, (error) => {
        if (error) {
          this.lastError = `Publish failed: ${error.message}`;
          this.emitSnapshot();
          reject(error);
          return;
        }

        this.lastError = null;
        resolve();
      });
    });
  }

  ensureRefreshTimer() {
    this.clearRefreshTimer();
    this.refreshTimer = setInterval(() => {
      this.refreshDevices().catch((error) => {
        this.lastError = error.message;
        this.emitSnapshot();
      });
    }, REFRESH_INTERVAL_MS);
  }

  clearRefreshTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

const runtime = new BluestarRuntime();

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function noContentResponse(response, statusCode = 204) {
  response.writeHead(statusCode);
  response.end();
}

function errorResponse(response, error) {
  const statusCode = error?.statusCode ?? 500;
  jsonResponse(response, statusCode, {
    error: {
      code: error?.code ?? "internal_error",
      message: error?.message ?? "Unexpected server error",
    },
  });
}

async function readRequestJson(request) {
  const chunks = [];
  let received = 0;

  for await (const chunk of request) {
    received += chunk.length;
    if (received > 1024 * 1024) {
      throw new BluestarApiError("Request body is too large", {
        statusCode: 413,
        code: "body_too_large",
      });
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new BluestarApiError("Request body must be valid JSON", {
      statusCode: 400,
      code: "invalid_json",
    });
  }
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const normalizedPath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    noContentResponse(response, 404);
    return;
  }

  try {
    const file = await readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": file.length,
      "Cache-Control": "no-store",
    });
    response.end(file);
  } catch (error) {
    noContentResponse(response, 404);
  }
}

function handleEvents(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write("\n");

  const unsubscribe = runtime.subscribe((snapshot) => {
    response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  });

  request.on("close", () => {
    unsubscribe();
    response.end();
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  const controlMatch = /^\/api\/devices\/([^/]+)\/control$/.exec(url.pathname);
  const syncMatch = /^\/api\/devices\/([^/]+)\/sync$/.exec(url.pathname);
  const exactMatch = /^\/api\/devices\/([^/]+)\/exact\/([^/]+)$/.exec(url.pathname);
  const powerMatch = /^\/api\/devices\/([^/]+)\/power$/.exec(url.pathname);
  const temperatureMatch = /^\/api\/devices\/([^/]+)\/temperature$/.exec(url.pathname);
  const fanMatch = /^\/api\/devices\/([^/]+)\/fan$/.exec(url.pathname);
  const modeMatch = /^\/api\/devices\/([^/]+)\/mode$/.exec(url.pathname);

  try {
    if (request.method === "GET" && url.pathname === "/api/state") {
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/debug") {
      jsonResponse(response, 200, runtime.debugPayload());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/commands") {
      jsonResponse(response, 200, { commands: EXACT_COMMAND_CATALOG });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      handleEvents(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await readRequestJson(request);
      const snapshot = await runtime.login(body.authId, body.password);
      jsonResponse(response, 200, snapshot);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      await runtime.logout();
      noContentResponse(response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/refresh") {
      const snapshot = await runtime.refreshDevices();
      jsonResponse(response, 200, snapshot);
      return;
    }

    if (request.method === "POST" && controlMatch) {
      const body = await readRequestJson(request);
      const payload = body.payload && typeof body.payload === "object" ? body.payload : body;
      await runtime.sendControl(decodeURIComponent(controlMatch[1]), payload);
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "POST" && exactMatch) {
      const body = await readRequestJson(request);
      await runtime.runExactCommand(
        decodeURIComponent(exactMatch[1]),
        decodeURIComponent(exactMatch[2]),
        body && typeof body === "object" ? body : {},
      );
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "POST" && powerMatch) {
      const body = await readRequestJson(request);
      await runtime.setPowerState(decodeURIComponent(powerMatch[1]), truthy(body.value));
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "POST" && temperatureMatch) {
      const body = await readRequestJson(request);
      await runtime.setTemperature(decodeURIComponent(temperatureMatch[1]), body.value);
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "POST" && fanMatch) {
      const body = await readRequestJson(request);
      await runtime.setFanSpeed(decodeURIComponent(fanMatch[1]), body.value);
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "POST" && modeMatch) {
      const body = await readRequestJson(request);
      await runtime.setMode(
        decodeURIComponent(modeMatch[1]),
        body.value,
        body.temperature ?? null,
        body.fanSpeed ?? null,
      );
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "POST" && syncMatch) {
      await runtime.forceSync(decodeURIComponent(syncMatch[1]));
      jsonResponse(response, 200, runtime.snapshot());
      return;
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/app.") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html"))) {
      await serveStatic(request, response);
      return;
    }

    noContentResponse(response, 404);
  } catch (error) {
    errorResponse(response, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Blue Star web app listening on http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await runtime.logout();
    server.close(() => {
      process.exit(0);
    });
  });
}
