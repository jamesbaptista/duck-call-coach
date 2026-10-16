/** The slice of the store that app-level settings code needs; the real Store satisfies it. */
export interface SettingsStore {
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
}
