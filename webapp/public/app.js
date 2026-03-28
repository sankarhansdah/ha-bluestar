const ui = {
  loginForm: document.querySelector("#login-form"),
  logoutButton: document.querySelector("#logout-button"),
  refreshButton: document.querySelector("#refresh-button"),
  debugButton: document.querySelector("#debug-button"),
  messageStrip: document.querySelector("#message-strip"),
  authStatus: document.querySelector("#auth-status"),
  mqttStatus: document.querySelector("#mqtt-status"),
  deviceCount: document.querySelector("#device-count"),
  lastRefresh: document.querySelector("#last-refresh"),
  debugThingsCount: document.querySelector("#debug-things-count"),
  debugStatesCount: document.querySelector("#debug-states-count"),
  debugGroupsCount: document.querySelector("#debug-groups-count"),
  debugThingsKeys: document.querySelector("#debug-things-keys"),
  debugJson: document.querySelector("#debug-json"),
  devices: document.querySelector("#devices"),
  template: document.querySelector("#device-template"),
};

const state = {
  snapshot: null,
  events: null,
  debugPayload: null,
  commandCatalog: [],
  commandForms: {},
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message ?? "Request failed";
    throw new Error(message);
  }
  return data;
}

function showMessage(message, isError = false) {
  if (!message) {
    ui.messageStrip.hidden = true;
    ui.messageStrip.textContent = "";
    ui.messageStrip.dataset.error = "false";
    return;
  }

  ui.messageStrip.hidden = false;
  ui.messageStrip.textContent = message;
  ui.messageStrip.dataset.error = String(isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTemperature(value, unit) {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }
  return `${value}${String.fromCharCode(176)}${unit}`;
}

function relativeTime(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleString()} (${Math.round((Date.now() - date.getTime()) / 1000)}s ago)`;
}

function setSnapshot(snapshot) {
  state.snapshot = snapshot;
  render();
}

function setDebugPayload(payload) {
  state.debugPayload = payload;
  render();
}

function setCommandCatalog(commands) {
  state.commandCatalog = Array.isArray(commands) ? commands : [];
  render();
}

function commandDefinition(commandName) {
  return state.commandCatalog.find((item) => item.name === commandName) ?? null;
}

function defaultCommandName() {
  return state.commandCatalog[0]?.name ?? "";
}

function defaultCommandParamsText(commandName) {
  const definition = commandDefinition(commandName);
  return JSON.stringify(definition?.params ?? {}, null, 2);
}

function ensureCommandForm(deviceId) {
  if (!state.commandForms[deviceId]) {
    const command = defaultCommandName();
    state.commandForms[deviceId] = {
      command,
      paramsText: defaultCommandParamsText(command),
    };
  }
  return state.commandForms[deviceId];
}

function updateCommandSelection(deviceId, command) {
  state.commandForms[deviceId] = {
    command,
    paramsText: defaultCommandParamsText(command),
  };
}

function updateCommandParamsText(deviceId, paramsText) {
  const form = ensureCommandForm(deviceId);
  form.paramsText = paramsText;
}

function ensureEvents() {
  if (state.events) {
    return;
  }

  const events = new EventSource("/api/events");
  events.onmessage = (event) => {
    const snapshot = JSON.parse(event.data);
    setSnapshot(snapshot);
  };
  events.onerror = () => {
    showMessage("Live event stream dropped. The page will keep polling through manual refresh.", true);
  };
  state.events = events;
}

function closeEvents() {
  if (state.events) {
    state.events.close();
    state.events = null;
  }
}

function renderEmptyState(message) {
  ui.devices.innerHTML = `
    <article class="empty-state">
      <h3>${escapeHtml(message.title)}</h3>
      <p>${escapeHtml(message.body)}</p>
    </article>
  `;
}

function renderDevices(devices) {
  ui.devices.innerHTML = "";

  for (const device of devices) {
    const commandForm = ensureCommandForm(device.id);
    const fragment = ui.template.content.cloneNode(true);
    const card = fragment.querySelector(".device-card");

    card.dataset.deviceId = device.id;
    fragment.querySelector(".device-model").textContent = device.modelId || "Smart AC";
    fragment.querySelector(".device-name").textContent = device.name;

    const statusPill = fragment.querySelector(".status-pill");
    statusPill.textContent = device.online ? "Online" : "Offline";
    statusPill.classList.add(device.online ? "online" : "offline");

    fragment.querySelector(".metric-current").textContent = formatTemperature(device.temperature.current, device.temperature.unit);
    fragment.querySelector(".metric-target").textContent = formatTemperature(device.temperature.target, device.temperature.unit);
    fragment.querySelector(".metric-mode").textContent =
      device.modeOptions.find((option) => option.value === device.modeValue)?.label ?? "unknown";

    const modeGroup = fragment.querySelector(".mode-group");
    for (const option of device.modeOptions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-chip";
      button.dataset.action = "mode";
      button.dataset.value = String(option.value);
      button.textContent = option.label;
      if (option.value === device.modeValue) {
        button.classList.add("is-active");
      }
      modeGroup.appendChild(button);
    }

    const slider = fragment.querySelector(".temp-range");
    const numberInput = fragment.querySelector(".temp-number");
    const step = device.temperature.unit === "F" ? "1" : "0.5";
    slider.min = String(device.temperature.min ?? 16);
    slider.max = String(device.temperature.max ?? 30);
    slider.step = step;
    slider.value = String(device.temperature.target ?? device.temperature.min ?? 16);
    numberInput.min = slider.min;
    numberInput.max = slider.max;
    numberInput.step = step;
    numberInput.value = slider.value;

    slider.addEventListener("input", () => {
      numberInput.value = slider.value;
    });
    numberInput.addEventListener("input", () => {
      slider.value = numberInput.value;
    });

    const fanSelect = fragment.querySelector(".fan-select");
    if (device.fanOptions.length) {
      for (const option of device.fanOptions) {
        const selectOption = document.createElement("option");
        selectOption.value = String(option.value);
        selectOption.textContent = option.label;
        if (option.value === device.fanValue) {
          selectOption.selected = true;
        }
        fanSelect.appendChild(selectOption);
      }
    } else {
      const selectOption = document.createElement("option");
      selectOption.textContent = "No fan controls";
      selectOption.value = "";
      fanSelect.appendChild(selectOption);
      fanSelect.disabled = true;
    }

    const rawPayload = fragment.querySelector(".raw-payload");
    rawPayload.value = JSON.stringify(
      {
        pow: 1,
      },
      null,
      2,
    );

    const exactSelect = fragment.querySelector(".exact-command-select");
    const exactDescription = fragment.querySelector(".exact-command-description");
    const exactParams = fragment.querySelector(".exact-command-params");

    for (const command of state.commandCatalog) {
      const option = document.createElement("option");
      option.value = command.name;
      option.textContent = command.name;
      if (command.name === commandForm.command) {
        option.selected = true;
      }
      exactSelect.appendChild(option);
    }

    exactDescription.textContent = commandDefinition(commandForm.command)?.description ?? "No exact command catalog loaded.";
    exactParams.value = commandForm.paramsText;

    fragment.querySelector(".state-json").textContent = JSON.stringify(device.rawState, null, 2);

    ui.devices.appendChild(fragment);
  }
}

function render() {
  const snapshot = state.snapshot ?? {
    authenticated: false,
    mqttConnected: false,
    deviceCount: 0,
    lastRefreshAt: null,
    lastError: null,
    devices: [],
  };
  const debug = snapshot.debug ?? {
    rawThingsCount: 0,
    rawStatesCount: 0,
    rawGroupsCount: 0,
    thingsKeys: [],
  };

  ui.authStatus.textContent = snapshot.authenticated ? "Connected" : "Disconnected";
  ui.mqttStatus.textContent = snapshot.mqttConnected ? "Subscribed" : "Idle";
  ui.deviceCount.textContent = String(snapshot.deviceCount);
  ui.lastRefresh.textContent = relativeTime(snapshot.lastRefreshAt);
  ui.debugThingsCount.textContent = String(debug.rawThingsCount);
  ui.debugStatesCount.textContent = String(debug.rawStatesCount);
  ui.debugGroupsCount.textContent = String(debug.rawGroupsCount);
  ui.debugThingsKeys.textContent = debug.thingsKeys.length ? debug.thingsKeys.join(", ") : "-";
  showMessage(snapshot.lastError, Boolean(snapshot.lastError));

  const debugPayload = state.debugPayload ?? { snapshot };
  ui.debugJson.textContent = JSON.stringify(debugPayload, null, 2);

  if (!snapshot.authenticated) {
    renderEmptyState({
      title: "No session yet",
      body: "Log in to fetch your AC inventory and start the MQTT bridge.",
    });
    return;
  }

  if (!snapshot.devices.length) {
    renderEmptyState({
      title: "No Blue Star devices found",
      body: "The account logged in successfully, but /things did not return any controllable AC units.",
    });
    return;
  }

  renderDevices(snapshot.devices);
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(ui.loginForm);

  try {
    const snapshot = await fetchJson("/api/login", {
      method: "POST",
      body: JSON.stringify({
        authId: formData.get("authId"),
        password: formData.get("password"),
      }),
    });
    setSnapshot(snapshot);
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    ensureEvents();
    showMessage("Logged in. MQTT bridge is starting.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function handleLogout() {
  try {
    await fetchJson("/api/logout", {
      method: "POST",
      body: "{}",
    });
    closeEvents();
    const snapshot = await fetchJson("/api/state");
    setSnapshot(snapshot);
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    showMessage("Logged out.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function handleRefresh() {
  try {
    const snapshot = await fetchJson("/api/refresh", {
      method: "POST",
      body: "{}",
    });
    setSnapshot(snapshot);
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    showMessage("Device list refreshed.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function handleDebug() {
  try {
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    showMessage("Fetched raw API debug payload.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function sendPayload(deviceId, payload, successMessage) {
  try {
    const snapshot = await fetchJson(`/api/devices/${encodeURIComponent(deviceId)}/control`, {
      method: "POST",
      body: JSON.stringify({
        payload,
      }),
    });
    setSnapshot(snapshot);
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    showMessage(successMessage);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function sendExactAction(deviceId, route, body, successMessage) {
  try {
    const snapshot = await fetchJson(`/api/devices/${encodeURIComponent(deviceId)}/${route}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSnapshot(snapshot);
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    showMessage(successMessage);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function sendExactCommand(deviceId, commandName, params, successMessage) {
  try {
    const snapshot = await fetchJson(`/api/devices/${encodeURIComponent(deviceId)}/exact/${encodeURIComponent(commandName)}`, {
      method: "POST",
      body: JSON.stringify(params),
    });
    setSnapshot(snapshot);
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    showMessage(successMessage);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function handleDeviceClick(event) {
  const actionElement = event.target.closest("button, .mode-chip");
  if (!actionElement) {
    return;
  }

  const card = actionElement.closest(".device-card");
  const deviceId = card?.dataset.deviceId;
  if (!deviceId) {
    return;
  }

  const device = state.snapshot?.devices.find((item) => item.id === deviceId);
  if (!device) {
    return;
  }

  if (actionElement.classList.contains("action-power-on")) {
    await sendExactAction(deviceId, "power", { value: true }, `${device.name}: power on requested.`);
    return;
  }

  if (actionElement.classList.contains("action-power-off")) {
    await sendExactAction(deviceId, "power", { value: false }, `${device.name}: power off requested.`);
    return;
  }

  if (actionElement.classList.contains("action-sync")) {
    try {
      const snapshot = await fetchJson(`/api/devices/${encodeURIComponent(deviceId)}/sync`, {
        method: "POST",
        body: "{}",
      });
      setSnapshot(snapshot);
      const debugPayload = await fetchJson("/api/debug");
      setDebugPayload(debugPayload);
      showMessage(`${device.name}: force sync requested.`);
    } catch (error) {
      showMessage(error.message, true);
    }
    return;
  }

  if (actionElement.dataset.action === "mode") {
    const modeValue = Number(actionElement.dataset.value);
    await sendExactAction(
      deviceId,
      "mode",
      {
        value: modeValue,
      },
      `${device.name}: mode update requested.`,
    );
    return;
  }

  if (actionElement.classList.contains("action-set-temp")) {
    const numberInput = card.querySelector(".temp-number");
    if (numberInput.value === "") {
      showMessage("Enter a valid target temperature.", true);
      return;
    }

    await sendExactAction(
      deviceId,
      "temperature",
      { value: numberInput.value },
      `${device.name}: target temperature update requested.`,
    );
    return;
  }

  if (actionElement.classList.contains("action-set-fan")) {
    const fanSelect = card.querySelector(".fan-select");
    if (!fanSelect.value) {
      showMessage("This device does not expose fan speed options.", true);
      return;
    }
    await sendExactAction(
      deviceId,
      "fan",
      { value: Number(fanSelect.value) },
      `${device.name}: fan speed update requested.`,
    );
    return;
  }

  if (actionElement.classList.contains("action-send-raw")) {
    const rawInput = card.querySelector(".raw-payload");
    try {
      const payload = JSON.parse(rawInput.value);
      await sendPayload(deviceId, payload, `${device.name}: raw patch published.`);
    } catch (error) {
      showMessage(`Raw patch must be valid JSON: ${error.message}`, true);
    }
  }

  if (actionElement.classList.contains("action-run-command")) {
    const commandSelect = card.querySelector(".exact-command-select");
    const paramsInput = card.querySelector(".exact-command-params");
    const commandName = commandSelect.value;
    try {
      const params = JSON.parse(paramsInput.value || "{}");
      await sendExactCommand(deviceId, commandName, params, `${device.name}: ${commandName} requested.`);
    } catch (error) {
      showMessage(`Exact command parameters must be valid JSON: ${error.message}`, true);
    }
  }
}

function handleDeviceChange(event) {
  const commandSelect = event.target.closest(".exact-command-select");
  if (!commandSelect) {
    return;
  }

  const card = commandSelect.closest(".device-card");
  const deviceId = card?.dataset.deviceId;
  if (!deviceId) {
    return;
  }

  updateCommandSelection(deviceId, commandSelect.value);
  render();
}

function handleDeviceInput(event) {
  const paramsInput = event.target.closest(".exact-command-params");
  if (!paramsInput) {
    return;
  }

  const card = paramsInput.closest(".device-card");
  const deviceId = card?.dataset.deviceId;
  if (!deviceId) {
    return;
  }

  updateCommandParamsText(deviceId, paramsInput.value);
}

async function bootstrap() {
  ui.loginForm.addEventListener("submit", handleLogin);
  ui.logoutButton.addEventListener("click", handleLogout);
  ui.refreshButton.addEventListener("click", handleRefresh);
  ui.debugButton.addEventListener("click", handleDebug);
  ui.devices.addEventListener("click", handleDeviceClick);
  ui.devices.addEventListener("change", handleDeviceChange);
  ui.devices.addEventListener("input", handleDeviceInput);

  try {
    const commandsPayload = await fetchJson("/api/commands");
    setCommandCatalog(commandsPayload?.commands ?? []);
    const snapshot = await fetchJson("/api/state");
    setSnapshot(snapshot);
    const debugPayload = await fetchJson("/api/debug");
    setDebugPayload(debugPayload);
    if (snapshot.authenticated) {
      ensureEvents();
    }
  } catch (error) {
    showMessage(error.message, true);
  }
}

bootstrap();
