/**
 * Pruebas de integración y regresión sobre la API real: AppModule completo
 * (guards, ValidationPipe, servicios, TypeORM) contra un Postgres real con
 * todas las migraciones de database/ aplicadas. Sin mocks de la base de datos.
 *
 * Se ejecutan con `npm run test:e2e` y requieren B2_TEST_DB_URL, p. ej.
 *   B2_TEST_DB_URL=postgres://user:pass@localhost:5432/havit_test
 * NUNCA apuntar a una base compartida: inserta filas.
 *
 * Mapa de pruebas (ver docs/ai/testing.md):
 *   I2  registro -> login -> ruta protegida con JWT
 *   I3  unirse a un reto y registrar progreso (3 tablas + post)
 *   R1  un solo progreso por día y por reto (secuencial y concurrente)
 *   R3  ValidationPipe rechaza campos desconocidos
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';

const dbUrl = process.env.B2_TEST_DB_URL;
const describeDb = dbUrl ? describe : describe.skip;

describeDb('API integration & regression (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;

  const http = () => request(app.getHttpServer());

  const registerAndLogin = async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `it_${tag}@example.com`;
    const password = 'password123';
    await http()
      .post('/auth/register')
      .send({
        email,
        password,
        username: `it_${tag}`,
        acceptTerms: true,
        confirmAge16: true,
      })
      .expect(200);
    const login = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const token: string = login.body.accessToken;
    const [{ id }] = await ds.query(
      `SELECT id FROM havit.users WHERE email = $1`,
      [email],
    );
    return { email, password, token, userId: id as string };
  };

  const createChallenge = async (ownerId: string, status = 'open') => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO havit.challenges (id, name, visibility, created_by_user_id, duration_days, status)
       VALUES ($1, 'it challenge', 'public', $2, 30, $3)`,
      [id, ownerId, status],
    );
    return id;
  };

  beforeAll(async () => {
    const u = new URL(dbUrl as string);
    process.env.DB_HOST = u.hostname;
    process.env.DB_PORT = u.port || '5432';
    process.env.DB_USERNAME = decodeURIComponent(u.username);
    process.env.DB_PASSWORD = decodeURIComponent(u.password);
    process.env.DB_DATABASE = u.pathname.slice(1);
    process.env.DB_SSL = 'false';
    process.env.JWT_SECRET ??= 'integration-test-secret';
    // El rate limit global no es lo que se prueba aquí.
    process.env.THROTTLE_LIMIT = '100000';

    const { AppModule } = await import('../src/app.module');
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
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  // I2 — Componentes: AuthController + ValidationPipe + AuthService +
  // JwtAuthGuard (global) + TypeORM/Postgres.
  describe('I2 auth: registro, login y ruta protegida', () => {
    it('registra, hace login y accede con el JWT; sin token responde 401', async () => {
      const { token, email } = await registerAndLogin();

      const me = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(JSON.stringify(me.body)).toContain(email);

      await http().get('/auth/me').expect(401);
      await http()
        .get('/auth/me')
        .set('Authorization', 'Bearer token-invalido')
        .expect(401);
    });

    it('rechaza una contraseña incorrecta y no registra dos veces el mismo email', async () => {
      const { email } = await registerAndLogin();
      await http()
        .post('/auth/login')
        .send({ email, password: 'incorrecta-123' })
        .expect(401);
      await http()
        .post('/auth/register')
        .send({
          email,
          password: 'password123',
          username: `otro_${randomUUID().slice(0, 8)}`,
          acceptTerms: true,
          confirmAge16: true,
        })
        .expect(409);
    });
  });

  // I3 — Componentes: ChallengesController/Service (join) +
  // WorkoutLogController/Service + WorkoutPostsService + Postgres.
  describe('I3 progreso de reto', () => {
    it('unirse a un reto y registrar progreso persiste log y post; un reto cerrado lo rechaza', async () => {
      const user = await registerAndLogin();
      const auth = { Authorization: `Bearer ${user.token}` };
      const challengeId = await createChallenge(user.userId);

      await http().post(`/challenges/${challengeId}/join`).set(auth);

      const res = await http()
        .post('/workout-logs/progress')
        .set(auth)
        .send({
          challengeId,
          imageUrl: 'https://example.com/it.jpg',
          caption: 'día 1',
          visibility: 'public',
        })
        .expect(201);
      expect(res.body).toBeDefined();

      const logs = await ds.query(
        `SELECT id, local_day, status FROM havit.workout_logs
         WHERE user_id = $1 AND challenge_id = $2`,
        [user.userId, challengeId],
      );
      expect(logs).toHaveLength(1);
      expect(logs[0].local_day).not.toBeNull();

      const posts = await ds.query(
        `SELECT image_url FROM havit.workout_posts WHERE workout_log_id = $1`,
        [logs[0].id],
      );
      expect(posts).toHaveLength(1);
      expect(posts[0].image_url).toBe('https://example.com/it.jpg');

      const closedId = await createChallenge(user.userId, 'closed');
      await http()
        .post('/workout-logs/progress')
        .set(auth)
        .send({ challengeId: closedId, imageUrl: 'https://example.com/x.jpg' })
        .expect(400);
    });
  });

  // R1 — Regla de negocio central: un solo progreso por día y por reto.
  // Se apoya en el chequeo del servicio Y en el índice único
  // uq_workout_logs_user_challenge_local_day. Regresión: quitar cualquiera
  // de los dos (la concurrente detecta si falta el índice).
  describe('R1 regresión: un solo progreso por día y por reto', () => {
    const body = (challengeId: string) => ({
      challengeId,
      imageUrl: 'https://example.com/r1.jpg',
      visibility: 'public',
    });

    it('un segundo progreso el mismo día responde 409 y no crea una segunda fila', async () => {
      const user = await registerAndLogin();
      const auth = { Authorization: `Bearer ${user.token}` };
      const challengeId = await createChallenge(user.userId);

      await http()
        .post('/workout-logs/progress')
        .set(auth)
        .send(body(challengeId))
        .expect(201);
      const dup = await http()
        .post('/workout-logs/progress')
        .set(auth)
        .send(body(challengeId))
        .expect(409);
      expect(JSON.stringify(dup.body)).toContain(
        'You already logged progress today',
      );

      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM havit.workout_logs
         WHERE user_id = $1 AND challenge_id = $2`,
        [user.userId, challengeId],
      );
      expect(count).toBe(1);
    });

    it('dos peticiones simultáneas dejan exactamente un registro (201 + 409)', async () => {
      const user = await registerAndLogin();
      const auth = { Authorization: `Bearer ${user.token}` };
      const challengeId = await createChallenge(user.userId);

      const results = await Promise.all(
        [0, 1].map(() =>
          http()
            .post('/workout-logs/progress')
            .set(auth)
            .send(body(challengeId)),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);

      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM havit.workout_logs
         WHERE user_id = $1 AND challenge_id = $2`,
        [user.userId, challengeId],
      );
      expect(count).toBe(1);
    });
  });

  // R3 — ValidationPipe con whitelist + forbidNonWhitelisted. Regresión:
  // quitar forbidNonWhitelisted dejaría pasar campos no declarados.
  describe('R3 regresión: DTOs rechazan campos desconocidos', () => {
    it('POST /auth/register con un campo extra responde 400', async () => {
      const tag = randomUUID().slice(0, 8);
      const res = await http()
        .post('/auth/register')
        .send({
          email: `r3_${tag}@example.com`,
          password: 'password123',
          username: `r3_${tag}`,
          acceptTerms: true,
          confirmAge16: true,
          isAdmin: true,
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('isAdmin');
    });

    it('POST /workout-logs/progress con un campo extra responde 400', async () => {
      const user = await registerAndLogin();
      await http()
        .post('/workout-logs/progress')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          challengeId: randomUUID(),
          imageUrl: 'https://example.com/r3.jpg',
          userId: randomUUID(),
          campoInventado: 1,
        })
        .expect(400);
    });
  });
});
