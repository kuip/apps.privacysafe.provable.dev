import { beforeEach, vi } from 'vitest';

type StoredJson = Record<string, unknown>;

type MockJsonFs = {
  readJSONFile: ReturnType<typeof vi.fn>;
  writeJSONFile: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
  dump(): StoredJson;
};

type MockStores = {
  local: MockJsonFs;
  synced: MockJsonFs;
};

let stores: MockStores;

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function createMockFs(): MockJsonFs {
  const files = new Map<string, unknown>();
  return {
    readJSONFile: vi.fn(async (path: string) => {
      if (!files.has(path)) {
        throw { notFound: true, path };
      }
      return clone(files.get(path));
    }),
    writeJSONFile: vi.fn(async (path: string, value: unknown) => {
      files.set(path, clone(value));
    }),
    deleteFile: vi.fn(async (path: string) => {
      if (!files.has(path)) {
        throw { notFound: true, path };
      }
      files.delete(path);
    }),
    dump() {
      return Object.fromEntries(Array.from(files.entries()).map(([path, value]) => [path, clone(value)]));
    },
  };
}

export function installMockW3nStorage(): MockStores {
  stores = {
    local: createMockFs(),
    synced: createMockFs(),
  };

  Object.assign(globalThis, {
    w3n: {
      log: vi.fn(async () => undefined),
      storage: {
        getAppLocalFS: vi.fn(async () => stores.local),
        getAppSyncedFS: vi.fn(async () => stores.synced),
      },
      shell: {
        clipboard: {
          writeText: vi.fn(async () => undefined),
        },
        openURL: vi.fn(async () => undefined),
      },
    },
  });

  return stores;
}

export function getMockStores(): MockStores {
  return stores;
}

beforeEach(() => {
  localStorage.clear();
  installMockW3nStorage();
});
