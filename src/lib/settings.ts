import { DEFAULT_SETTINGS, SETTINGS_FILE } from '@/lib/constants';
import type { KayrosSettings } from '@/lib/types';

function normalizeSettings(input?: Partial<KayrosSettings> | null): KayrosSettings {
  return {
    kayrosHost: input?.kayrosHost?.trim() || DEFAULT_SETTINGS.kayrosHost,
    dataType: input?.dataType?.trim() || DEFAULT_SETTINGS.dataType,
    userKey: input?.userKey?.trim() || DEFAULT_SETTINGS.userKey,
  };
}

export async function readSettings(): Promise<KayrosSettings> {
  const fs = await w3n.storage!.getAppLocalFS();
  try {
    const raw = await fs.readJSONFile(SETTINGS_FILE);
    return normalizeSettings(raw as Partial<KayrosSettings>);
  } catch {
    return normalizeSettings();
  }
}

export async function writeSettings(settings: Partial<KayrosSettings>): Promise<KayrosSettings> {
  const normalized = normalizeSettings(settings);
  const fs = await w3n.storage!.getAppLocalFS();
  await fs.writeJSONFile(SETTINGS_FILE, normalized);
  return normalized;
}
