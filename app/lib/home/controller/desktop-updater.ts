/**
 * Desktop updater bridge helpers.
 */

export type DesktopUpdaterStatus = {
  supported: boolean;
  checking: boolean;
  updateAvailable: boolean;
  updateDownloaded: boolean;
  currentVersion: string;
  availableVersion: string;
  errorMessage: string;
  lastCheckedAt: string;
};

export type DesktopUpdaterApi = {
  getUpdaterStatus: () => Promise<unknown>;
  checkForUpdates: () => Promise<unknown>;
  onUpdaterStatus: (listener: (status: unknown) => void) => () => void;
  quitAndInstallUpdate: () => Promise<void>;
};

const DEFAULT_DESKTOP_UPDATER_STATUS: DesktopUpdaterStatus = {
  supported: false,
  checking: false,
  updateAvailable: false,
  updateDownloaded: false,
  currentVersion: "",
  availableVersion: "",
  errorMessage: "",
  lastCheckedAt: "",
};

export function getDefaultDesktopUpdaterStatus(): DesktopUpdaterStatus {
  return {
    ...DEFAULT_DESKTOP_UPDATER_STATUS,
  };
}

export function readDesktopApi(): DesktopUpdaterApi | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as Window & { desktopApi?: unknown }).desktopApi;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const typedCandidate = candidate as Partial<DesktopUpdaterApi>;
  if (
    typeof typedCandidate.getUpdaterStatus !== "function" ||
    typeof typedCandidate.checkForUpdates !== "function" ||
    typeof typedCandidate.onUpdaterStatus !== "function" ||
    typeof typedCandidate.quitAndInstallUpdate !== "function"
  ) {
    return null;
  }

  return typedCandidate as DesktopUpdaterApi;
}

export function readDesktopUpdaterStatusFromUnknown(value: unknown): DesktopUpdaterStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  const supported = readBoolean(typedValue.supported);
  const checking = readBoolean(typedValue.checking);
  const updateAvailable = readBoolean(typedValue.updateAvailable);
  const updateDownloaded = readBoolean(typedValue.updateDownloaded);
  if (
    supported === null ||
    checking === null ||
    updateAvailable === null ||
    updateDownloaded === null
  ) {
    return null;
  }

  return {
    supported,
    checking,
    updateAvailable,
    updateDownloaded,
    currentVersion: readTrimmedString(typedValue.currentVersion),
    availableVersion: readTrimmedString(typedValue.availableVersion),
    errorMessage: readTrimmedString(typedValue.errorMessage),
    lastCheckedAt: readTrimmedString(typedValue.lastCheckedAt),
  };
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") {
    return null;
  }

  return value;
}

function readTrimmedString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}
