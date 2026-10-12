import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildIdentityToken, isMicrosoftClientId, isTrustedMicrosoftUrl, xstsErrorMessage } from '../src/shared/auth';
import { AuthError, fetchProfile, minecraftLogin, pollDeviceToken, xstsAuth } from '../src/main/auth/microsoft';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const dc = { deviceCode: 'd', userCode: 'U', verificationUri: 'https://www.microsoft.com/link', expiresIn: 900, interval: 5 };

afterEach(() => vi.unstubAllGlobals());

describe('helpers puros', () => {
  it('valida Client ID y URLs de Microsoft', () => {
    expect(isMicrosoftClientId('12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(isMicrosoftClientId('abc')).toBe(false);
    expect(isTrustedMicrosoftUrl('https://www.microsoft.com/link')).toBe(true);
    expect(isTrustedMicrosoftUrl('http://www.microsoft.com/link')).toBe(false);
    expect(isTrustedMicrosoftUrl('https://microsoft.com.evil.example/')).toBe(false);
  });
  it('arma el identityToken y traduce errores XSTS', () => {
    expect(buildIdentityToken('uhs1', 'tok')).toBe('XBL3.0 x=uhs1;tok');
    expect(xstsErrorMessage(2148916233)).toContain('perfil de Xbox');
    expect(xstsErrorMessage(2148916238)).toContain('menor');
  });
});

describe('device code polling', () => {
  it('espera, respeta slow_down y devuelve tokens', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: 'authorization_pending' }, 400))
      .mockResolvedValueOnce(json({ error: 'slow_down' }, 400))
      .mockResolvedValueOnce(json({ access_token: 'a', refresh_token: 'r' }));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn(async () => {});
    const t = await pollDeviceToken('cid', dc, { sleep });
    expect(t).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 5000, 10000]);
  });
  it('falla si el código expira', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'expired_token' }, 400)));
    await expect(pollDeviceToken('cid', dc, { sleep: async () => {} })).rejects.toThrow(/expiró/);
  });
  it('se puede cancelar', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(pollDeviceToken('cid', dc, { signal: ac.signal, sleep: async () => {} })).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('cadena Xbox / Minecraft', () => {
  it('XSTS 401 con XErr produce mensaje claro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ XErr: 2148916233 }, 401)));
    await expect(xstsAuth('x')).rejects.toThrow(/perfil de Xbox/);
  });
  it('403 en login_with_xbox indica app no aprobada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ errorMessage: 'Invalid app registration' }, 403)));
    await expect(minecraftLogin('u', 't')).rejects.toMatchObject({ code: 'app_not_approved' });
  });
  it('perfil 404 indica que no posee el juego; 200 valida formato', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 404)));
    await expect(fetchProfile('t')).rejects.toBeInstanceOf(AuthError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ id: '0123456789abcdef0123456789abcdef', name: 'Steve_1' })));
    await expect(fetchProfile('t')).resolves.toEqual({ uuid: '0123456789abcdef0123456789abcdef', name: 'Steve_1' });
  });
  it('rechaza URLs no HTTPS en el cliente HTTP', async () => {
    const { getJson } = await import('../src/main/http');
    await expect(getJson('http://example.com')).rejects.toThrow(/HTTPS/);
  });
});
