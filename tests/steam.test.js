import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { disableSteamCloudForApp, parseVdf } from '../server/steam.js';

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
});
