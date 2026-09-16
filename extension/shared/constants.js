/**
 * SIH26171 Privacy-Preserving Vision Agent - Shared Constants & Action Definitions
 */

export const MESSAGE_TYPES = {
  // Popup -> Service Worker
  START_AGENT: 'START_AGENT',
  STOP_AGENT: 'STOP_AGENT',
  GET_AGENT_STATUS: 'GET_AGENT_STATUS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',

  // Service Worker -> Content Script
  SCAN_PII: 'SCAN_PII',
  EXECUTE_STEPS: 'EXECUTE_STEPS',
  STOP_EXECUTION: 'STOP_EXECUTION',

  // Content Script / Service Worker -> Offscreen Document
  CAPTURE_AND_REDACT_FRAME: 'CAPTURE_AND_REDACT_FRAME',
  REDACT_CANVAS: 'REDACT_CANVAS',

  // Status Notifications
  STATUS_UPDATE: 'STATUS_UPDATE',
  LOG_EVENT: 'LOG_EVENT',
  PLAN_RECEIVED: 'PLAN_RECEIVED',
  MUTATION_DETECTED: 'MUTATION_DETECTED',
  EXECUTION_FINISHED: 'EXECUTION_FINISHED'
};

export const ACTION_TYPES = {
  CLICK: 'click',
  TYPE: 'type',
  SCROLL: 'scroll',
  WAIT_FOR_MUTATION: 'wait_for_mutation',
  FINISH: 'finish',
  FAIL: 'fail'
};

export const DEFAULT_SETTINGS = {
  serverUrl: 'http://127.0.0.1:8000',
  domRedactionEnabled: false,
  textRedactionEnabled: false,
  cvRedactionEnabled: false,
  redactionBufferPx: 5,
  autoExecutionDelayMs: 600
};
