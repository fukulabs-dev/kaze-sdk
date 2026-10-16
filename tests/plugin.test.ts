import { describe, it, expect } from 'vitest';
import withOTA from '../plugin/src/withOTA';

describe('Expo Config Plugin withOTA', () => {
  it('adds required native configurations to app config', () => {
    const rawConfig = {
      name: 'TestApp',
      slug: 'test-app',
    };
    const modified = withOTA(rawConfig);
    expect(modified.extra?.otaEnabled).toBe(true);
  });
});
