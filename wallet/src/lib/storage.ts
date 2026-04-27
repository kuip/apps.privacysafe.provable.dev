type JsonFileStore = {
  read<T>(path: string): Promise<T | undefined>;
  write(path: string, value: unknown): Promise<void>;
  delete(path: string): Promise<void>;
};

function localStorageKey(scope: 'local' | 'synced', path: string): string {
  return `wallet.app.provable.dev:${scope}:${path}`;
}

function browserFallback(scope: 'local' | 'synced'): JsonFileStore {
  return {
    async read<T>(path: string): Promise<T | undefined> {
      const raw = localStorage.getItem(localStorageKey(scope, path));
      return raw ? JSON.parse(raw) as T : undefined;
    },
    async write(path: string, value: unknown): Promise<void> {
      localStorage.setItem(localStorageKey(scope, path), JSON.stringify(value));
    },
    async delete(path: string): Promise<void> {
      localStorage.removeItem(localStorageKey(scope, path));
    },
  };
}

async function privacySafeStore(scope: 'local' | 'synced'): Promise<JsonFileStore | undefined> {
  const storage = w3n.storage;
  const fs = scope === 'local'
    ? await storage?.getAppLocalFS?.()
    : await storage?.getAppSyncedFS?.();

  if (!fs) {
    return undefined;
  }

  return {
    async read<T>(path: string): Promise<T | undefined> {
      try {
        return await fs.readJSONFile<T>(path);
      } catch (err) {
        if ((err as web3n.files.FileException).notFound) {
          return undefined;
        }
        throw err;
      }
    },
    async write(path: string, value: unknown): Promise<void> {
      await fs.writeJSONFile(path, value);
    },
    async delete(path: string): Promise<void> {
      try {
        await (fs as web3n.files.WritableFS & { deleteFile(path: string): Promise<void> }).deleteFile(path);
      } catch (err) {
        if ((err as web3n.files.FileException).notFound) {
          return;
        }
        throw err;
      }
    },
  };
}

export async function openJsonStore(scope: 'local' | 'synced'): Promise<JsonFileStore> {
  return (await privacySafeStore(scope)) ?? browserFallback(scope);
}
