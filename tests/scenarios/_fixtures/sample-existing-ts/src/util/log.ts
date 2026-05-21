// sample-existing-ts · util · log
//
// Tiny logger to give the scan something concrete in the util layer.

export const logInfo = (msg: string): void => {
  console.log(`[info] ${msg}`);
};

export const logError = (msg: string, err?: unknown): void => {
  console.error(`[error] ${msg}`, err);
};
