// sample-existing-ts · api · auth
//
// Minimal token verification stub for the payment endpoints.

import {newUuid} from '../util/uuid.js';

export const issueToken = (userId: string): string => {
  return `${userId}.${newUuid()}`;
};

export const verifyToken = (token: string): boolean => {
  return token.includes('.');
};
