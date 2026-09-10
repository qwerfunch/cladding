// Cladding · unit tests for src/adapters/host/sampling-context.ts (F-075)

import {afterEach, describe, expect, test, vi} from 'vitest';

import type {SamplingCapableServer} from '../../src/adapters/host/transport.js';
import {
  clearHostMcpServerForTesting,
  getHostMcpServer,
  setHostMcpServer,
} from '../../src/adapters/host/sampling-context.js';

function stubServer(): SamplingCapableServer {
  return {createMessage: vi.fn()} as unknown as SamplingCapableServer;
}

describe('sampling-context (F-075, v0.2.26)', () => {
  afterEach(() => {
    clearHostMcpServerForTesting();
  });

  test('[covers:F-075/AC-219] getHostMcpServer returns null when nothing is registered', () => {
    expect(getHostMcpServer()).toBeNull();
  });

  test('[covers:F-075/AC-217][covers:F-075/AC-218] setHostMcpServer stores the server and getHostMcpServer returns it', () => {
    const s = stubServer();
    setHostMcpServer(s);
    expect(getHostMcpServer()).toBe(s);
  });

  test('disposer restores the previous registration', () => {
    const a = stubServer();
    const b = stubServer();
    setHostMcpServer(a);
    const dispose = setHostMcpServer(b);
    expect(getHostMcpServer()).toBe(b);
    dispose();
    expect(getHostMcpServer()).toBe(a);
  });

  test('disposer is a no-op when a later registration superseded it', () => {
    const a = stubServer();
    const b = stubServer();
    const c = stubServer();
    setHostMcpServer(a);
    const disposeB = setHostMcpServer(b);
    setHostMcpServer(c);
    // c is current; calling disposeB must NOT roll back to a — that
    // would clobber the active registration.
    disposeB();
    expect(getHostMcpServer()).toBe(c);
  });

  test('passing null clears the registration', () => {
    const s = stubServer();
    setHostMcpServer(s);
    setHostMcpServer(null);
    expect(getHostMcpServer()).toBeNull();
  });

  test('clearHostMcpServerForTesting empties the registration unconditionally', () => {
    setHostMcpServer(stubServer());
    clearHostMcpServerForTesting();
    expect(getHostMcpServer()).toBeNull();
  });
});
