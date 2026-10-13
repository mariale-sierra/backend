# Locations dinámicas y sustitución de ejercicios (Sprint 9, B7)

Un usuario puede hacer la rutina de un challenge desde otra location (Home, Gym,
Outdoor, ...) y cambiar los ejercicios que no encajan por alternativas
compatibles. **El cambio vive solo en el workout del usuario**; `routine_exercises`
y `challenge_cycle_days` (compartidos) nunca se escriben.

## Criterio de compatibilidad

Un candidato `S` sustituye a un original `O` en la location `L` si se cumple todo:

1. `S` está activo, `S != O` y `S` no está ya en la misma rutina (ni usado como
   sustituto de otro ejercicio).
2. `S` está en `exercise_location_map` para `L`, o etiquetado `anywhere`
   (la etiqueta "se puede hacer en cualquier lado"). Elegir `anywhere` como
   location no restringe nada.
3. Toda métrica de `O` con `isRequired` **o** `isPrimary` existe en `S`
   (mismo `metric_type_id`): los targets y valores de `O` siguen teniendo dónde vivir.
4. Toda métrica `isRequired` de `S` existe en `O`: nunca se obliga al usuario a
   registrar algo que la rutina no planeó.
5. En las métricas compartidas, si ambos `defaultUnit` están definidos deben ser
   iguales (sin distinguir mayúsculas): un target de 20 `lbs` no puede volverse 20 `kg`.

Las métricas opcionales y no primarias de `O` que `S` no tiene no bloquean; sus
targets simplemente no se copian al sustituto (`filterTargetsForSubstitute`).
Implementación: `src/exercises/lib/exercise-substitution.ts` (reglas puras) y
`src/exercises/exercise-substitution.service.ts` (consultas y validación).

## Endpoints

| Endpoint | Uso |
| --- | --- |
| `GET /exercises/location-availability?exerciseIds=1,2` | Por location: qué ejercicios no se pueden hacer ahí (`requiresSubstitution`). |
| `GET /exercises/:id/alternatives?location=home&exclude=3,4` | Sustitutos compatibles (lista vacía si no hay; no es error). 404 si location/ejercicio no existen. |
| `GET /routine/today/:challengeId?location=home&substitutions=10:12` | Rutina de hoy con `locations` y, si se piden, la vista efectiva del usuario (solo en memoria). 400 si una sustitución es inválida. |
| `POST /workout-logs/progress` (`locationCode`, `substitutions[]`) | Guarda el workout. Se re-validan las sustituciones en el servidor; una inválida responde 400 y no se guarda nada. |

## Persistencia

Migración `2026-10-11-01-workout-location-substitutions.sql`:

- `workout_log_exercises.exercise_id` = ejercicio **efectivo** que hizo el usuario.
- `workout_log_exercises.original_exercise_id` = el que prescribía la rutina (`NULL` si no se sustituyó).
- `workout_logs.location_id` = location en la que entrenó.

`GET /workout-logs/:id` y la lista devuelven `exercises[].exercise` (efectivo) y
`exercises[].originalExercise`. Como las métricas registradas cuelgan de
`workout_log_exercises.id`, los resultados quedan siempre atribuidos al ejercicio
realmente hecho.
