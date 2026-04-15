/**
 * Tracker settings type lives in its own module to break the dependency
 * cycle that otherwise forms between storage.ts and the provider index:
 * storage -> trackers/index -> trackers/common -> exporter -> storage.
 * Types can still be imported from './index', but storage imports from
 * here directly.
 */
export interface TrackerSettings {
  activeProviderId: string | null;
  providerConfigs: Record<string, Record<string, unknown>>;
}

export const DEFAULT_TRACKER_SETTINGS: TrackerSettings = {
  activeProviderId: null,
  providerConfigs: {},
};
