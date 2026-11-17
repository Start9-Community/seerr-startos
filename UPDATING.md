# Updating the upstream version

Seerr runs the published upstream image `ghcr.io/seerr-team/seerr`, pinned by tag.

## Determining the upstream version

The current pin is `images.seerr.source.dockerTag` in `startos/manifest/index.ts`. The latest stable release is:

```
gh release view -R seerr-team/seerr --json tagName -q .tagName
```

Confirm that tag exists on `ghcr.io/seerr-team/seerr` with both `linux/amd64` and `linux/arm64` in its manifest.

## Applying the bump

1. Set `images.seerr.source.dockerTag` to `ghcr.io/seerr-team/seerr:<tag>`; the tag keeps its leading `v`.
2. The maintenance program in `startos/utils.ts` (`maintenanceScript`) requires the image's compiled modules under `/app/dist` directly. Compare the new release's `server/datasource.ts`, `server/entity/User.ts`, `server/constants/user.ts`, `server/lib/permissions.ts`, `server/constants/server.ts`, `server/lib/settings/index.ts`, and `server/api/jellyfin.ts` against the previous tag, and adjust the program wherever a module path, export, entity field or settings key it touches has moved.
