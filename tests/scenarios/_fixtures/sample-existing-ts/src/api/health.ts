// sample-existing-ts · api · health
//
// Liveness probe endpoint stub.

export const healthCheck = (): {readonly ok: boolean; readonly uptime: number} => {
  return {ok: true, uptime: process.uptime()};
};
