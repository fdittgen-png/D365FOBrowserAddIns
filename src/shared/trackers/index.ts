import type { TrackerProvider } from './provider';
import { OtrsProvider } from './otrs';
import { JiraProvider } from './jira';
import { AzureDevOpsProvider } from './azuredevops';
import { GithubProvider } from './github';

export * from './provider';
export * from './common';
export * from './settings';

/**
 * Registry of built-in providers. Adding a new tracker is a matter of
 * implementing `TrackerProvider` in a new file and appending it here.
 */
export const TRACKER_PROVIDERS: readonly TrackerProvider[] = [
  new OtrsProvider(),
  new JiraProvider(),
  new AzureDevOpsProvider(),
  new GithubProvider(),
] as const;

export function getProvider(id: string): TrackerProvider | undefined {
  return TRACKER_PROVIDERS.find((p) => p.id === id);
}
