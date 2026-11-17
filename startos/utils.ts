import { FileHelper, T, z } from '@start9labs/start-sdk'
import { uiPort as jellyfinPort } from 'jellyfin-startos/startos/utils'
import {
  uiHostId as radarrHostId,
  uiPort as radarrPort,
} from 'radarr-startos/startos/utils'
import {
  uiHostId as sonarrHostId,
  uiPort as sonarrPort,
} from 'sonarr-startos/startos/utils'
import { manifest as radarrManifest } from 'radarr-startos/startos/manifest'
import { manifest as sonarrManifest } from 'sonarr-startos/startos/manifest'
import { sdk } from './sdk'
import { i18n } from './i18n'

export const uiPort = 5055
export const uiHostId = 'ui-multi'
export type ArrId = 'radarr' | 'sonarr'
export const arrServices = {
  radarr: {
    title: 'Radarr',
    hostId: radarrHostId,
    port: radarrPort,
    api: 'v3',
  },
  sonarr: {
    title: 'Sonarr',
    hostId: sonarrHostId,
    port: sonarrPort,
    api: 'v3',
  },
} as const

// Jellyfin exports its port but not its host id; the pinned interfaces.ts binds 'main'.
export function jellyfinAddress(effects: T.Effects) {
  return sdk.host.getBridgeAddress(effects, {
    packageId: 'jellyfin',
    hostId: 'main',
    internalPort: jellyfinPort,
    ssl: false,
  })
}

export function arrAddress(effects: T.Effects, id: ArrId) {
  const service = arrServices[id]
  return sdk.host.getBridgeAddress(effects, {
    packageId: id,
    hostId: service.hostId,
    internalPort: service.port,
    ssl: false,
  })
}

export function configMounts() {
  return sdk.Mounts.of().mountVolume({
    volumeId: 'main',
    subpath: null,
    mountpoint: '/app/config',
    readonly: false,
  })
}

export function addArrMount(
  mounts: ReturnType<typeof configMounts>,
  id: ArrId,
) {
  return id === 'radarr'
    ? mounts.mountDependency<typeof radarrManifest>({
        dependencyId: id,
        volumeId: 'public',
        subpath: null,
        mountpoint: '/mnt/radarr',
        readonly: true,
      })
    : mounts.mountDependency<typeof sonarrManifest>({
        dependencyId: id,
        volumeId: 'public',
        subpath: null,
        mountpoint: '/mnt/sonarr',
        readonly: true,
      })
}

export async function readArr(effects: T.Effects, id: ArrId) {
  const address = await arrAddress(effects, id).once()
  if (!address)
    throw new Error(
      i18n('Install and start the selected service, then try again.'),
    )
  const apiKey = await sdk.SubContainer.withTemp(
    effects,
    { imageId: 'seerr' },
    addArrMount(sdk.Mounts.of(), id),
    'read-integration-key',
    async (sub) =>
      (
        await FileHelper.string(sub.subpath(`/mnt/${id}/api-key`))
          .read()
          .once()
      )?.trim(),
  )
  if (!apiKey)
    throw new Error(i18n('The selected service has not published an API key.'))
  async function get(path: string): Promise<unknown> {
    const response = await fetch(
      `http://${address}/api/${arrServices[id].api}/${path}`,
      {
        headers: { 'X-Api-Key': apiKey! },
        signal: AbortSignal.timeout(10000),
      },
    )
    if (!response.ok)
      throw new Error(i18n('The selected service rejected the connection.'))
    return response.json()
  }
  return { address, apiKey, get }
}

// Runs inside the pinned upstream image, using its own credential and settings models.
export const maintenanceScript = String.raw`
const fs = require('node:fs');
const db = require('/app/dist/datasource').default;
const { User } = require('/app/dist/entity/User');
const { UserType } = require('/app/dist/constants/user');
const { Permission } = require('/app/dist/lib/permissions');
const { MediaServerType } = require('/app/dist/constants/server');
const { getSettings } = require('/app/dist/lib/settings');
const JellyfinAPI = require('/app/dist/api/jellyfin').default;
async function run(input) {
  fs.mkdirSync('/app/config/db', { recursive: true });
  await db.initialize();
  try {
    if (input.mode !== 'password') {
      await db.query('PRAGMA foreign_keys=OFF');
      await db.runMigrations();
      await db.query('PRAGMA foreign_keys=ON');
    }
    const users = db.getRepository(User);
    let owner = await users.findOne({ where: { id: 1 } });
    if (input.mode === 'password') {
      if (!owner) throw new Error(input.errors.connectFirst);
      await owner.setPassword(input.password);
      await users.save(owner);
      return;
    }
    const settingsPath = '/app/config/settings.json';
    if (fs.existsSync(settingsPath)) JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const settings = await getSettings().load();
    if (input.mode === 'connect') {
      const deviceId = 'BOT_seerr';
      const client = new JellyfinAPI('http://' + input.address, undefined, deviceId);
      const account = await client.login(input.username, input.password).catch(e => {
        throw e.statusCode === 401 ? new Error(input.errors.loginRejected) : e;
      });
      if (!account.User.Policy.IsAdministrator) throw new Error(input.errors.administratorRequired);
      const tokenClient = new JellyfinAPI('http://' + input.address, account.AccessToken, deviceId);
      let apiKey = settings.jellyfin.apiKey;
      if (settings.jellyfin.serverId !== account.User.ServerId) apiKey = '';
      if (apiKey) {
        try { await new JellyfinAPI('http://' + input.address, apiKey, deviceId).getSystemInfo(); }
        catch { apiKey = ''; }
      }
      if (!apiKey) apiKey = await tokenClient.createApiToken('Seerr');
      owner = owner || new User({ id: 1 });
      Object.assign(owner, {
        email: input.email, jellyfinUsername: account.User.Name,
        jellyfinUserId: account.User.Id, jellyfinDeviceId: deviceId,
        jellyfinAuthToken: account.AccessToken, permissions: Permission.ADMIN,
        avatar: '/avatarproxy/' + account.User.Id + '?v=0', userType: UserType.JELLYFIN,
      });
      await users.save(owner);
      settings.jellyfin = { ...settings.jellyfin, name: await client.getServerName(),
        serverId: account.User.ServerId, apiKey };
    }
    if (!owner) throw new Error(input.errors.connectFirst);
    if (input.adminPassword) {
      const saved = await users.createQueryBuilder('user').addSelect('user.password').where('user.id = :id', { id: 1 }).getOneOrFail();
      if (!(await saved.passwordMatch(input.adminPassword))) {
        await saved.setPassword(input.adminPassword);
        await users.save(saved);
      }
    }
    if (input.email) { owner.email = input.email; await users.save(owner); }
    settings.main = { ...settings.main, mediaServerType: MediaServerType.JELLYFIN,
      localLogin: true, mediaServerLogin: true, versionCheck: false };
    if (input.mode === 'connect') settings.main.newPlexLogin = false;
    settings.network = { ...settings.network, trustProxy: true };
    settings.public = { ...settings.public, initialized: true };
    if (input.address) {
      const url = new URL('http://' + input.address);
      settings.jellyfin = { ...settings.jellyfin, ip: url.hostname, port: Number(url.port), useSsl: false, urlBase: '' };
    }
    for (const id of ['radarr', 'sonarr']) {
      if (!Object.hasOwn(input, id)) continue;
      const desired = input[id];
      const name = (id === 'radarr' ? 'Radarr' : 'Sonarr') + ' (StartOS)';
      const previous = settings[id].find(s => s.name === name);
      if (desired === null) { settings[id] = settings[id].filter(s => s.name !== name); continue; }
      if (!desired.address || !desired.apiKey) continue;
      const url = new URL('http://' + desired.address);
      const entry = { ...previous, id: previous?.id ?? Math.max(-1, ...settings[id].map(s => s.id)) + 1,
        name, hostname: url.hostname, port: Number(url.port), apiKey: desired.apiKey,
        useSsl: false, baseUrl: '', activeProfileId: desired.profileId,
        activeProfileName: desired.profileName, activeDirectory: desired.rootFolder,
        tags: previous?.tags ?? [], is4k: false, isDefault: true,
        syncEnabled: true, preventSearch: previous?.preventSearch ?? false,
        tagRequests: previous?.tagRequests ?? false, overrideRule: previous?.overrideRule ?? [],
      };
      if (id === 'radarr') entry.minimumAvailability = previous?.minimumAvailability ?? 'released';
      else Object.assign(entry, { seriesType: previous?.seriesType ?? 'standard',
        animeSeriesType: previous?.animeSeriesType ?? 'anime', enableSeasonFolders: previous?.enableSeasonFolders ?? true,
        monitorNewItems: previous?.monitorNewItems ?? 'all' });
      settings[id] = settings[id].filter(s => s.name !== name).map(s => s.is4k ? s : { ...s, isDefault: false }).concat(entry);
    }
    await settings.save();
  } finally { await db.destroy(); }
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => run(JSON.parse(input)).then(() => process.exit(0)).catch(error => {
  console.error(error.message || error.errorCode); process.exit(1);
}));
`

export async function maintain(
  effects: T.Effects,
  input: Record<string, unknown>,
) {
  await sdk.SubContainer.withTemp(
    effects,
    { imageId: 'seerr' },
    configMounts(),
    'seerr-maintenance',
    async (sub) => {
      await sub.execFail(['chown', '-R', '1000:1000', '/app/config'], {
        user: 'root',
      })
      await sub.execFail(['node', '-e', maintenanceScript], {
        user: 'node',
        cwd: '/app',
        input: JSON.stringify({
          ...input,
          errors: {
            connectFirst: i18n('Connect Jellyfin first.'),
            administratorRequired: i18n(
              'A Jellyfin administrator account is required.',
            ),
            loginRejected: i18n('Jellyfin rejected the username or password.'),
          },
        }),
        timeout: 120000,
      })
    },
  )
}

export const jellyfinSettings = FileHelper.json(
  { base: sdk.volumes.main, subpath: 'settings.json' },
  z.looseObject({
    jellyfin: z
      .looseObject({ apiKey: z.string().catch('') })
      .catch({ apiKey: '' }),
  }),
)

export async function ready(url: string, headers?: Record<string, string>) {
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok)
      return {
        result: 'success' as const,
        message: i18n('The service is ready.'),
      }
  } catch {}
  return {
    result: 'failure' as const,
    message: i18n(
      'The service is unreachable. Check its health and connection settings.',
    ),
  }
}
