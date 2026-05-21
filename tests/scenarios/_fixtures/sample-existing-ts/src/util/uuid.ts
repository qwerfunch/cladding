// sample-existing-ts · util · uuid
//
// Minimal UUID generator used by lib + api layers.

export const newUuid = (): string => {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};
