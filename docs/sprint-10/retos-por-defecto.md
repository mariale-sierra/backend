# Sprint 10 — Retos por defecto para la entrega final

Fecha: 2026-10-26 · Rama: `development` · Repositorio: `backend`

## 1. Qué se hizo

Para la entrega, la app deja de mostrar los retos de prueba creados durante el desarrollo (sin categoría, con nombres y contenido de prueba) y queda con **10 retos por defecto** de la cuenta oficial **@havit**, al menos uno por cada categoría de actividad, con rutinas completas, duración y foto de portada.

| Pieza | Archivo |
|---|---|
| Archiva los retos de prueba y oculta sus fotos de progreso | `database/migrations/2026-10-26-01-archive-test-challenges.sql` |
| Los 10 retos (rutinas, duración, textos) | `scripts/default-challenges.js` |
| Los crea por la API como @havit | `scripts/seed-default-challenges.js` (`npm run seed:default-challenges`) |

## 2. Decisiones

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| **Archivar** (borrado suave, `is_active = false`) los retos de prueba y sus fotos | Borrarlos | Es el mismo mecanismo del borrado propio (B4): desaparecen de toda la app pero se pueden recuperar, y el historial no se pierde |
| La migración nunca toca los retos de @havit | Archivar todo lo anterior a una fecha | Puede volver a correr sin tocar los retos por defecto |
| Crear los retos **por la API** con un script | Insertarlos con SQL | Pasan por el mismo camino que la app: portada subida a R2 y moderada, rutinas con ejercicios reales del catálogo, sin escribir tablas a mano |
| Cada ejercicio se busca por nombre exacto en el catálogo activo; si falta, el script se detiene | Dejar que el backend lo cree | El backend crea un ejercicio nuevo cuando no encuentra el nombre; así nunca entra basura al catálogo |
| El script manda la categoría propia de cada ejercicio | Mandar la del reto | El backend liga el ejercicio a la categoría que recibe; mandar otra agregaría relaciones nuevas al catálogo compartido |

## 3. Los retos

| Reto | Actividad | Lugar | Duración | Ciclo |
|---|---|---|---|---|
| Strength Foundations | Fuerza | Gym | 28 días | Piernas · Torso · Descanso · Cuerpo completo |
| Dumbbell Home Strength | Fuerza | Casa | 21 días | Empuje y piernas · Tirón y bisagra · Descanso |
| HIIT Ignite | Cardio intenso | Gym | 14 días | Máquinas · Correr, cuerdas y escaladora · Descanso |
| Couch to 5K | Cardio intenso | Exterior | 30 días | Carrera suave · Carrera larga (5 km) · Descanso |
| Daily Walk Habit | Cardio suave | Exterior | 21 días | 6 caminatas de 20–45 min · Descanso |
| Zone 2 Base | Cardio suave | Gym / Exterior | 21 días | Bici + caminata · Caminadora inclinada + caminata · Descanso |
| Daily Mobility | Flexibilidad | Cualquier lugar | 14 días | Caderas y piernas · Hombros y columna |
| Yoga Flow Basics | Mente-cuerpo | Cualquier lugar | 21 días | Flujo matutino · Abrir y soltar · Descanso |
| Calm Mind | Mente-cuerpo | Cualquier lugar | 14 días | Respiración y posturas restaurativas (diario) |
| Bodyweight Athlete | Funcional | Cualquier lugar | 28 días | Potencia · Core · Descanso · Acondicionamiento |

**Color de cada card:** sale de la categoría principal de los ejercicios en el catálogo; en un empate gana la categoría del reto. RepDB tiene un solo ejercicio de cardio suave ("Walking"), así que "Zone 2 Base" combina cada máquina con una caminata para que gane Cardio suave. Se verificó con las mismas reglas del importador: los 10 retos dan su categoría.

## 4. Cómo se corre

1. Desplegar la migración (merge a `main`).
2. Registrar en la app la cuenta **@havit**.
3. Poner las portadas en una carpeta, nombradas como el campo `cover` de cada reto (`strength-foundations.jpg`, …). JPEG, PNG o WebP de hasta 5 MB.
4. Desde `backend/`:

```powershell
$env:HAVIT_EMAIL = "<correo de @havit>"
$env:HAVIT_PASSWORD = "<contraseña de @havit>"
$env:HAVIT_COVERS_DIR = "<carpeta de las portadas>"
npm run seed:default-challenges -- --dry-run   # solo valida: ejercicios, portadas y cuenta
npm run seed:default-challenges                # los crea
```

El script se niega a correr con otra cuenta que no sea @havit, se salta los retos que la cuenta ya tiene y nunca imprime la contraseña.

## 5. Cómo revertir

```sql
UPDATE havit.challenges SET is_active = true WHERE ...;   -- los retos a recuperar
UPDATE havit.workout_posts SET is_active = true WHERE ...; -- sus fotos
```
