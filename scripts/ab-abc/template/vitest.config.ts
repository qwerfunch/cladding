import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: {junit: '.cladding/test-report.junit.xml'},
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
    },
  },
});
