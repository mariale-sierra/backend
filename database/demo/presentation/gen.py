"""Builds the presentation demo: seed.sql, cleanup.sql and uploads.tsv.

Everything is relative to the day the SQL runs (Guatemala time), so re-running
cleanup + seed right before the presentation leaves streaks and "today" fresh.
"""
import json, random, uuid
from personas import P, COVERS

R2 = "https://pub-de349790ed0a4cd6893a1c0fb3304621.r2.dev"
NS = uuid.UUID("6a1f3c2e-5d4b-4e8a-9c1d-2b7f0e9a8d11")
PW = "$2b$10$MQcvXyKc8XOYxNu2aqCuMOko3c6pjsTMc/YksCn5ARV.VbKTuQjj2"  # bcrypt of HavitDemo2026!
rnd = random.Random(2026)

def uid(*k): return str(uuid.uuid5(NS, ":".join(k)))
def q(s): return "NULL" if s is None else "'" + str(s).replace("'", "''") + "'"

# ---------------------------------------------------------------- people
PEOPLE = {
 "andres":   ("andres.castillo",  "Andrés Castillo",  "Ingeniero de día, atleta amateur de noche. Fuerza + running 🏋️‍♂️🏃"),
 "diego":    ("diego.herrera",    "Diego Herrera",    "Coach de fuerza. Técnica primero, peso después 💪"),
 "valeria":  ("vale.mendez",      "Valeria Méndez",   "Glúteos, constancia y buena música 🍑🎧"),
 "sofia":    ("sofi.runs",        "Sofía Paredes",    "Corredora de 10K camino a mi primer medio maratón 🏃‍♀️"),
 "ana":      ("ana.rivas.yoga",   "Ana Lucía Rivas",  "Instructora de yoga. Respira, muévete, repite 🧘‍♀️"),
 "lucia":    ("lu.gomez",         "Lucía Gómez",      "Mamá de dos. Entreno en casa en 30 minutos ✨"),
 "marco":    ("marco.calistenia", "Marco Pérez",      "Calistenia en el parque. Meta: mi primer muscle-up 🤸"),
 "fernanda": ("fer.fit",          "Fernanda Ruiz",    "Gym rat en proceso 😅 Fuerza + cardio"),
}
U = {k: uid("user", k) for k in PEOPLE}
uploads = []  # (local file, r2 key)
def upload(user, local):
    key = f"uploads/{U[user]}/{uid('img', local)}.jpeg"
    uploads.append((local, key)); return f"{R2}/{key}"

# ---------------------------------------------------------------- routines
# kind: ("sets", n, reps) | ("time", seconds) | ("run", seconds, km)
RT = {
 "push":   ("Empuje", "diego", [(3, ("sets", 4, 8)), (261, ("sets", 3, 10)), (47, ("sets", 3, 12)), (453, ("time", 60))]),
 "pull":   ("Tirón", "diego", [(5, ("sets", 4, 5)), (8, ("sets", 4, 8)), (7, ("sets", 3, 12)), (466, ("sets", 3, 6))]),
 "legs":   ("Pierna", "diego", [(4, ("sets", 4, 6)), (9, ("sets", 3, 12)), (493, ("sets", 3, 10)), (625, ("sets", 3, 12))]),
 "gluteA": ("Glúteo A · hip thrust", "valeria", [(14, ("sets", 4, 10)), (133, ("sets", 3, 10)), (144, ("sets", 3, 15)), (295, ("sets", 3, 15))]),
 "gluteB": ("Glúteo B · bisagra", "valeria", [(493, ("sets", 4, 10)), (299, ("sets", 3, 12)), (196, ("sets", 3, 12)), (69, ("sets", 3, 20))]),
 "easy":   ("Carrera suave", "sofia", [(1, ("run", 1800, 5)), (572, ("time", 60))]),
 "inter":  ("Intervalos", "sofia", [(319, ("time", 120)), (1, ("run", 1500, 4)), (339, ("time", 300))]),
 "long":   ("Fondo largo", "sofia", [(1, ("run", 3600, 10)), (575, ("time", 120))]),
 "flowA":  ("Saludo al sol", "ana", [(405, ("time", 60)), (239, ("time", 120)), (153, ("time", 120)), (603, ("time", 120)), (498, ("time", 300))]),
 "flowB":  ("Caderas y espalda", "ana", [(162, ("time", 120)), (440, ("time", 180)), (294, ("time", 120)), (590, ("time", 120)), (498, ("time", 300))]),
 "calE":   ("Empuje en barras", "marco", [(470, ("sets", 4, 15)), (108, ("sets", 3, 12)), (453, ("time", 60))]),
 "calT":   ("Tirón y core", "marco", [(466, ("sets", 4, 6)), (164, ("sets", 3, 6)), (310, ("sets", 3, 10))]),
 "coreA":  ("Core 20'", "lucia", [(453, ("time", 60)), (207, ("sets", 3, 12)), (520, ("time", 45)), (120, ("sets", 3, 20))]),
 "coreB":  ("Core + cardio", "lucia", [(404, ("time", 60)), (134, ("sets", 3, 10)), (42, ("sets", 3, 10)), (538, ("sets", 3, 20))]),
 "full":   ("Full body", "andres", [(4, ("sets", 3, 8)), (3, ("sets", 3, 8)), (8, ("sets", 3, 10)), (453, ("time", 60))]),
}

# ---------------------------------------------------------------- challenges
# cycle: list of routine keys, None = rest day
CH = {
 "fuerza":     dict(owner="diego", name="Fuerza 12 semanas 🏋️", desc="Empuje, tirón y pierna con progresión semanal. Registra tus pesos y sube tu foto del día. #fuerza #gym",
                    dur=84, cycle=["push", "pull", "legs", None], cats=[2], locs=[3], cover="c-fuerza",
                    members={"diego": 26, "andres": 21, "marco": 16, "fernanda": 6}),
 "gluteos":    dict(owner="valeria", name="Glúteos de acero 🍑", desc="6 semanas enfocadas en glúteo: hip thrust, bisagra y mucho trabajo unilateral. #gluteos",
                    dur=42, cycle=["gluteA", "gluteB", None], cats=[2], locs=[3], cover="c-gluteos",
                    members={"valeria": 22, "fernanda": 18, "lucia": 9}),
 "running":    dict(owner="sofia", name="30 días corriendo 🏃‍♀️", desc="Cinco salidas por semana: suaves, intervalos y un fondo largo el sábado. #running",
                    dur=30, cycle=["easy", "inter", None, "easy", "easy", "long", None], cats=[4], locs=[6], cover="c-running",
                    members={"sofia": 19, "andres": 14, "fernanda": 12, "diego": 7}),
 "yoga":       dict(owner="ana", name="Yoga al amanecer 🧘‍♀️", desc="21 días de práctica corta antes del trabajo. Solo necesitas un mat. #yoga #movilidad",
                    dur=21, cycle=["flowA", "flowB"], cats=[1, 3], locs=[5], cover="c-yoga",
                    members={"ana": 13, "lucia": 11, "valeria": 8}),
 "calistenia": dict(owner="marco", name="Calistenia desde cero 🤸", desc="Dominadas, fondos y flexiones con progresión. Sin gym, solo barras. #calistenia",
                    dur=56, cycle=["calE", "calT", None], cats=[2, 5], locs=[6], cover="c-calistenia",
                    members={"marco": 17, "andres": 12}),
 "core":       dict(owner="lucia", name="Core en casa · 28 días ✨", desc="20 minutos al día desde la sala. Abdomen fuerte, espalda feliz. #core #encasa",
                    dur=28, cycle=["coreA", "coreB"], cats=[5], locs=[5], cover="c-core",
                    members={"lucia": 15, "ana": 9, "fernanda": 5}),
 "10k":        dict(owner="sofia", name="Reto 10K de noviembre", desc="Preparemos juntos la carrera de fin de mes. ¡Únete! #running #10k",
                    dur=28, cycle=["easy", "inter", None, "easy", None, "long", None], cats=[4], locs=[6], cover="c-10k",
                    members={"sofia": 1, "fernanda": 0}),
 "octubre":    dict(owner="andres", name="Octubre activo", desc="Dos semanas de full body para arrancar el mes. #fuerza",
                    dur=14, cycle=["full", "full"], cats=[2], locs=[3], cover="c-octubre",
                    members={"andres": 35, "diego": 34}),
}
C = {k: uid("challenge", k) for k in CH}

# photo -> challenge, per person (newest log of that challenge gets the first photo)
PHOTO_CH = {
 "andres":  ["fuerza", "fuerza", "running", "fuerza", "calistenia", "fuerza", "running", "octubre"],
 "diego":   ["fuerza"] * 11 + ["octubre"],
 "valeria": ["gluteos"] * 11,
 "sofia":   ["10k", "running", "running", "running", "10k", "running", "running", "running", "running", "running"],
 "ana":     ["yoga"] * 10,
 "lucia":   ["core", "core", "core", "gluteos", "core", "core", "gluteos", "gluteos", "yoga", "core", "core"],
 "marco":   ["calistenia"] * 4,
 "fernanda": ["running", "gluteos", "gluteos", "gluteos", "running", "gluteos", "gluteos", "gluteos", "gluteos", "gluteos", "gluteos", "gluteos"],
}
CAPTIONS = {
 "fuerza": ["Día de empuje ✅ press banca subiendo poco a poco #fuerza", "Peso muerto con buena técnica, eso es lo que cuenta #fuerza #gym",
            "Pierna. No hay más que decir 🦵 #legday", "Semana 3 y ya se nota la diferencia #fuerza", "Tirón completo, espalda reventada 😮‍💨 #gym",
            "Nuevo PR en sentadilla 🔥 #fuerza", "Entreno temprano, día ganado #gym", "Constancia > motivación #fuerza", "Sin excusas hoy tampoco 💪 #gym",
            "Remo con barra, técnica limpia #fuerza", "La sesión más dura de la semana #legday", "Calentando antes de la serie pesada #gym"],
 "gluteos": ["Hip thrust día 🍑 #gluteos", "Búlgaras... las odio y las amo #gluteos", "Bisagra de cadera con calma, conexión mente-músculo #gluteos",
             "Banda + patada de glúteo, quemazón total 🔥 #gluteos", "Semana 2 cumplida ✨ #gluteos #constancia", "Hoy tocó glúteo B #gluteos",
             "Poco a poco subiendo peso en el hip thrust #gluteos", "Día cumplido, a descansar #gluteos", "Me encanta este reto #gluteos #gym"],
 "running": ["5K suaves para empezar la semana #running", "Intervalos hechos 🥵 #running", "Fondo largo del sábado: 10K ✅ #running",
             "Salir a correr temprano no tiene precio 🌅 #running", "Ritmo cómodo, piernas ligeras #running", "Cada kilómetro cuenta #running",
             "Hoy costó, pero salí igual #running #constancia", "Nuevo mejor tiempo en 5K 🙌 #running"],
 "10k": ["Arrancamos el reto 10K 🏁 #running #10k", "Día 2 del 10K, ¿quién más se une? #10k"],
 "yoga": ["Saludo al sol para empezar el día 🌅 #yoga", "Respirar y soltar #yoga #movilidad", "Caderas abiertas, espalda feliz #yoga",
          "Práctica corta pero constante #yoga", "Silencio y mat #yoga", "Día cumplido en el reto 🧘‍♀️ #yoga #movilidad", "La práctica de hoy fue frente al mar 🌊 #yoga"],
 "calistenia": ["Barras del parque, mi gimnasio favorito #calistenia", "Dominadas: 6 limpias por serie 💪 #calistenia",
                "Fondos y flexiones, día de empuje #calistenia", "Paso a paso hacia el muscle-up #calistenia"],
 "core": ["Core de 20 minutos desde la sala ✨ #core #encasa", "Plancha 1 minuto sin morir 😅 #core", "Rueda abdominal, nivel desbloqueado #core",
          "Entreno mientras los niños duermen #encasa", "Día cumplido #core #constancia"],
 "octubre": ["Último día de Octubre activo ✅ #fuerza", "Full body terminado #fuerza"],
}
COMMENTS = ["¡Qué nivel! 🔥", "Vamos con todo 💪", "Me motivas a entrenar hoy", "¡Eso! Constancia pura", "Qué buena foto 😍", "¿Cuánto peso fue?",
            "Se ve increíble", "Mañana me uno", "👏👏👏", "Brutal", "Ese es el espíritu 🙌", "Te está quedando muy bien la técnica", "¡A seguir así!"]
TIMES = {"andres": "06:10", "diego": "06:30", "valeria": "17:30", "sofia": "05:45", "ana": "06:00", "lucia": "13:00", "marco": "16:30", "fernanda": "17:00"}

out = []
w = out.append
w("-- Havit presentation demo. Generated; run inside one transaction.")
w("SET search_path = havit, public;")
w("CREATE OR REPLACE FUNCTION pg_temp.demo_today() RETURNS date LANGUAGE sql AS $$ SELECT (now() AT TIME ZONE 'America/Guatemala')::date $$;")
w("CREATE OR REPLACE FUNCTION pg_temp.demo_ts(days_ago int, hhmm text) RETURNS timestamp LANGUAGE sql AS $$ SELECT ((pg_temp.demo_today() - days_ago) + hhmm::time) AT TIME ZONE 'America/Guatemala' AT TIME ZONE 'UTC' $$;")
w("CREATE TEMP TABLE demo_ids (k text PRIMARY KEY, id bigint NOT NULL) ON COMMIT DROP;")
def TS(d, t):
    if d > 0: return f"pg_temp.demo_ts({d}, '{t}')"
    # today: always in the past relative to when the seed runs, same order as the clock times
    h, m = map(int, t.split(":")); ago = max(3, (24 * 60 - (h * 60 + m)) // 8)
    return f"((now() AT TIME ZONE 'UTC') - interval '{ago} minutes')"

# users + profiles
for k, (un, name, bio) in PEOPLE.items():
    w(f"INSERT INTO users (id, username, email, password_hash, is_active, terms_accepted_at, terms_version, age_confirmed_at) VALUES "
      f"('{U[k]}', {q(un)}, {q(un + '@havit.dev')}, {q(PW)}, true, {TS(40, '12:00')}, '2026-10-v1', {TS(40, '12:00')});")
    w(f"INSERT INTO user_profiles (user_id, display_name, bio, preferred_language, profile_image_url, is_private, practice_preferences) VALUES "
      f"('{U[k]}', {q(name)}, {q(bio)}, 'es', {q(upload(k, f'avatar-{k}.jpg'))}, false, '{{}}');")

# follows: everybody <-> andres, plus most cross-follows
pairs = set()
for a in PEOPLE:
    for b in PEOPLE:
        if a != b and (a == "andres" or b == "andres" or rnd.random() < 0.65): pairs.add((a, b))
for a, b in sorted(pairs):
    w(f"INSERT INTO user_follows (follower_user_id, followed_user_id, created_at) VALUES ('{U[a]}', '{U[b]}', {TS(rnd.randint(20, 38), '20:00')});")

# routines
for rk, (rname, owner, exs) in RT.items():
    w(f"WITH x AS (INSERT INTO routines (created_by_user_id, name, description, is_active) VALUES ('{U[owner]}', {q(rname)}, '', true) RETURNING id) INSERT INTO demo_ids SELECT 'r:{rk}', id FROM x;")
    for i, (ex, kind) in enumerate(exs, 1):
        w(f"WITH x AS (INSERT INTO routine_exercises (routine_id, exercise_id, order_index) VALUES ((SELECT id FROM demo_ids WHERE k='r:{rk}'), {ex}, {i}) RETURNING id) INSERT INTO demo_ids SELECT 're:{rk}:{i}', id FROM x;")
        re = f"(SELECT id FROM demo_ids WHERE k='re:{rk}:{i}')"
        if kind[0] == "sets":
            for s in range(1, kind[1] + 1):
                w(f"WITH x AS (INSERT INTO routine_exercise_sets (routine_exercise_id, set_number, rest_seconds_after) VALUES ({re}, {s}, 90) RETURNING id) "
                  f"INSERT INTO routine_exercise_set_targets (routine_exercise_set_id, metric_type_id, target_value_int) SELECT id, 3, {kind[2]} FROM x;")
        elif kind[0] == "time":
            w(f"INSERT INTO routine_exercise_targets (routine_exercise_id, metric_type_id, target_value_seconds) VALUES ({re}, 5, {kind[1]});")
        else:
            w(f"INSERT INTO routine_exercise_targets (routine_exercise_id, metric_type_id, target_value_seconds) VALUES ({re}, 5, {kind[1]});")
            w(f"INSERT INTO routine_exercise_targets (routine_exercise_id, metric_type_id, target_value_decimal, unit) VALUES ({re}, 6, {kind[2]}, 'km');")

# challenges
for ck, c in CH.items():
    start = max(c["members"].values())
    w(f"INSERT INTO challenges (id, created_by_user_id, name, description, visibility, duration_days, cycle_length_days, status, created_at, is_active, image_url, image_moderation_status) VALUES "
      f"('{C[ck]}', '{U[c['owner']]}', {q(c['name'])}, {q(c['desc'])}, 'public', {c['dur']}, {len(c['cycle'])}, 'open', {TS(start, '07:00')} AT TIME ZONE 'UTC', true, "
      f"{q(upload(c['owner'], c['cover'] + '.jpg'))}, 'approved');")
    for i, cat in enumerate(c["cats"]):
        w(f"INSERT INTO challenge_category_map (challenge_id, category_id, order_index) VALUES ('{C[ck]}', {cat}, {i});")
    for loc in c["locs"]:
        w(f"INSERT INTO challenge_location_map (challenge_id, location_id) VALUES ('{C[ck]}', {loc});")
    for d, rk in enumerate(c["cycle"], 1):
        rid = f"(SELECT id FROM demo_ids WHERE k='r:{rk}')" if rk else "NULL"
        w(f"WITH x AS (INSERT INTO challenge_cycle_days (challenge_id, day_in_cycle, routine_id, day_type) VALUES ('{C[ck]}', {d}, {rid}, '{'workout' if rk else 'rest'}') RETURNING id) INSERT INTO demo_ids SELECT 'cd:{ck}:{d}', id FROM x;")
    for m, ago in c["members"].items():
        done = ago - 1 >= c["dur"] - 1  # whole duration already behind
        w(f"INSERT INTO challenge_user_map (challenge_id, user_id, role, joined_at, status) VALUES ('{C[ck]}', '{U[m]}', '{'owner' if m == c['owner'] else 'participant'}', {TS(ago, '07:00')}, '{'completed' if done else 'active'}');")

# workout logs (+ exercises from the routine) and the posts on top of them
logs = {}  # (person, challenge) -> [days_ago...] newest first
for ck, c in CH.items():
    for m, ago in c["members"].items():
        days = []
        for d in range(ago, -1, -1):
            pos = (ago - d) % len(c["cycle"])
            if (ago - d) >= c["dur"]: continue
            rk = c["cycle"][pos]
            if rk is None: continue
            if m == "andres" and d == 0: continue          # leaves today for the live demo
            if m != "andres" and ck != "10k" and d > 0 and rnd.random() < 0.12: continue  # nobody is perfect
            if m != "andres" and ck != "10k" and d == 0 and rnd.random() < 0.4: continue
            days.append((d, pos + 1, rk))
        logs[(m, ck)] = sorted(days)
        for d, cday, rk in days:
            t = TS(d, TIMES[m]); end = f"({t} + interval '{rnd.randint(35, 70)} minutes')"
            w(f"WITH x AS (INSERT INTO workout_logs (user_id, routine_id, challenge_id, challenge_cycle_day_id, started_at, ended_at, status, notes, local_day, location_id) VALUES "
              f"('{U[m]}', (SELECT id FROM demo_ids WHERE k='r:{rk}'), '{C[ck]}', (SELECT id FROM demo_ids WHERE k='cd:{ck}:{cday}'), {t}, {end}, 'completed', NULL, pg_temp.demo_today() - {d}, {c['locs'][0]}) RETURNING id) "
              f"INSERT INTO demo_ids SELECT 'log:{m}:{ck}:{d}', id FROM x;")
w("INSERT INTO workout_log_exercises (workout_log_id, exercise_id, routine_exercise_id, order_index) "
  "SELECT l.id, re.exercise_id, re.id, re.order_index FROM demo_ids i JOIN workout_logs l ON l.id = i.id JOIN routine_exercises re ON re.routine_id = l.routine_id WHERE i.k LIKE 'log:%';")

posts = []  # (post id, author, days_ago)
for m, chs in PHOTO_CH.items():
    taken = {}
    for i, ck in enumerate(chs):
        avail = logs.get((m, ck), [])
        n = taken.get(ck, 0); taken[ck] = n + 1
        if n >= len(avail): raise SystemExit(f"not enough logs for {m}/{ck}")
        d = avail[n][0]
        pid = uid("post", m, str(i))
        cap = CAPTIONS[ck][(i * 7 + len(m)) % len(CAPTIONS[ck])]
        w(f"INSERT INTO workout_posts (id, workout_log_id, user_id, image_url, caption, visibility, created_at, is_active, moderation_status, moderated_at, is_hidden) VALUES "
          f"('{pid}', (SELECT id FROM demo_ids WHERE k='log:{m}:{ck}:{d}'), '{U[m]}', {q(upload(m, f'post-{m}-{i:02d}.jpg'))}, {q(cap)}, 'followers', "
          f"(SELECT ended_at FROM workout_logs WHERE id=(SELECT id FROM demo_ids WHERE k='log:{m}:{ck}:{d}')), true, 'approved', now(), false);")
        posts.append((pid, m, d))

# likes + comments from people who follow the author
followers = {b: [a for a, bb in pairs if bb == b] for b in PEOPLE}
for pid, m, d in posts:
    fans = followers[m][:]; rnd.shuffle(fans)
    for f in fans[: rnd.randint(2, len(fans))]:
        w(f"INSERT INTO workout_post_likes (workout_post_id, user_id, created_at) VALUES ('{pid}', '{U[f]}', (SELECT created_at FROM workout_posts WHERE id='{pid}') + interval '{rnd.randint(5, 600)} minutes');")
    for f in fans[: rnd.choice([0, 0, 1, 1, 2, 3])]:
        w(f"INSERT INTO workout_post_comments (workout_post_id, user_id, comment_text, created_at) VALUES ('{pid}', '{U[f]}', {q(rnd.choice(COMMENTS))}, (SELECT created_at FROM workout_posts WHERE id='{pid}') + interval '{rnd.randint(10, 900)} minutes');")
w("INSERT INTO hashtags (tag) SELECT DISTINCT lower(r.m[2]) FROM workout_posts p CROSS JOIN LATERAL regexp_matches(p.caption, '(^|[^[:alnum:]_&#])#([[:alnum:]_]+)', 'g') AS r(m) "
  f"WHERE p.user_id IN ({', '.join(q(v) for v in U.values())}) ON CONFLICT (tag) DO NOTHING;")
w("INSERT INTO workout_post_hashtags (workout_post_id, hashtag_id) SELECT DISTINCT p.id, h.id FROM workout_posts p CROSS JOIN LATERAL regexp_matches(p.caption, '(^|[^[:alnum:]_&#])#([[:alnum:]_]+)', 'g') AS r(m) "
  f"JOIN hashtags h ON h.tag = lower(r.m[2]) WHERE p.user_id IN ({', '.join(q(v) for v in U.values())}) ON CONFLICT DO NOTHING;")

# spaces
SP = {
 "runners": ("Runners GT 🏃‍♀️", "Salidas en grupo, rutas y carreras en Guate. Todos los ritmos son bienvenidos.", "sofia", 4, "s-runners",
             ["andres", "fernanda", "diego", "marco"], [
    ("sofia", 6, "08:00", "¡Bienvenidos al grupo! Aquí coordinamos las salidas de la semana 🙌"),
    ("fernanda", 6, "08:20", "¡Gracias por la invitación! Yo me apunto a las del sábado"),
    ("diego", 5, "19:10", "¿Alguien sabe si la ruta de Cayalá está abierta temprano?"),
    ("sofia", 5, "19:25", "Sí, desde las 5:30. Es la mejor hora, casi no hay gente"),
    ("andres", 3, "21:00", "Ayer hice 5K en 27 minutos, mi mejor tiempo 🔥"),
    ("sofia", 3, "21:05", "¡Eso! Ya estás listo para el 10K de fin de mes"),
    ("marco", 2, "18:40", "Yo solo vengo por el café de después 😂"),
    ("fernanda", 1, "20:15", "Sábado 6:00 am en el Obelisco, ¿quiénes van?"),
    ("andres", 1, "20:30", "Yo voy 🙋‍♂️"),
    ("sofia", 0, "06:50", "Recuerden hidratarse bien, hoy va a hacer calor ☀️")]),
 "gym": ("Gym Squad 💪", "Rutinas, técnica y PRs. Comparte tu progreso y pregunta lo que quieras.", "diego", 2, "s-gym",
         ["andres", "valeria", "fernanda", "marco"], [
    ("diego", 9, "07:30", "Grupo para los que entrenamos fuerza. Dudas de técnica, aquí 👇"),
    ("valeria", 8, "18:00", "¿Qué opinan del hip thrust con pausa arriba?"),
    ("diego", 8, "18:20", "Buenísimo para conexión. 2 segundos arriba y baja controlado"),
    ("fernanda", 4, "17:45", "Hoy no encontraba banco libre en todo el gym 😩"),
    ("marco", 4, "17:50", "Ven al parque, las barras siempre están libres 😎"),
    ("andres", 2, "07:40", "Nuevo PR en sentadilla: 100 kg 🎉"),
    ("diego", 2, "07:45", "¡Felicidades! La técnica se ve sólida en el video"),
    ("valeria", 1, "19:00", "Mañana pierna, ¿alguien se apunta a las 6?"),
    ("andres", 0, "06:20", "¡Vamos! Nos vemos allá")]),
 "yoga": ("Yoga & Movilidad 🧘‍♀️", "Prácticas cortas, estiramientos y respiración para el día a día.", "ana", 1, "s-yoga",
          ["lucia", "valeria", "andres"], [
    ("ana", 12, "06:30", "Hola a todas y todos 🌿 Aquí comparto prácticas cortas cada semana"),
    ("lucia", 11, "21:00", "Me encantó la secuencia de caderas de hoy"),
    ("ana", 7, "06:15", "Tip: respira por la nariz durante todo el flujo, cambia todo"),
    ("valeria", 5, "20:10", "Después de pierna, la postura de paloma es vida 🙏"),
    ("andres", 2, "21:30", "Me uní para mejorar la movilidad de cadera, la necesito para la sentadilla"),
    ("ana", 2, "21:40", "¡Bienvenido! Prueba el flujo B del reto, es justo para eso")]),
}
for sk, (name, desc, owner, cat, cover, members, msgs) in SP.items():
    sid = uid("space", sk)
    w(f"INSERT INTO spaces (id, created_by_user_id, name, description, image_url, visibility, is_active, created_at, activity_category_id) VALUES "
      f"('{sid}', '{U[owner]}', {q(name)}, {q(desc)}, {q(upload(owner, cover + '.jpg'))}, 'public', true, {TS(max(m[1] for m in msgs) + 1, '07:00')}, {cat});")
    w(f"INSERT INTO space_members (space_id, user_id, role, joined_at, is_active) VALUES ('{sid}', '{U[owner]}', 'owner', {TS(max(m[1] for m in msgs) + 1, '07:00')}, true);")
    for m in members:
        w(f"INSERT INTO space_members (space_id, user_id, role, joined_at, is_active) VALUES ('{sid}', '{U[m]}', 'member', {TS(max(x[1] for x in msgs), '07:30')}, true);")
    for who, d, t, txt in msgs:
        w(f"INSERT INTO space_messages (space_id, user_id, message_text, sent_at, is_active) VALUES ('{sid}', '{U[who]}', {q(txt)}, {TS(d, t)}, true);")

# direct messages with the presenter
DM = {
 "diego": ("accepted", [("diego", 3, "19:00", "¿Cómo te fue con el peso muerto hoy?"), ("andres", 3, "19:12", "Bien! Saqué 120 kg x 5 limpias"),
                        ("diego", 3, "19:15", "Eso es progreso real 💪 La próxima semana probamos 125"), ("andres", 1, "20:00", "Dale, ¿y la sentadilla la dejo igual?"),
                        ("diego", 0, "07:05", "Sí, mantén 100 kg y enfócate en la profundidad. Mándame video si puedes")]),
 "sofia": ("accepted", [("sofia", 2, "18:30", "¡Hola! Armé el Reto 10K de noviembre, deberías unirte 🏃‍♂️"), ("andres", 2, "18:45", "Suena bien, ¿cuántos días por semana son?"),
                        ("sofia", 2, "18:47", "Cuatro: dos suaves, intervalos y un fondo largo el sábado"), ("sofia", 0, "06:55", "Ya somos varios, ¡te esperamos!")]),
 "valeria": ("accepted", [("andres", 6, "17:00", "Vale, ¿qué rutina de glúteo me recomiendas para complementar pierna?"),
                          ("valeria", 6, "17:20", "Hip thrust y búlgaras, sin duda. Te paso mi rutina del reto"), ("andres", 6, "17:22", "¡Gracias! 🙌")]),
 "marco": ("accepted", [("marco", 4, "16:00", "Mañana entreno en las barras de la Reforma, ¿te apuntas?"), ("andres", 4, "16:30", "¡Sí! ¿A qué hora?"),
                        ("marco", 4, "16:31", "5 pm, llevo las bandas para las dominadas asistidas"), ("andres", 3, "18:40", "Buenísimo el entreno de hoy, gracias por los tips")]),
 "fernanda": ("pending", [("fernanda", 0, "08:10", "¡Hola Andrés! Vi tu progreso en el reto de fuerza, ¿qué split usas?")]),
}
for p, (status, msgs) in DM.items():
    cid = uid("dm", p)
    first = max(m[1] for m in msgs)
    w(f"INSERT INTO direct_conversations (id, created_at, is_active) VALUES ('{cid}', {TS(first, '00:00')} + interval '1 minute', true);")
    w(f"INSERT INTO direct_conversation_members (direct_conversation_id, user_id, joined_at, status) VALUES ('{cid}', '{U[p]}', {TS(first, '00:01')}, 'accepted');")
    w(f"INSERT INTO direct_conversation_members (direct_conversation_id, user_id, joined_at, status) VALUES ('{cid}', '{U['andres']}', {TS(first, '00:01')}, '{status}');")
    for i, (who, d, t, txt) in enumerate(msgs):
        unread = who != "andres" and i == len(msgs) - 1 and d == 0
        w(f"INSERT INTO direct_messages (direct_conversation_id, user_id, message_text, sent_at, is_active, read_at) VALUES "
          f"('{cid}', '{U[who]}', {q(txt)}, {TS(d, t)}, true, {'NULL' if unread else TS(d, t) + ' + interval ' + q('3 minutes')});")

# notifications for the presenter (newest unread)
N = [(1, "user", U["fernanda"], "fernanda", 0, "08:00", "Nuevo seguidor", "Fernanda Ruiz empezó a seguirte.", {}),
     (12, "challenge", C["octubre"], "diego", 34, "08:00", "Nuevo participante", "Diego Herrera se unió a tu reto.", {}),
     (4, "direct_conversation", uid("dm", "diego"), "diego", 0, "07:05", "Nuevo mensaje", "Diego Herrera te envió un mensaje.", {}),
     (4, "direct_conversation", uid("dm", "sofia"), "sofia", 0, "06:55", "Nuevo mensaje", "Sofía Paredes te envió un mensaje.", {})]
for pid, m, d in posts:
    if m == "andres" and d <= 6:
        N.append((2, "workout_post", pid, "diego", d, "20:00", "Nueva reacción", "A Diego Herrera le gustó tu publicación.", {}))
        N.append((2, "workout_post", pid, "sofia", d, "21:00", "Nueva reacción", "A Sofía Paredes le gustó tu publicación.", {}))
for t, et, eid, actor, d, hm, title, body, data in N:
    read = "false" if d == 0 else "true"
    w(f"INSERT INTO notifications (recipient_user_id, actor_user_id, notification_type_id, related_entity_type, related_entity_id, title, body, is_read, created_at, is_active, data) VALUES "
      f"('{U['andres']}', '{U[actor]}', {t}, '{et}', '{eid}', {q(title)}, {q(body)}, {read}, {TS(d, hm)}, true, {q(json.dumps(data))});")

open("seed.sql", "w").write("\n".join(out) + "\n")

# ---------------------------------------------------------------- cleanup
ids = ", ".join(q(v) for v in U.values())
chs = ", ".join(q(v) for v in C.values())
cleanup = f"""-- Removes the presentation demo: its users and everything they made or that hangs off their challenges/spaces/chats.
SET search_path = havit, public;
CREATE TEMP TABLE demo_users ON COMMIT DROP AS SELECT unnest(ARRAY[{ids}]::uuid[]) AS id;
CREATE TEMP TABLE demo_challenges ON COMMIT DROP AS SELECT id FROM challenges WHERE id = ANY(ARRAY[{chs}]::uuid[]) OR created_by_user_id IN (SELECT id FROM demo_users);
DELETE FROM notifications WHERE recipient_user_id IN (SELECT id FROM demo_users) OR actor_user_id IN (SELECT id FROM demo_users)
  OR related_entity_id IN (SELECT id::text FROM demo_challenges);
DELETE FROM direct_conversations WHERE id IN (SELECT direct_conversation_id FROM direct_conversation_members WHERE user_id IN (SELECT id FROM demo_users));
DELETE FROM workout_logs WHERE user_id IN (SELECT id FROM demo_users) OR challenge_id IN (SELECT id FROM demo_challenges);
DELETE FROM challenges WHERE id IN (SELECT id FROM demo_challenges);
DELETE FROM routines WHERE created_by_user_id IN (SELECT id FROM demo_users);
DELETE FROM spaces WHERE created_by_user_id IN (SELECT id FROM demo_users);
DELETE FROM users WHERE id IN (SELECT id FROM demo_users);
"""
open("cleanup.sql", "w").write(cleanup)
open("uploads.tsv", "w").write("\n".join(f"{a}\t{b}" for a, b in uploads) + "\n")
json.dump({"users": U, "challenges": C}, open("ids.json", "w"), indent=1)
print(f"seed: {len(out)} statements, posts: {len(posts)}, uploads: {len(uploads)}")
for (m, ck), v in sorted(logs.items()): print(f"  {m:9} {ck:11} logs={len(v)}")
