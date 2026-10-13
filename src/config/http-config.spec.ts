import { isSwaggerEnabled, resolveCorsOrigin } from './http-config';

describe('http-config', () => {
  it('has no CORS at all unless an allow-list is configured', () => {
    expect(resolveCorsOrigin({})).toBe(false);
    expect(resolveCorsOrigin({ CORS_ORIGINS: '' })).toBe(false);
    expect(resolveCorsOrigin({ CORS_ORIGINS: ' , ' })).toBe(false);
  });

  it('uses exactly the listed origins', () => {
    expect(
      resolveCorsOrigin({
        CORS_ORIGINS: 'https://app.havit.dev, https://admin.havit.dev',
      }),
    ).toEqual(['https://app.havit.dev', 'https://admin.havit.dev']);
  });

  it('keeps Swagger off unless explicitly enabled', () => {
    expect(isSwaggerEnabled({})).toBe(false);
    expect(isSwaggerEnabled({ ENABLE_SWAGGER: 'false' })).toBe(false);
    expect(isSwaggerEnabled({ ENABLE_SWAGGER: '1' })).toBe(false);
    expect(isSwaggerEnabled({ ENABLE_SWAGGER: 'true' })).toBe(true);
  });
});
