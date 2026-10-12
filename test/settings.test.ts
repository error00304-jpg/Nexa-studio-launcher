import { describe, it, expect } from 'vitest';
import { defaultSettings, validateSettings, checkJvmArg } from '../src/shared/settings';

const base = defaultSettings('C:\\Users\\test\\.nexastudios');

describe('validateSettings', () => {
  it('acepta los valores por defecto', () => {
    expect(validateSettings(base).ok).toBe(true);
  });
  it('rechaza RAM fuera de rango o no entera', () => {
    expect(validateSettings({ ...base, ramMb: 100 }).ok).toBe(false);
    expect(validateSettings({ ...base, ramMb: 4096.5 }).ok).toBe(false);
    expect(validateSettings({ ...base, ramMb: NaN }).ok).toBe(false);
  });
  it('rechaza rutas relativas, con ".." o con caracteres de control', () => {
    expect(validateSettings({ ...base, minecraftDir: 'relativa/ruta' }).ok).toBe(false);
    expect(validateSettings({ ...base, minecraftDir: 'C:\\a\\..\\b' }).ok).toBe(false);
    expect(validateSettings({ ...base, minecraftDir: 'C:\\a\u0000b' }).ok).toBe(false);
  });
  it('valida la ruta de Java', () => {
    expect(validateSettings({ ...base, javaPath: 'C:\\Java\\bin\\javaw.exe' }).ok).toBe(true);
    expect(validateSettings({ ...base, javaPath: 'C:\\Windows\\cmd.exe' }).ok).toBe(false);
  });
  it('rechaza tipos incorrectos', () => {
    expect(validateSettings({ ...base, showLogs: 'si' }).ok).toBe(false);
    expect(validateSettings(null).ok).toBe(false);
  });
});

describe('argumentos JVM', () => {
  it('acepta flags seguros', () => {
    expect(checkJvmArg('-XX:+UseG1GC')).toBe(true);
    expect(checkJvmArg('-XX:MaxGCPauseMillis=50')).toBe(true);
  });
  it('rechaza ejecución de comandos, agentes y memoria', () => {
    expect(checkJvmArg('-XX:OnError=calc.exe')).toBe(false);
    expect(checkJvmArg('-javaagent:evil.jar')).toBe(false);
    expect(checkJvmArg('-Xmx8G')).toBe(false);
    expect(checkJvmArg('-XX:Flags=x')).toBe(false);
  });
});
