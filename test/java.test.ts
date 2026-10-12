import { describe, it, expect } from 'vitest';
import { parseJavaVersion } from '../src/main/minecraft/javaDetect';

describe('parseJavaVersion', () => {
  it('lee versiones modernas y antiguas', () => {
    expect(parseJavaVersion('openjdk version "21.0.10" 2026-01-20')).toEqual({ version: '21.0.10', major: 21 });
    expect(parseJavaVersion('java version "1.8.0_392"')).toEqual({ version: '1.8.0_392', major: 8 });
    expect(parseJavaVersion('basura')).toBeNull();
  });
});
