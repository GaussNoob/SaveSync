import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  disableSteamCloudForApp,
  findSteamCloudSavePath,
  listInstalledSteamApps,
  parseVdf
} from '../server/steam.js';

describe('Steam localconfig updates', () => {
  it('changes only the selected app and keeps an atomic backup', () => {
    const userdata = path.join(process.env.SAVESYNC_TEST_ROOT, 'steam', 'userdata');
    const configDir = path.join(userdata, '123456', 'config');
    const localConfig = path.join(configDir, 'localconfig.vdf');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(localConfig, `
"UserLocalConfigStore"
{
  "Software"
  {
    "Valve"
    {
      "Steam"
      {
        "Apps"
        {
          "42"
          {
            "Nested" { "Value" "1" }
            "Cloud" "1"
          }
          "84" { "Cloud" "1" }
        }
      }
    }
  }
}
`);

    const changed = disableSteamCloudForApp('42', { steam: { userdata_path: userdata } });
    expect(changed).toEqual([localConfig]);
    const updated = fs.readFileSync(localConfig, 'utf8');
    const parsed = parseVdf(updated);
    const apps = parsed.UserLocalConfigStore.Software.Valve.Steam.Apps;
    expect(apps['42'].Cloud).toBe('0');
    expect(apps['84'].Cloud).toBe('1');
    expect(fs.readdirSync(configDir).some(name => name.endsWith('.bak'))).toBe(true);
  });

  it('lists installed games outside the internal catalog and locates Steam Cloud saves', () => {
    const steamRoot = path.join(process.env.SAVESYNC_TEST_ROOT, 'steam-library');
    const steamapps = path.join(steamRoot, 'steamapps');
    const userdata = path.join(steamRoot, 'userdata');
    const remote = path.join(userdata, '123456', '999000', 'remote');
    fs.mkdirSync(remote, { recursive: true });
    fs.mkdirSync(path.join(steamapps, 'common', 'Example Game'), { recursive: true });
    fs.writeFileSync(path.join(remote, 'slot.sav'), 'save');
    fs.writeFileSync(path.join(steamapps, 'appmanifest_999000.acf'), `
"AppState"
{
  "appid" "999000"
  "name" "Example Game"
  "installdir" "Example Game"
}
`);
    fs.writeFileSync(path.join(steamapps, 'appmanifest_228980.acf'), `
"AppState"
{
  "appid" "228980"
  "name" "Steamworks Common Redistributables"
  "installdir" "Steamworks Shared"
}
`);
    const config = { steam: { userdata_path: userdata } };

    const installed = listInstalledSteamApps(config);
    expect(installed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        appid: '999000',
        name: 'Example Game',
        install_dir: path.join(steamapps, 'common', 'Example Game')
      })
    ]));
    expect(installed.some(app => app.appid === '228980')).toBe(false);
    expect(findSteamCloudSavePath('999000', config)).toBe(remote);
  });
});
