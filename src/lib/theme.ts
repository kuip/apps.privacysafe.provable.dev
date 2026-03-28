type ThemeName = 'default' | 'dark' | 'dark2';

type SettingsJSON = {
  colorTheme?: ThemeName;
};

const launcherApp = 'launcher.app.privacysafe.io';
const resourceName = 'ui-settings';

function setThemeClass(theme: ThemeName): void {
  const htmlEl = document.querySelector('html');
  if (!htmlEl) {
    return;
  }

  htmlEl.classList.remove('default-theme', 'dark-theme', 'dark2-theme');
  htmlEl.classList.add(`${theme}-theme`);
}

function parseThemeName(value: unknown): ThemeName {
  return value === 'dark' || value === 'dark2' ? value : 'default';
}

export async function initThemeSync(): Promise<void> {
  const resource = await w3n.shell?.getFSResource?.(launcherApp, resourceName);
  if (!resource) {
    return;
  }

  try {
    const settings = await resource.readJSON<SettingsJSON>();
    setThemeClass(parseThemeName(settings?.colorTheme));
  } catch (err) {
    console.error('Failed to read theme settings.', err);
  }

  resource.watch?.({
    next: async event => {
      if (event.type !== 'file-change') {
        return;
      }

      try {
        const settings = await resource.readJSON<SettingsJSON>();
        setThemeClass(parseThemeName(settings?.colorTheme));
      } catch (err) {
        console.error('Failed to refresh theme settings.', err);
      }
    },
    error: err => {
      console.error('Theme settings watcher failed.', err);
    },
  });
}
