export type SessionState = 'idle' | 'recording' | 'paused' | 'stopped';

export type Severity = 'low' | 'med' | 'high';

export interface Environment {
  url: string;
  host: string;
  tenant?: string;
  company?: string;
  legalEntity?: string;
  language?: string;
  userAgent: string;
  extensionVersion: string;
  capturedAt: number;
}

export interface NavigateStep {
  kind: 'navigate';
  id: string;
  ts: number;
  url: string;
  menuItem?: string;
  formTitle?: string;
  company?: string;
  screenshotId?: string;
  note?: string;
}

export interface ClickStep {
  kind: 'click';
  id: string;
  ts: number;
  label: string;
  role?: string;
  formTitle?: string;
  screenshotId?: string;
  note?: string;
}

export interface EditStep {
  kind: 'edit';
  id: string;
  ts: number;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  formTitle?: string;
  note?: string;
}

export interface ErrorStep {
  kind: 'error';
  id: string;
  ts: number;
  message: string;
  formTitle?: string;
  screenshotId?: string;
  note?: string;
}

export interface ManualSnapStep {
  kind: 'manual-snap';
  id: string;
  ts: number;
  screenshotId: string;
  formTitle?: string;
  note?: string;
}

export interface NoteStep {
  kind: 'note';
  id: string;
  ts: number;
  text: string;
}

export interface PastedImageStep {
  kind: 'pasted-img';
  id: string;
  ts: number;
  screenshotId: string;
  note?: string;
}

export type Step =
  | NavigateStep
  | ClickStep
  | EditStep
  | ErrorStep
  | ManualSnapStep
  | NoteStep
  | PastedImageStep;

export interface Session {
  id: string;
  tabId: number;
  state: SessionState;
  startedAt: number;
  endedAt?: number;
  title: string;
  description: string;
  severity: Severity;
  tags: string[];
  environment: Environment;
  steps: Step[];
}

export interface RecordingOptions {
  autoSnapOnNavigate: boolean;
  autoSnapOnError: boolean;
  autoSnapOnClick: boolean;
  maxSnapshotsPerSession: number;
}

export const DEFAULT_OPTIONS: RecordingOptions = {
  autoSnapOnNavigate: true,
  autoSnapOnError: true,
  autoSnapOnClick: false,
  maxSnapshotsPerSession: 200,
};

export interface SnapshotBlob {
  id: string;
  sessionId: string;
  ts: number;
  mime: string;
  data: Blob;
  width?: number;
  height?: number;
}

/**
 * Message envelope between content/popup/review/background.
 */
export type Message =
  // content -> background
  | { type: 'SESSION_START'; env: Environment }
  | { type: 'SESSION_STOP' }
  | { type: 'SESSION_PAUSE' }
  | { type: 'SESSION_RESUME' }
  | { type: 'STEP_EVENT'; step: Omit<Step, 'id' | 'ts'> & { kind: Step['kind'] } }
  | { type: 'REQUEST_SNAPSHOT'; reason: 'manual' | 'auto-nav' | 'auto-click' | 'auto-error'; attachToStepId?: string }
  | { type: 'ERROR_DETECTED'; message: string; formTitle?: string }
  // popup -> background
  | { type: 'POPUP_GET_STATE' }
  | { type: 'POPUP_START' }
  | { type: 'POPUP_STOP' }
  | { type: 'POPUP_PAUSE' }
  | { type: 'POPUP_RESUME' }
  | { type: 'POPUP_OPEN_REVIEW' }
  | { type: 'POPUP_RECOVER_RESUME' }
  | { type: 'POPUP_RECOVER_REVIEW' }
  | { type: 'POPUP_RECOVER_DISCARD' }
  // review -> background
  | { type: 'REVIEW_GET_SESSION'; sessionId: string }
  | { type: 'REVIEW_UPDATE_SESSION'; session: Session }
  | { type: 'REVIEW_GET_SNAPSHOT'; snapshotId: string }
  | { type: 'REVIEW_ADD_PASTED_IMAGE'; sessionId: string; pngDataUrl: string; note?: string }
  | { type: 'REVIEW_REPLACE_SNAPSHOT'; sessionId: string; snapshotId: string; pngDataUrl: string }
  | { type: 'REVIEW_EXPORT_XML'; sessionId: string }
  | { type: 'REVIEW_SUBMIT_TRACKER'; sessionId: string }
  | { type: 'REVIEW_GET_TRACKER_INFO' }
  // background -> content
  | { type: 'STATE_UPDATE'; state: SessionState; sessionId?: string; stepCount: number };

export interface MessageResponse<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export const EXT_VERSION = '0.1.0';
