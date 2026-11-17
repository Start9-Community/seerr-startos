<p align="center">
  <img src="icon.svg" alt="Seerr Logo" width="21%">
</p>

# Seerr on StartOS

> Everything not listed in this document should behave the same as upstream
> Seerr. If a feature, setting, or behavior is not mentioned here,
> the upstream documentation is accurate and fully applicable — see the
> Documentation section of `instructions.md` for links.

[Seerr](https://github.com/seerr-team/seerr) discovers movies and television and manages requests for a media library. This package selects Jellyfin, provisions its connection before opening the web listener, and manages optional local Radarr and Sonarr integrations.

---

## Table of Contents

- [Image and Container Runtime](#image-and-container-runtime)
- [Volume and Data Layout](#volume-and-data-layout)
- [File Models](#file-models)
- [Dependencies](#dependencies)
- [Network Access and Interfaces](#network-access-and-interfaces)
- [Installation and First-Run Flow](#installation-and-first-run-flow)
- [Actions](#actions)
- [Tasks](#tasks)
- [Health Checks](#health-checks)
- [Backups and Restore](#backups-and-restore)
- [Limitations and Differences](#limitations-and-differences)
- [Quick Reference for AI Consumers](#quick-reference-for-ai-consumers)

---

## Image and Container Runtime

The unmodified upstream `ghcr.io/seerr-team/seerr` image supports x86_64 and aarch64. `seerr-sub` runs the upstream entrypoint and default npm command as the image’s `node` user. Node listens on IPv6 and IPv4. It receives this server’s root CA through `NODE_EXTRA_CA_CERTS` for manually configured HTTPS notification and service URLs.

A temporary `seerr-maintenance` subcontainer invokes the image’s compiled datasource, user entity, settings model, and Jellyfin API client. It runs schema migrations and applies configuration before the normal daemon starts. No temporary web listener is opened. Password rotation uses the same upstream `User.setPassword` implementation against the existing database, without running migrations or rewriting settings while Seerr is active. Credentials are passed over stdin, never command arguments.

## Volume and Data Layout

Seerr keeps its application data separate from package state. It does not mount media files.

| Volume          | Mount                    | Contents                                                                                                          |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `main`          | `/app/config`            | `settings.json`, SQLite database and session state under `db/`, cache, logs, and generated signing secrets        |
| `startos`       | Unmounted                | `store.json`, with the owner’s email, generated local password, setup completion, and managed integration choices |
| Radarr `public` | `/mnt/radarr`, read-only | Exported `api-key` while connected and installed                                                                  |
| Sonarr `public` | `/mnt/sonarr`, read-only | Exported `api-key` while connected and installed                                                                  |

Maintenance sets the application volume’s ownership to uid/gid 1000. Dependency credentials are mounted only from public volumes. Jellyfin’s private data is never mounted.

## File Models

The package’s state model is `startos/store.json`. A read-only model of `main/settings.json` reads Jellyfin’s API key for the authenticated health check. Initialization merges defaults; actions write setup completion, email, password, and the Radarr/Sonarr profile and root-folder selections. These values are watched by `main`, so a changed selection or password restarts the service. Repeating an unchanged connection selection does not trigger a restart.

Seerr’s own settings model writes `main/settings.json`. Every start enforces Jellyfin as the media-server type, enables local and media-server login, disables upstream version checks, enables reverse-proxy support, and marks the upstream wizard completed. It refreshes Jellyfin’s address from StartOS. Connect Jellyfin disables admission of new Jellyfin users; that permission remains user-controlled until the action runs again. Other settings, including libraries, notification agents, and application URL, remain user-controlled. The upstream model preserves its generated session secret, API key, and notification signing keys.

The package owns server records named `Radarr (StartOS)` and `Sonarr (StartOS)`: hostname, port, API key, selected profile, selected root folder, default status for standard requests, and synchronization. Reconciliation preserves their remaining request options and all other server records. Connecting selects that managed server as the default for standard requests. Disconnecting removes only its reserved record and does not select a replacement default. Do not give a manually configured server either reserved name.

Addresses and exported keys are watched reactively; a changed key or bridge address restarts Seerr and refreshes its settings. An unavailable dependency preserves its last application record until it returns. The package does not store imported Radarr/Sonarr keys in its own desired-state file; Seerr stores them in its application configuration as required.

## Dependencies

Jellyfin is required and supplies the libraries and media-server authentication. Radarr and Sonarr become optional running dependencies when selected. All expect their `primary` health checks. Declarations report dependency problems; they do not themselves gate the Seerr daemon after initial setup.

Jellyfin’s current package exports its port but has no public integration credential. Connect Jellyfin authenticates an existing Jellyfin administrator using Seerr’s own client and requests an application API key. The submitted Jellyfin password is not stored by the package. Seerr retains its media-server session token and application API key. Reconnecting reuses a valid API key for the same server rather than creating another key on every start. Jellyfin’s host id is `main`; its port is imported from the Jellyfin package source.

Radarr and Sonarr export their host ids and ports from `startos/utils.ts` and their keys as `public/api-key`. The connection forms read those exports and query each service’s available profiles and root folders. Configure those in the provider first. Missing services or credentials leave empty choices; reopening the form retries discovery. Disconnection remains available when a provider is offline.

Seerr reaches each provider through `getBridgeAddress` at its assigned bridge port. File managers, download clients, and Prowlarr belong to the Radarr/Sonarr acquisition chain and are not direct Seerr dependencies.

Seerr retains its upstream API request timeout. A slow initial metadata lookup can add a title in Sonarr while Seerr marks the request failed. Inspect the provider, increase the timeout in Seerr’s network settings if needed, and retry the failed request. The package preserves that setting across restarts.

## Network Access and Interfaces

One HTTP listener serves the web application and its authenticated REST API. The exported interface is `ui`, type `ui`, on internal port 5055 under host `ui-multi`. API documentation is served at `/api-docs` on that listener. The package adds no other interfaces.

Discovery and metadata use external TMDB endpoints. Notifications reach the providers configured by the user. `NEXT_TELEMETRY_DISABLED` disables Next.js telemetry; upstream version polling is disabled because updates come through StartOS.

## Installation and First-Run Flow

Initialization seeds the package store and requests the Jellyfin connection. Connect Jellyfin initializes the database, authenticates the selected Jellyfin administrator, and creates or updates Seerr’s owner with that account’s identity. It completes the upstream wizard before any ordinary listener opens. The next prompt generates a distinct local Seerr password.

Library selection and synchronization happen inside Seerr after login. The package does not create libraries, change Jellyfin’s media sources, or choose which libraries a user may access. Restores retain setup and credentials; normal startup reapplies current dependency addresses and exported keys.

## Actions

Connect Jellyfin is used for first setup and to reconnect a changed administrator. It runs while the normal daemon is stopped, preserves the Seerr owner’s numeric identity and requests, and updates the owner’s media-server identity and login email. Repeating it authenticates again and preserves an existing valid application key. It does not change Jellyfin’s administrator password.

Set Admin Password generates and returns the local owner’s email and a new random password. It applies the password through Seerr’s own model before saving desired state. Every invocation replaces the old local password, and changed state briefly restarts Seerr. Other Jellyfin credentials are unaffected. Password changes made inside Seerr are restored to the package-managed value on the next start.

Connect Radarr and Connect Sonarr enable, disable, or edit the respective reserved server. Enabling verifies the selected profile and root folder still exist before storing the selection. Repeating an identical selection is safe. Changes take effect on startup or restart. The actions never alter the provider’s folders, profiles, indexers, or download clients.

## Tasks

A critical Connect Jellyfin prompt is raised while `jellyfinConfigured` is false. Successful connection clears it. Once connected, a critical Set Admin Password prompt is raised while no local password is stored. Generating the password clears that prompt. These prompts can return if the corresponding store fields are cleared. Both occur on Seerr; no dependency tasks are created.

## Health Checks

`primary` probes `/api/v1/settings/public` and requires a successful HTTP response, with a one-minute startup grace period. Failure means Seerr’s web server is unavailable; inspect `seerr-sub` and maintenance logs for migrations, volume permissions, or startup errors.

`jellyfin` probes the resolved Jellyfin system-info endpoint using its provisioned API key after Seerr is ready. Failure means the required server is absent, unreachable, or rejects its API key. This check does not prove that all selected libraries can be scanned. Authentication and a real library synchronization must be checked inside Seerr when diagnosing permission problems.

## Backups and Restore

StartOS stops Seerr and copies both own volumes wholesale. The quiescent SQLite database, session state, settings, generated secrets, local password, integration selections, cache, and logs are captured together. No database dump or external engine is needed.

Dependency volumes and media are not captured. Restored application settings can contain cached integration credentials, and current exported Radarr/Sonarr keys replace those on startup. Keep Jellyfin and the providers installed and back them up separately. A revoked Jellyfin key or changed media-server identity requires reconnecting Jellyfin.

## Limitations and Differences

1. Jellyfin is required; this package does not offer Plex or Emby selection.
2. Only one standard Radarr and one standard Sonarr connection are managed. Additional or 4K server entries can be configured in Seerr and must use other names.
3. Seerr does not supply storage, indexers, or download clients. Their setup remains in the acquisition services.
4. Discovery and metadata depend on TMDB internet access. The package does not provide an offline catalog.
5. SMTP and other notifications are configured in Seerr; the package does not consume StartOS system SMTP.
6. Removing Seerr does not revoke its Jellyfin API key. Revoke an unused Seerr key in Jellyfin when permanently removing the integration.

---

## Quick Reference for AI Consumers

```yaml
package_id: seerr
image: ghcr.io/seerr-team/seerr
architectures: [x86_64, aarch64]
subcontainers: [seerr-sub, seerr-maintenance, read-integration-key]
volumes:
  main: /app/config
  startos: unmounted
file_models: [startos/store.json, main/settings.json]
startos_managed_env_vars:
  [HOST, PORT, TZ, NODE_EXTRA_CA_CERTS, NEXT_TELEMETRY_DISABLED]
dependencies: [jellyfin, radarr, sonarr]
interfaces:
  ui: { type: ui, port: 5055 }
actions: [connect-jellyfin, set-admin-password, connect-radarr, connect-sonarr]
tasks:
  - { action: connect-jellyfin, severity: critical }
  - { action: set-admin-password, severity: critical }
health_checks: [primary, jellyfin]
```
