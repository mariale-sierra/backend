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

  // Igual que registerAndLogin pero sin pasar por POST /auth/login, que tiene
  // su propio límite (10/min) que la suite completa superaría: el registro ya
  // devuelve el token.
  const signUp = async () => {
    const tag = randomUUID().slice(0, 8);
    const email = `it_${tag}@example.com`;
    const res = await http()
      .post('/auth/register')
      .send({
        email,
        password: 'password123',
        username: `it_${tag}`,
        acceptTerms: true,
        confirmAge16: true,
      })
      .expect(200);
    const [{ id }] = await ds.query(
      `SELECT id FROM havit.users WHERE email = $1`,
      [email],
    );
    return { token: res.body.accessToken as string, userId: id as string };
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

  // R4 — GET /challenges/:id devolvía los ejercicios de cada día del ciclo
  // sin ORDER BY routine_exercises.order_index, en un orden arbitrario
  // distinto al de la rutina (p. ej. [10, 9, 11] para una rutina [9, 11, 10]).
  describe('R4 regresión: el detalle del reto respeta el orden de la rutina', () => {
    it('cycle_days[].exercises sale ordenado por order_index y es determinístico', async () => {
      const user = await signUp();
      const challengeId = await createChallenge(user.userId);
      const [{ id: routineId }] = await ds.query(
        `INSERT INTO havit.routines (created_by_user_id, name)
         VALUES ($1, 'r4 routine') RETURNING id`,
        [user.userId],
      );
      // Insertados en un orden distinto a order_index, cada uno con sets.
      const rows: Array<[number, number]> = [
        [10, 3],
        [9, 1],
        [12, 4],
        [11, 2],
      ];
      for (const [exerciseId, orderIndex] of rows) {
        const [{ id: reId }] = await ds.query(
          `INSERT INTO havit.routine_exercises (routine_id, exercise_id, order_index)
           VALUES ($1, $2, $3) RETURNING id`,
          [routineId, exerciseId, orderIndex],
        );
        for (const setNumber of [2, 1]) {
          await ds.query(
            `INSERT INTO havit.routine_exercise_sets (routine_exercise_id, set_number)
             VALUES ($1, $2)`,
            [reId, setNumber],
          );
        }
      }
      await ds.query(
        `INSERT INTO havit.challenge_cycle_days (challenge_id, day_in_cycle, routine_id, day_type)
         VALUES ($1, 1, $2, 'workout')`,
        [challengeId, routineId],
      );

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await http().get(`/challenges/${challengeId}`).expect(200);
        const [day] = res.body.cycle_days;
        expect(
          day.exercises.map((e: { exercise_id: number }) => e.exercise_id),
        ).toEqual([9, 11, 10, 12]);
        for (const exercise of day.exercises) {
          expect(
            exercise.sets.map((s: { set_number: number }) => s.set_number),
          ).toEqual([1, 2]);
        }
      }
    });
  });

  // R5 — Quien abandonaba un reto (status 'left') recibía para siempre
  // "Already joined this challenge": la fila se conserva como historial y la
  // PK (challenge_id, user_id) impide otra. El reingreso reactiva esa fila.
  describe('R5 regresión: volver a unirse tras abandonar', () => {
    const membership = (challengeId: string, userId: string) =>
      ds.query(
        `SELECT status FROM havit.challenge_user_map
         WHERE challenge_id = $1 AND user_id = $2`,
        [challengeId, userId],
      );

    it('join, join duplicado, leave y rejoin dejan una sola membresía activa', async () => {
      const owner = await signUp();
      const user = await signUp();
      const auth = { Authorization: `Bearer ${user.token}` };
      const challengeId = await createChallenge(owner.userId);

      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(201);
      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(400);
      await http()
        .patch(`/challenges/${challengeId}/leave`)
        .set(auth)
        .expect(200);
      expect(await membership(challengeId, user.userId)).toEqual([
        { status: 'left' },
      ]);

      const rejoin = await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(201);
      expect(rejoin.body.status).toBe('joined');
      expect(await membership(challengeId, user.userId)).toEqual([
        { status: 'active' },
      ]);
      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(400);
    });

    it('un reto cerrado no admite el reingreso', async () => {
      const owner = await signUp();
      const user = await signUp();
      const auth = { Authorization: `Bearer ${user.token}` };
      const challengeId = await createChallenge(owner.userId);

      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(201);
      await http()
        .patch(`/challenges/${challengeId}/leave`)
        .set(auth)
        .expect(200);
      await ds.query(
        `UPDATE havit.challenges SET status = 'closed' WHERE id = $1`,
        [challengeId],
      );

      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(400);
      expect(await membership(challengeId, user.userId)).toEqual([
        { status: 'left' },
      ]);
    });

    it('en un reto privado el reingreso vuelve a pasar por solicitud y aprobación', async () => {
      const owner = await signUp();
      const user = await signUp();
      const auth = { Authorization: `Bearer ${user.token}` };
      const ownerAuth = { Authorization: `Bearer ${owner.token}` };
      const challengeId = randomUUID();
      await ds.query(
        `INSERT INTO havit.challenges (id, name, visibility, created_by_user_id, duration_days, status)
         VALUES ($1, 'it private', 'private', $2, 30, 'open')`,
        [challengeId, owner.userId],
      );
      const approveOnly = async () => {
        const pending = await http()
          .get(`/challenges/${challengeId}/join-requests`)
          .set(ownerAuth)
          .expect(200);
        expect(pending.body).toHaveLength(1);
        await http()
          .post(
            `/challenges/${challengeId}/join-requests/${pending.body[0].id}/approve`,
          )
          .set(ownerAuth)
          .expect(201);
      };

      const first = await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(201);
      expect(first.body.status).toBe('requested');
      await approveOnly();
      await http()
        .patch(`/challenges/${challengeId}/leave`)
        .set(auth)
        .expect(200);

      const again = await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(201);
      expect(again.body.status).toBe('requested');
      expect(await membership(challengeId, user.userId)).toEqual([
        { status: 'left' },
      ]);

      await approveOnly();
      expect(await membership(challengeId, user.userId)).toEqual([
        { status: 'active' },
      ]);
    });

    it('un usuario baneado no puede volver a unirse', async () => {
      const owner = await signUp();
      const user = await signUp();
      const auth = { Authorization: `Bearer ${user.token}` };
      const challengeId = await createChallenge(owner.userId);
      // Membresía abandonada sembrada por SQL: el JwtAuthGuard reutiliza
      // durante 30 s (SESSION_CHECK_TTL_MS) un "cuenta usable" ya visto, así
      // que el baneo se prueba sin peticiones autenticadas previas.
      await ds.query(
        `INSERT INTO havit.challenge_user_map (challenge_id, user_id, role, status)
         VALUES ($1, $2, 'participant', 'left')`,
        [challengeId, user.userId],
      );
      await ds.query(`UPDATE havit.users SET is_active = false WHERE id = $1`, [
        user.userId,
      ]);

      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(auth)
        .expect(401);
      expect(await membership(challengeId, user.userId)).toEqual([
        { status: 'left' },
      ]);
    });
  });

  // R6 — B8: cerrar y reactivar son acciones de administrador de la
  // plataforma (AdminGuard), no del dueño del reto. Reactivar es el inverso
  // exacto de cerrar: solo cambia status y no toca membresías ni historial.
  describe('R6 regresión: cerrar y reactivar un reto (solo admin)', () => {
    const makeAdmin = (userId: string) =>
      ds.query(`UPDATE havit.users SET is_admin = true WHERE id = $1`, [
        userId,
      ]);

    it('cada rol recibe la respuesta esperada al reactivar', async () => {
      const owner = await signUp();
      const participant = await signUp();
      const admin = await signUp();
      await makeAdmin(admin.userId);
      const as = (u: { token: string }) => ({
        Authorization: `Bearer ${u.token}`,
      });
      const challengeId = await createChallenge(owner.userId, 'closed');
      const reopen = () => http().patch(`/challenges/${challengeId}/reopen`);

      await reopen().expect(401);
      await reopen().set(as(participant)).expect(403);
      await reopen().set(as(owner)).expect(403);
      await http()
        .patch(`/challenges/${randomUUID()}/reopen`)
        .set(as(admin))
        .expect(404);
      await reopen().set(as(admin)).expect(200);
      await reopen().set(as(admin)).expect(400);

      // Un dueño que además es admin actúa como admin.
      await makeAdmin(owner.userId);
      await http()
        .patch(`/challenges/${challengeId}/close`)
        .set(as(owner))
        .expect(200);
      await reopen().set(as(owner)).expect(200);
    });

    it('reactivar conserva miembros e historial y vuelve a aceptar ingresos y progreso', async () => {
      const owner = await signUp();
      const member = await signUp();
      const newcomer = await signUp();
      const admin = await signUp();
      await makeAdmin(admin.userId);
      const challengeId = await createChallenge(owner.userId);
      const memberAuth = { Authorization: `Bearer ${member.token}` };
      const newcomerAuth = { Authorization: `Bearer ${newcomer.token}` };
      const adminAuth = { Authorization: `Bearer ${admin.token}` };

      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(memberAuth)
        .expect(201);
      await http()
        .post('/workout-logs/progress')
        .set(memberAuth)
        .send({ challengeId, isRestDay: true })
        .expect(201);
      const snapshot = () =>
        ds.query(
          `SELECT
             (SELECT json_agg(json_build_object('u', user_id, 's', status, 'j', joined_at) ORDER BY user_id)
                FROM havit.challenge_user_map WHERE challenge_id = $1) AS members,
             (SELECT json_agg(id ORDER BY id)
                FROM havit.workout_logs WHERE challenge_id = $1) AS logs`,
          [challengeId],
        );
      const before = await snapshot();

      await http()
        .patch(`/challenges/${challengeId}/close`)
        .set(adminAuth)
        .expect(200);
      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(newcomerAuth)
        .expect(400);
      await http()
        .patch(`/challenges/${challengeId}/reopen`)
        .set(adminAuth)
        .expect(200);

      expect(await snapshot()).toEqual(before);
      const detail = await http().get(`/challenges/${challengeId}`).expect(200);
      expect(detail.body.status).toBe('open');
      await http()
        .post(`/challenges/${challengeId}/join`)
        .set(newcomerAuth)
        .expect(201);
      // B5 intacto: el progreso de hoy ya existe, así que sigue siendo 409.
      await http()
        .post('/workout-logs/progress')
        .set(memberAuth)
        .send({ challengeId, isRestDay: true })
        .expect(409);
    });

    // "Nadie podrá unirse una vez cerrado" — aprobar una solicitud es unir a
    // alguien, así que el dueño no puede hacerlo con el reto cerrado; sí
    // puede rechazarla. Al reactivar, la misma solicitud se aprueba.
    it('un reto cerrado no admite aprobar solicitudes de ingreso, solo rechazarlas', async () => {
      const owner = await signUp();
      const first = await signUp();
      const second = await signUp();
      const admin = await signUp();
      await makeAdmin(admin.userId);
      const ownerAuth = { Authorization: `Bearer ${owner.token}` };
      const adminAuth = { Authorization: `Bearer ${admin.token}` };
      const challengeId = randomUUID();
      await ds.query(
        `INSERT INTO havit.challenges (id, name, visibility, created_by_user_id, duration_days, status)
         VALUES ($1, 'it private', 'private', $2, 30, 'open')`,
        [challengeId, owner.userId],
      );
      for (const user of [first, second]) {
        await http()
          .post(`/challenges/${challengeId}/join`)
          .set({ Authorization: `Bearer ${user.token}` })
          .expect(201);
      }
      const pending = await http()
        .get(`/challenges/${challengeId}/join-requests`)
        .set(ownerAuth)
        .expect(200);
      const requestOf = (userId: string) =>
        pending.body.find((r: { user: { id: string } }) => r.user.id === userId)
          .id as string;
      const respond = (userId: string, action: 'approve' | 'reject') =>
        http()
          .post(
            `/challenges/${challengeId}/join-requests/${requestOf(userId)}/${action}`,
          )
          .set(ownerAuth);
      const members = () =>
        ds.query(
          `SELECT user_id FROM havit.challenge_user_map WHERE challenge_id = $1`,
          [challengeId],
        );

      await http()
        .patch(`/challenges/${challengeId}/close`)
        .set(adminAuth)
        .expect(200);
      await respond(first.userId, 'approve').expect(400);
      expect(await members()).toEqual([]);
      await respond(second.userId, 'reject').expect(201);

      await http()
        .patch(`/challenges/${challengeId}/reopen`)
        .set(adminAuth)
        .expect(200);
      await respond(first.userId, 'approve').expect(201);
      expect(await members()).toEqual([{ user_id: first.userId }]);
    });
  });
});
