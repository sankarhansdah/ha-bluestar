# Blue Star Smart AC

Custom Home Assistant integration and protocol test harness for Blue Star Smart AC cloud control.

This repository contains:

- a Home Assistant custom integration in [custom_components/bluestar](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar)
- a localhost protocol test webapp in [webapp](/Users/sankarkumarhansdah/Projects/Bluestar/webapp)
- the reverse engineering notes in [findings.md](/Users/sankarkumarhansdah/Projects/Bluestar/findings.md)

Planned public repository:

- `https://github.com/sankarhansdah/ha-bluestar`

## Home Assistant features

- config-flow login with the Blue Star account
- climate entity for standard AC use
- exact app-style command execution through services
- force-sync service
- raw desired-shadow patch service

## HACS install

This repository is structured as a HACS integration repository.

Once the repo is pushed to a public GitHub repository:

1. Open HACS in Home Assistant.
2. Go to `Integrations`.
3. Open the menu and choose `Custom repositories`.
4. Add `https://github.com/sankarhansdah/ha-bluestar`.
5. Choose repository type `Integration`.
6. Install `Blue Star Smart AC`.
7. Restart Home Assistant.
8. Add the integration from `Settings -> Devices & Services`.

## Manual install

Copy [custom_components/bluestar](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar) into your Home Assistant config directory under `custom_components/`, then restart Home Assistant.

## Services

The integration registers:

- `bluestar.execute_command`
- `bluestar.force_sync`
- `bluestar.send_raw_patch`

Service field details are documented in [custom_components/bluestar/services.yaml](/Users/sankarkumarhansdah/Projects/Bluestar/custom_components/bluestar/services.yaml).

## Publishing checklist

Before publishing for other users through HACS, finish these repo-specific items:

1. Push this project to a public GitHub repository.
2. Create GitHub releases or tags for versioned installs.
3. Run Hassfest in CI.
4. If you want default HACS listing instead of only a custom repository install, follow the current HACS publishing requirements for integrations.

## Protocol notes

The protocol, transport order, MQTT topics, and exact command mapping are documented in [findings.md](/Users/sankarkumarhansdah/Projects/Bluestar/findings.md).
