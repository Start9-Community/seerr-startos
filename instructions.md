# Seerr

## Documentation

- [Seerr user documentation](https://github.com/seerr-team/seerr/tree/develop/docs/using-seerr) — library settings, requests, user permissions, and notifications.

## What you get on StartOS

The Web Interface lets you discover movies and television, request additions to your Jellyfin library, and approve requests. Jellyfin is required. You can connect Radarr for movies and Sonarr for television without copying their addresses or API keys.

## Getting set up

1. Finish Jellyfin’s setup and create an administrator account there. Add your media libraries in Jellyfin.
2. Run **Connect Jellyfin** in Seerr. Enter that Jellyfin administrator’s username and password, and the email address you want to use to sign in to Seerr. A Jellyfin account with an empty password can leave the password field blank.
3. Run **Set Admin Password** and save the generated Seerr password. This password is separate from your Jellyfin password.
4. Open **Web Interface**, choose **Seerr** as the sign-in method, and use the email and generated password.
5. In Seerr’s **Settings → Jellyfin**, select and sync the libraries you want Seerr to track.
6. For automatic acquisition, configure root folders, quality profiles, indexers, and a download client in Radarr or Sonarr. Then run Seerr’s **Connect Radarr** or **Connect Sonarr** and choose a root folder and quality profile. If the choices are empty, finish setting up that service and reopen the action.

## Using Seerr

### Web interface

Search for a movie or series, open its details, and submit a request. Configure users, permissions, approvals, and notification providers in the web interface. New Jellyfin users are not automatically admitted by default; import users or enable new Jellyfin sign-ins in Seerr’s user settings.

If a request fails because Radarr or Sonarr takes too long to respond, increase the API request timeout in Seerr’s network settings, then retry the failed request. A 60-second timeout can accommodate a slow first metadata lookup. Check the provider first: it may already have added the requested title.

Discovery and metadata need internet access to TMDB. If you publish Seerr through a tunnel to keep your home IP private, send its outbound traffic through that tunnel too; metadata and notification providers otherwise see your home IP. Using a tunnel only to solve port forwarding requires no such change.

### Actions

- **Set Admin Password** generates a replacement Seerr password whenever you need to recover access. It interrupts Seerr briefly while the saved credential is applied. Save the returned password each time.
- **Connect Radarr** and **Connect Sonarr** connect, disconnect, or change the managed root folder and quality profile. Changes restart Seerr. Other service entries you create in Seerr are retained; reserve the names `Radarr (StartOS)` and `Sonarr (StartOS)` for these connections. Do not change their connection details in Seerr: use these actions instead.
- **Connect Jellyfin** reconnects a changed Jellyfin administrator account. Stop Seerr, run it, and start Seerr again. Your Seerr accounts and requests are preserved. Reconnecting disables admission of new Jellyfin users; you can enable it again in Seerr’s user settings.

## Limitations

This package uses Jellyfin as its media server. Plex and Emby are not selectable. Back up Jellyfin and the services holding your media separately: Seerr’s backup contains settings and requests, not media files.
