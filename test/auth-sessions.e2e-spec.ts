/**
 * B4 — sesiones, tokens y autenticación, sobre la API real: AppModule completo
 * (guards globales, ValidationPipe, throttler, TypeORM) contra un Postgres real
 * con todas las migraciones de database/ aplicadas. Sin mocks.
 *
 * Se ejecuta con `npm run test:e2e` y requiere B2_TEST_DB_URL, p. ej.
 *   B2_TEST_DB_URL=postgres://user:pass@localhost:5432/havit_test
 * NUNCA apuntar a una base compartida: inserta filas.
 *
 * Mapa (docs/sprint-10/B4-sesiones-tokens.md):
 *   S1  login/registro devuelven access (15 min, con sid) + refresh (solo su hash en BD)
 *   S2  refresh rota; el refresh viejo ya no sirve y reusarlo revoca la familia
 *   S3  logout revoca la sesión: ni refresh ni access token vuelven a valer
 *   S4  tokens de 7 días sin sid: siguen valiendo, pero no se pueden renovar
 *   S5  vencidos, cuentas baneadas y limpieza diaria
 *   P1  política de contraseñas en /auth/register
 *   E1  enumeración: mismas respuestas (y tiempos parecidos) en login y registro
 *   T1  límite propio de /auth/register (va al final: depende de cuántos registros hubo)
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import type { RefreshTokensService as RefreshTokensServiceType } from '../src/auth/refresh-tokens.service';
import type { AppModule as AppModuleType } from '../src/app.module';

const dbUrl = process.env.B2_TEST_DB_URL;
const describeDb = dbUrl ? describe : describe.skip;

const PASSWORD = 'Montaña-Lenta-Azul';

interface Claims {
  sub: string;
  sid?: string;
  iat: number;
  exp: number;
}
interface SessionBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; username: string };
}
interface ErrorBody {
  message: unknown;
  [key: string]: unknown;
}

const decodeJwt = (token: string) =>
  JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Claims;

/** supertest types every body as `any`: say what the API answered. */
const bodyOf = <T = SessionBody>(res: request.Response): T => res.body as T;

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

describeDb('B4 sessions, tokens and authentication (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let refreshTokens: RefreshTokensServiceType;
  let registrations = 0;

  const http = () => request(app.getHttpServer() as Server);

  /** Registers a fresh account; the response already carries a session. */
  const signUp = async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `b4_${tag}@example.com`;
    const username = `b4_${tag}`;
    registrations += 1;
    const res = await http()
      .post('/auth/register')
      .send({
        email,
        username,
        password: PASSWORD,
        acceptTerms: true,
        confirmAge16: true,
      })
      .expect(200);
    return {
      email,
      username,
      userId: bodyOf(res).user.id,
      accessToken: bodyOf(res).accessToken,
      refreshToken: bodyOf(res).refreshToken,
    };
  };

  const me = (accessToken: string) =>
    http().get('/auth/me').set('Authorization', `Bearer ${accessToken}`);

  const refresh = (refreshToken: string) =>
    http().post('/auth/refresh').send({ refreshToken });

  beforeAll(async () => {
    const u = new URL(dbUrl as string);
    process.env.DB_HOST = u.hostname;
    process.env.DB_PORT = u.port || '5432';
    process.env.DB_USERNAME = decodeURIComponent(u.username);
    process.env.DB_PASSWORD = decodeURIComponent(u.password);
    process.env.DB_DATABASE = u.pathname.slice(1);
    process.env.DB_SSL = 'false';
    process.env.JWT_SECRET ??= 'integration-test-secret';
    // El límite global no es lo que se prueba. El de /auth/register se sube
    // aquí y T1 lo devuelve a su valor real (se lee en cada petición).
    process.env.THROTTLE_LIMIT = '100000';
    process.env.THROTTLE_REGISTER_LIMIT = '100000';
    process.env.CLOUDFLARE_R2_PUBLIC_URL = '';

    // Imported only now, after the env above: AppModule reads it when loaded.
    // (Typed by hand: the dynamic import can't be resolved by the type checker
    // under `module: nodenext`, same as in api-integration.e2e-spec.ts.)
    const { AppModule } = (await import('../src/app.module')) as {
      AppModule: typeof AppModuleType;
    };
    const { RefreshTokensService } =
      (await import('../src/auth/refresh-tokens.service')) as {
        RefreshTokensService: typeof RefreshTokensServiceType;
      };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Misma configuración que src/main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    ds = app.get(DataSource);
    refreshTokens = app.get(RefreshTokensService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('S1 login y registro abren una sesión', () => {
    it('devuelve un access token de 15 min con sid y un refresh opaco del que solo se guarda el hash', async () => {
      const user = await signUp();
      const login = await http()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);

      for (const body of [bodyOf(login), { ...user }]) {
        const claims = decodeJwt(body.accessToken);
        expect(claims.exp - claims.iat).toBe(15 * 60);
        expect(claims.sub).toBe(user.userId);
        expect(claims.sid).toMatch(/^[0-9a-f-]{36}$/);
        expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      }
      // Dos logins = dos sesiones distintas.
      expect(decodeJwt(bodyOf(login).accessToken).sid).not.toBe(
        decodeJwt(user.accessToken).sid,
      );

      const rows: Array<{ token_hash: string; expires_at: Date }> =
        await ds.query(
          `SELECT token_hash, family_id, expires_at, revoked_at, replaced_by
         FROM havit.refresh_tokens WHERE user_id = $1`,
          [user.userId],
        );
      expect(rows).toHaveLength(2);
      const stored = JSON.stringify(rows);
      expect(stored).not.toContain(user.refreshToken);
      expect(stored).not.toContain(bodyOf(login).refreshToken);
      expect(rows.map((r) => r.token_hash)).toContain(
        sha256(bodyOf(login).refreshToken),
      );
      const days =
        (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);

      await me(bodyOf(login).accessToken).expect(200);
    });
  });

  describe('S2 rotación y reuso', () => {
    it('cada refresh devuelve un par nuevo de la misma sesión y el refresh usado deja de valer', async () => {
      const user = await signUp();
      const sid = decodeJwt(user.accessToken).sid;

      const first = await refresh(user.refreshToken).expect(200);
      expect(bodyOf(first).refreshToken).not.toBe(user.refreshToken);
      expect(decodeJwt(bodyOf(first).accessToken).sid).toBe(sid);
      expect(bodyOf(first).user).toEqual({
        id: user.userId,
        email: user.email,
        username: user.username,
      });
      await me(bodyOf(first).accessToken).expect(200);

      const second = await refresh(bodyOf(first).refreshToken).expect(200);
      await me(bodyOf(second).accessToken).expect(200);

      const chain: Array<{ id: string; replaced_by: string | null }> =
        await ds.query(
          `SELECT id, replaced_by FROM havit.refresh_tokens
         WHERE family_id = $1 ORDER BY created_at`,
          [sid],
        );
      expect(chain).toHaveLength(3);
      expect(chain[0].replaced_by).toBe(chain[1].id);
      expect(chain[1].replaced_by).toBe(chain[2].id);
      expect(chain[2].replaced_by).toBeNull();
    });

    it('reusar un refresh ya rotado revoca toda la familia: también el refresh y el access más nuevos', async () => {
      const user = await signUp();
      const sid = decodeJwt(user.accessToken).sid;
      const rotated = await refresh(user.refreshToken).expect(200);
      await me(bodyOf(rotated).accessToken).expect(200);

      // Alguien presenta el token viejo (robado, o una respuesta perdida).
      const reuse = await refresh(user.refreshToken).expect(401);
      expect(bodyOf<ErrorBody>(reuse).message).toBe('Invalid refresh token');

      await refresh(bodyOf(rotated).refreshToken).expect(401);
      // El access token de la sesión cae al instante en esta instancia.
      await me(bodyOf(rotated).accessToken).expect(401);

      const reasons: unknown = await ds.query(
        `SELECT DISTINCT revoke_reason FROM havit.refresh_tokens WHERE family_id = $1`,
        [sid],
      );
      expect(reasons).toEqual([{ revoke_reason: 'reuse' }]);
    });

    it('dos refresh simultáneos con el mismo token: uno rota y el otro cuenta como reuso', async () => {
      const user = await signUp();
      const [a, b] = await Promise.all([
        refresh(user.refreshToken),
        refresh(user.refreshToken),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 401]);
      const winner = a.status === 200 ? a : b;
      // Comportamiento estricto (documentado): la familia queda revocada.
      await refresh(bodyOf(winner).refreshToken).expect(401);
    });

    it('rechaza refresh tokens desconocidos o mal formados con el mismo 401', async () => {
      const unknown = await refresh('x'.repeat(43)).expect(401);
      expect(bodyOf<ErrorBody>(unknown).message).toBe('Invalid refresh token');
      await http().post('/auth/refresh').send({}).expect(400);
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: 'a'.repeat(201) })
        .expect(400);
    });
  });

  describe('S3 logout', () => {
    it('una sesión cerrada no se renueva y su access token deja de valer', async () => {
      const user = await signUp();
      await me(user.accessToken).expect(200); // queda en la caché del guard

      await http()
        .post('/auth/logout')
        .send({ refreshToken: user.refreshToken })
        .expect(204);

      await refresh(user.refreshToken).expect(401);
      await me(user.accessToken).expect(401);

      const reasons: unknown = await ds.query(
        `SELECT revoke_reason FROM havit.refresh_tokens WHERE user_id = $1`,
        [user.userId],
      );
      expect(reasons).toEqual([{ revoke_reason: 'logout' }]);
    });

    it('cerrar una sesión no cierra las otras del mismo usuario', async () => {
      const user = await signUp();
      const other = await http()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);

      await http()
        .post('/auth/logout')
        .send({ refreshToken: user.refreshToken })
        .expect(204);

      await me(user.accessToken).expect(401);
      await me(bodyOf(other).accessToken).expect(200);
      await refresh(bodyOf(other).refreshToken).expect(200);
    });

    it('responde 204 aunque no haya nada que revocar (repetido, sin token o desconocido)', async () => {
      const user = await signUp();
      for (const body of [
        { refreshToken: user.refreshToken },
        { refreshToken: user.refreshToken },
        {},
        { refreshToken: 'desconocido' },
      ]) {
        await http().post('/auth/logout').send(body).expect(204);
      }
      // Funciona sin access token (o con uno vencido): es @Public.
      await http()
        .post('/auth/logout')
        .set('Authorization', 'Bearer vencido.o.basura')
        .send({})
        .expect(204);
    });
  });

  describe('S4 transición desde los tokens de 7 días', () => {
    const legacyToken = (user: {
      userId: string;
      email: string;
      username: string;
    }) =>
      app
        .get(JwtService)
        .signAsync(
          { sub: user.userId, email: user.email, username: user.username },
          { secret: process.env.JWT_SECRET as string, expiresIn: '7d' },
        );

    it('un token anterior a B4 (sin sid) sigue valiendo para rutas protegidas', async () => {
      const user = await signUp();
      await me(await legacyToken(user)).expect(200);
    });

    it('pero no da derecho a renovar: no es un refresh token', async () => {
      const user = await signUp();
      // Un JWT es más largo que un refresh token: lo frena la validación (400)
      // antes incluso de buscarlo (401). Lo que importa: nunca 200.
      const res = await refresh(await legacyToken(user));
      expect([400, 401]).toContain(res.status);
      expect(bodyOf<Partial<SessionBody>>(res).accessToken).toBeUndefined();
    });

    it('y caduca como siempre', async () => {
      const user = await signUp();
      const expired = await app.get(JwtService).signAsync(
        {
          sub: user.userId,
          email: user.email,
          username: user.username,
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        { secret: process.env.JWT_SECRET as string },
      );
      await me(expired).expect(401);
    });

    it('un sid inventado (sesión inexistente) no pasa el guard', async () => {
      const user = await signUp();
      const forged = await app.get(JwtService).signAsync(
        {
          sub: user.userId,
          email: user.email,
          username: user.username,
          sid: randomUUID(),
        },
        { secret: process.env.JWT_SECRET as string, expiresIn: 900 },
      );
      await me(forged).expect(401);
    });
  });

  describe('S5 vencimiento, cuentas baneadas y limpieza', () => {
    it('un refresh vencido no renueva y deja de sostener la sesión', async () => {
      const user = await signUp();
      await ds.query(
        `UPDATE havit.refresh_tokens SET expires_at = now() - interval '1 second'
         WHERE user_id = $1`,
        [user.userId],
      );
      await refresh(user.refreshToken).expect(401);
    });

    it('una cuenta baneada no renueva y su sesión queda revocada', async () => {
      const user = await signUp();
      await ds.query(`UPDATE havit.users SET is_active = false WHERE id = $1`, [
        user.userId,
      ]);
      await refresh(user.refreshToken).expect(401);
      const rows: unknown = await ds.query(
        `SELECT revoke_reason FROM havit.refresh_tokens WHERE user_id = $1`,
        [user.userId],
      );
      expect(rows).toEqual([{ revoke_reason: 'account' }]);
    });

    it('la limpieza borra solo lo vencido hace más de un día', async () => {
      const user = await signUp();
      const old = await refreshTokens.issue(user.userId);
      await ds.query(
        `UPDATE havit.refresh_tokens SET expires_at = now() - interval '2 days'
         WHERE token_hash = $1`,
        [sha256(old.refreshToken)],
      );

      const deleted = await refreshTokens.deleteExpired();

      expect(deleted).toBeGreaterThanOrEqual(1);
      const left: unknown = await ds.query(
        `SELECT token_hash FROM havit.refresh_tokens WHERE user_id = $1`,
        [user.userId],
      );
      expect(left).toEqual([{ token_hash: sha256(user.refreshToken) }]);
      await refresh(user.refreshToken).expect(200);
    });
  });

  // Post-auditoría B4-02-F01, por HTTP (controlador + servicio + guard):
  // la rotación se retiene justo después de insertar el sucesor, sin commit.
  describe('S6 logout concurrente con un refresh en curso', () => {
    it('el logout (204) alcanza también al token que la rotación concurrente estaba creando', async () => {
      const user = await signUp();
      const sid = decodeJwt(user.accessToken).sid;

      let release: () => void = () => undefined;
      let reached: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const inserted = new Promise<void>((resolve) => (reached = resolve));
      const original = ds.transaction.bind(ds) as (
        cb: (m: EntityManager) => Promise<unknown>,
      ) => Promise<unknown>;
      const spy = jest.spyOn(ds, 'transaction').mockImplementationOnce(((
        cb: (m: EntityManager) => Promise<unknown>,
      ) =>
        original((manager) =>
          cb(
            new Proxy(manager, {
              get(target, prop, receiver) {
                if (prop === 'query') {
                  return async (sql: string, params?: unknown[]) => {
                    const result: unknown = await target.query(sql, params);
                    if (/^\s*INSERT INTO havit\.refresh_tokens\b/.test(sql)) {
                      reached();
                      await gate;
                    }
                    return result;
                  };
                }
                const value: unknown = Reflect.get(target, prop, receiver);
                return typeof value === 'function'
                  ? ((value as (...a: unknown[]) => unknown).bind(
                      target,
                    ) as unknown)
                  : value;
              },
            }),
          ),
        )) as unknown as typeof ds.transaction);

      try {
        const pendingRefresh = refresh(user.refreshToken).then((r) => r);
        await inserted;
        const pendingLogout = http()
          .post('/auth/logout')
          .send({ refreshToken: user.refreshToken })
          .then((r) => r);
        // Hasta que Postgres muestre el logout esperando el bloqueo de la familia.
        for (let i = 0; i < 200; i += 1) {
          const [{ waiting }]: Array<{ waiting: number }> = await ds.query(
            `SELECT count(*)::int AS waiting FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'`,
          );
          if (waiting > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        release();

        const rotated = await pendingRefresh;
        expect(rotated.status).toBe(200); // la rotación llegó a confirmar...
        expect((await pendingLogout).status).toBe(204);

        // ...pero nada de esa sesión sobrevive al logout.
        await refresh(bodyOf(rotated).refreshToken).expect(401);
        await me(bodyOf(rotated).accessToken).expect(401);
        const families: unknown = await ds.query(
          `SELECT revoke_reason FROM havit.refresh_token_families WHERE id = $1`,
          [sid],
        );
        expect(families).toEqual([{ revoke_reason: 'logout' }]);
      } finally {
        release();
        spy.mockRestore();
      }
    });
  });

  describe('P1 política de contraseñas', () => {
    const tryRegister = (
      password: string,
      username = `b4_${randomUUID().slice(0, 8)}`,
    ) => {
      registrations += 1;
      return http()
        .post('/auth/register')
        .send({
          email: `${username}@example.com`,
          username,
          password,
          acceptTerms: true,
          confirmAge16: true,
        });
    };

    it.each([
      ['password', 'Password must be at least 10 characters'],
      ['12345678', 'Password must be at least 10 characters'],
      ['password123', 'Password is too common'],
      ['P@ssw0rd2024!', 'Password is too common'],
      ['qwertyuiop', 'Password is too common'],
    ])('rechaza %s con un mensaje específico', async (password, message) => {
      const res = await tryRegister(password).expect(400);
      expect(bodyOf<ErrorBody>(res).message).toEqual([message]);
    });

    it('rechaza una contraseña que contiene el username o el email', async () => {
      const username = `zorro${randomUUID().slice(0, 6)}`;
      const res = await tryRegister(`mi-${username}-seguro`, username).expect(
        400,
      );
      expect(bodyOf<ErrorBody>(res).message).toEqual([
        'Password must not contain your username or email',
      ]);
    });

    it('el login sigue aceptando contraseñas antiguas de 8 caracteres', async () => {
      // La política se aplica al FIJAR una contraseña, no al iniciar sesión.
      const user = await signUp();
      const bcrypt = await import('bcrypt');
      await ds.query(
        `UPDATE havit.users SET password_hash = $2 WHERE id = $1`,
        [user.userId, await bcrypt.hash('vieja123', 10)],
      );
      await http()
        .post('/auth/login')
        .send({ email: user.email, password: 'vieja123' })
        .expect(200);
    });
  });

  describe('E1 enumeración de cuentas', () => {
    /** The answer without what legitimately differs per request. */
    const shape = (res: request.Response) => {
      const rest = { ...bodyOf<ErrorBody>(res) };
      delete rest.timestamp;
      delete rest.path;
      return { status: res.status, body: rest };
    };

    it('registro: mismo estado y mensaje con email repetido y con username repetido', async () => {
      const user = await signUp();
      const fresh = randomUUID().slice(0, 8);
      registrations += 2;
      const takenEmail = await http()
        .post('/auth/register')
        .send({
          email: user.email,
          username: `b4_${fresh}`,
          password: PASSWORD,
          acceptTerms: true,
          confirmAge16: true,
        });
      const takenUsername = await http()
        .post('/auth/register')
        .send({
          email: `b4_${fresh}@example.com`,
          username: user.username,
          password: PASSWORD,
          acceptTerms: true,
          confirmAge16: true,
        });

      expect(takenEmail.status).toBe(409);
      expect(shape(takenEmail)).toEqual(shape(takenUsername));
      expect(bodyOf<ErrorBody>(takenEmail).message).toBe(
        'Email or username already in use',
      );
    });

    it('login: email inexistente y contraseña incorrecta dan la misma respuesta en un tiempo parecido', async () => {
      const user = await signUp();
      const timed = async (email: string) => {
        const started = process.hrtime.bigint();
        const res = await http()
          .post('/auth/login')
          .send({ email, password: 'Incorrecta-123' });
        return {
          res,
          ms: Number(process.hrtime.bigint() - started) / 1e6,
        };
      };

      const unknown: number[] = [];
      const wrong: number[] = [];
      let last: { unknown?: request.Response; wrong?: request.Response } = {};
      // POST /auth/login admite 10 por minuto y esta suite hace 9 en total.
      for (let i = 0; i < 2; i += 1) {
        const a = await timed(`nadie_${randomUUID().slice(0, 8)}@example.com`);
        const b = await timed(user.email);
        unknown.push(a.ms);
        wrong.push(b.ms);
        last = { unknown: a.res, wrong: b.res };
      }

      expect(last.unknown!.status).toBe(401);
      expect(shape(last.unknown!)).toEqual(shape(last.wrong!));

      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const ratio = mean(unknown) / mean(wrong);
      // Antes de B4: ~5 ms vs ~66 ms (ratio ~0.08). Ahora ambos pagan un bcrypt.
      console.log(
        `[B4 E1] login (media de 2): email inexistente ${mean(unknown).toFixed(1)} ms, contraseña incorrecta ${mean(wrong).toFixed(1)} ms, ratio ${ratio.toFixed(2)}`,
      );
      expect(ratio).toBeGreaterThan(0.6);
      expect(ratio).toBeLessThan(1.6);
    });

    it('cuenta desactivada: con contraseña incorrecta es igual que cualquier otra; el aviso solo con la correcta', async () => {
      const user = await signUp();
      await ds.query(`UPDATE havit.users SET is_active = false WHERE id = $1`, [
        user.userId,
      ]);
      const wrong = await http()
        .post('/auth/login')
        .send({ email: user.email, password: 'Incorrecta-123' })
        .expect(401);
      expect(bodyOf<ErrorBody>(wrong).message).toBe(
        'Invalid email or password',
      );

      const right = await http()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
      expect(bodyOf<ErrorBody>(right).message).toBe(
        'This account has been deactivated',
      );
    });
  });

  describe('T1 límite propio de /auth/register', () => {
    it('pasados 5 registros por IP en 10 minutos responde 429 (aunque el límite global no se alcance)', async () => {
      // Esta suite ya hizo más de 5 desde la misma IP en esta instancia.
      expect(registrations).toBeGreaterThan(5);
      delete process.env.THROTTLE_REGISTER_LIMIT; // valor real: 5 / 10 min
      const tag = randomUUID().slice(0, 8);
      await http()
        .post('/auth/register')
        .send({
          email: `b4_${tag}@example.com`,
          username: `b4_${tag}`,
          password: PASSWORD,
          acceptTerms: true,
          confirmAge16: true,
        })
        .expect(429);
      // El resto de la API sigue respondiendo con normalidad.
      await http()
        .post('/auth/refresh')
        .send({ refreshToken: 'x' })
        .expect(401);
    });
  });
});
