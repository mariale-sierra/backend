-- ========================================================= 

-- HAVIT - Esquema completo PostgreSQL 

-- Basado en el documento proporcionado por el usuario. 

-- Incluye las 38 tablas descritas en el diseño. 

-- Archivo generado con comentarios, ENUMs, claves foráneas, 

-- restricciones UNIQUE, CHECK e índices recomendados. 

-- Fuente: diseño_db_havit.pdf 

-- ========================================================= 
--
-- Ejecutado por backend/database/scripts/migrate.js como archivo de fase
-- "init" (ver seccion "Base de datos y migraciones" en CLAUDE.md). No
-- editar retroactivamente: cambios de esquema posteriores van en
-- backend/database/migrations/. El runner envuelve cada archivo en su
-- propia transaccion, por eso este archivo ya no lleva BEGIN/COMMIT.
-- =========================================================

 


 

-- ========================================================= 

-- 0. LIMPIEZA OPCIONAL / ESQUEMA 

-- ========================================================= 

 

CREATE SCHEMA IF NOT EXISTS havit; 

SET search_path TO havit; 

 

-- ========================================================= 

-- 1. TIPOS ENUM 

-- ========================================================= 

 

CREATE TYPE tracking_mode_enum AS ENUM ( 

'single', 

'sets', 

'interval', 

'mixed' 

); 

 

CREATE TYPE body_part_relation_type_enum AS ENUM ( 

'primary', 

'secondary', 

'supporting' 

); 

 

CREATE TYPE metric_value_type_enum AS ENUM ( 

'int', 

'decimal', 

'text', 

'seconds', 

'boolean' 

); 

 

CREATE TYPE challenge_visibility_enum AS ENUM ( 

'public', 

'private' 

); 

 

CREATE TYPE challenge_invite_status_enum AS ENUM ( 

'pending', 

'accepted', 

'declined', 

'cancelled', 

'expired' 

); 

 

CREATE TYPE challenge_user_role_enum AS ENUM ( 

'owner', 

'participant' 

); 

 

CREATE TYPE challenge_user_status_enum AS ENUM ( 

'active', 

'completed', 

'left' 

); 

 

CREATE TYPE challenge_day_type_enum AS ENUM ( 

'workout', 

'rest' 

); 

 

CREATE TYPE workout_log_status_enum AS ENUM ( 

'in_progress', 

'completed', 

'cancelled' 

); 

 

CREATE TYPE post_visibility_enum AS ENUM ( 

'followers', 

'private' 

); 

 

CREATE TYPE space_visibility_enum AS ENUM ( 

'public', 

'private' 

); 

 

CREATE TYPE space_member_role_enum AS ENUM ( 

'owner', 

'admin', 

'member' 

); 

 

CREATE TYPE notification_related_entity_type_enum AS ENUM ( 

'workout_post', 

'direct_message', 

'space', 

'user_follow', 

'challenge' 

); 

 

-- ========================================================= 

-- 2. TABLAS BASE DE CATÁLOGO DE EJERCICIOS 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 1. exercises 

-- Catálogo principal de ejercicios. 

-- --------------------------------------------------------- 

CREATE TABLE exercises ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

name VARCHAR(150) NOT NULL, 

slug VARCHAR(180) NOT NULL UNIQUE, 

description TEXT NOT NULL, 

instructions TEXT NOT NULL, 

icon_url VARCHAR(500), 

tracking_mode tracking_mode_enum NOT NULL, 

is_active BOOLEAN NOT NULL DEFAULT TRUE 

); 

 

COMMENT ON TABLE exercises IS 'Catálogo principal de ejercicios.'; 

COMMENT ON COLUMN exercises.slug IS 'Identificador legible y único.'; 

COMMENT ON COLUMN exercises.tracking_mode IS 'Cómo se registra el ejercicio: single, sets, interval o mixed.'; 

 

-- --------------------------------------------------------- 

-- 2. exercise_categories 

-- Categorías principales de ejercicios. 

-- --------------------------------------------------------- 

CREATE TABLE exercise_categories ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

code VARCHAR(100) NOT NULL UNIQUE, 

name VARCHAR(150) NOT NULL, 

description TEXT 

); 

 

COMMENT ON TABLE exercise_categories IS 'Categorías principales de ejercicios.'; 

 

-- --------------------------------------------------------- 

-- 3. exercise_category_map 

-- Relación muchos a muchos entre ejercicios y categorías. 

-- --------------------------------------------------------- 

CREATE TABLE exercise_category_map ( 

exercise_id BIGINT NOT NULL, 

category_id BIGINT NOT NULL, 

is_primary BOOLEAN NOT NULL DEFAULT FALSE, 

PRIMARY KEY (exercise_id, category_id), 

CONSTRAINT fk_exercise_category_map_exercise 

FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE, 

CONSTRAINT fk_exercise_category_map_category 

FOREIGN KEY (category_id) REFERENCES exercise_categories(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE exercise_category_map IS 'Relación muchos a muchos entre ejercicios y categorías.'; 

 

-- --------------------------------------------------------- 

-- 4. exercise_locations 

-- Lugares donde puede realizarse un ejercicio. 

-- --------------------------------------------------------- 

CREATE TABLE exercise_locations ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

code VARCHAR(100) NOT NULL UNIQUE, 

name VARCHAR(150) NOT NULL, 

description TEXT 

); 

 

COMMENT ON TABLE exercise_locations IS 'Lugares donde puede realizarse un ejercicio.'; 

 

-- --------------------------------------------------------- 

-- 5. exercise_location_map 

-- Relación muchos a muchos entre ejercicios y lugares. 

-- --------------------------------------------------------- 

CREATE TABLE exercise_location_map ( 

exercise_id BIGINT NOT NULL, 

location_id BIGINT NOT NULL, 

is_primary BOOLEAN NOT NULL DEFAULT FALSE, 

PRIMARY KEY (exercise_id, location_id), 

CONSTRAINT fk_exercise_location_map_exercise 

FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE, 

CONSTRAINT fk_exercise_location_map_location 

FOREIGN KEY (location_id) REFERENCES exercise_locations(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE exercise_location_map IS 'Relación muchos a muchos entre ejercicios y lugares.'; 

 

-- --------------------------------------------------------- 

-- 6. body_parts 

-- Jerarquía recursiva de partes del cuerpo. 

-- --------------------------------------------------------- 

CREATE TABLE body_parts ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

parent_id BIGINT, 

code VARCHAR(100) NOT NULL UNIQUE, 

name VARCHAR(150) NOT NULL, 

level INT NOT NULL, 

sort_order INT, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

CONSTRAINT fk_body_parts_parent 

FOREIGN KEY (parent_id) REFERENCES body_parts(id) ON DELETE RESTRICT, 

CONSTRAINT ck_body_parts_level_positive 

CHECK (level >= 0) 

); 

 

COMMENT ON TABLE body_parts IS 'Partes del cuerpo organizadas en jerarquía recursiva.'; 

 

-- --------------------------------------------------------- 

-- 7. exercise_body_part_map 

-- Relación entre ejercicios y partes del cuerpo. 

-- --------------------------------------------------------- 

CREATE TABLE exercise_body_part_map ( 

exercise_id BIGINT NOT NULL, 

body_part_id BIGINT NOT NULL, 

relation_type body_part_relation_type_enum NOT NULL, 

priority_order INT, 

PRIMARY KEY (exercise_id, body_part_id), 

CONSTRAINT fk_exercise_body_part_map_exercise 

FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE, 

CONSTRAINT fk_exercise_body_part_map_body_part 

FOREIGN KEY (body_part_id) REFERENCES body_parts(id) ON DELETE CASCADE, 

CONSTRAINT ck_exercise_body_part_priority_positive 

CHECK (priority_order IS NULL OR priority_order >= 1) 

); 

 

COMMENT ON TABLE exercise_body_part_map IS 'Relación entre ejercicios y partes del cuerpo.'; 

 

-- --------------------------------------------------------- 

-- 8. metric_types 

-- Tipos de métricas soportadas por el sistema. 

-- --------------------------------------------------------- 

CREATE TABLE metric_types ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

code VARCHAR(100) NOT NULL UNIQUE, 

name VARCHAR(150) NOT NULL, 

value_type metric_value_type_enum NOT NULL, 

default_unit VARCHAR(50), 

description TEXT 

); 

 

COMMENT ON TABLE metric_types IS 'Tipos de métricas soportadas por el sistema.'; 

 

-- --------------------------------------------------------- 

-- 9. exercise_metrics 

-- Métricas requeridas o aplicables por ejercicio. 

-- --------------------------------------------------------- 

CREATE TABLE exercise_metrics ( 

exercise_id BIGINT NOT NULL, 

metric_type_id BIGINT NOT NULL, 

is_required BOOLEAN NOT NULL DEFAULT FALSE, 

is_primary BOOLEAN NOT NULL DEFAULT FALSE, 

default_unit VARCHAR(50), 

PRIMARY KEY (exercise_id, metric_type_id), 

CONSTRAINT fk_exercise_metrics_exercise 

FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE, 

CONSTRAINT fk_exercise_metrics_metric_type 

FOREIGN KEY (metric_type_id) REFERENCES metric_types(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE exercise_metrics IS 'Define qué métricas aplica o requiere cada ejercicio.'; 

 

-- ========================================================= 

-- 3. USUARIOS 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 10. users 

-- Información base del usuario. 

-- --------------------------------------------------------- 

CREATE TABLE users ( 

id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 

username VARCHAR(100) NOT NULL UNIQUE, 

email VARCHAR(255) NOT NULL UNIQUE, 

password_hash VARCHAR(255) NOT NULL, 

is_active BOOLEAN NOT NULL DEFAULT TRUE 

); 

 

COMMENT ON TABLE users IS 'Información base del usuario.'; 

 

-- --------------------------------------------------------- 

-- 11. user_profiles 

-- Información pública/visual del perfil. 

-- --------------------------------------------------------- 

CREATE TABLE user_profiles ( 

user_id UUID PRIMARY KEY, 

display_name VARCHAR(150) NOT NULL, 

bio TEXT, 

preferred_language VARCHAR(20) NOT NULL, 

profile_image_url VARCHAR(500), 

is_private BOOLEAN NOT NULL DEFAULT FALSE, 

CONSTRAINT fk_user_profiles_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE user_profiles IS 'Información pública o visual del perfil del usuario.'; 

 

-- ========================================================= 

-- 4. RUTINAS 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 12. routines 

-- Rutinas reutilizables. 

-- --------------------------------------------------------- 

CREATE TABLE routines ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

created_by_user_id UUID, 

name VARCHAR(150) NOT NULL, 

description TEXT, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

CONSTRAINT fk_routines_created_by 

FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL 

); 

 

COMMENT ON TABLE routines IS 'Rutinas reutilizables.'; 

 

-- --------------------------------------------------------- 

-- 13. routine_exercises 

-- Ejercicios pertenecientes a una rutina. 

-- --------------------------------------------------------- 

CREATE TABLE routine_exercises ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

routine_id BIGINT NOT NULL, 

exercise_id BIGINT NOT NULL, 

order_index INT NOT NULL, 

notes TEXT, 

CONSTRAINT fk_routine_exercises_routine 

FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE, 

CONSTRAINT fk_routine_exercises_exercise 

FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT, 

CONSTRAINT uq_routine_exercises_routine_order 

UNIQUE (routine_id, order_index), 

CONSTRAINT ck_routine_exercises_order_positive 

CHECK (order_index >= 1) 

); 

 

COMMENT ON TABLE routine_exercises IS 'Ejercicios pertenecientes a una rutina.'; 

 

-- --------------------------------------------------------- 

-- 14. routine_exercise_sets 

-- Series planeadas para un ejercicio dentro de una rutina. 

-- --------------------------------------------------------- 

CREATE TABLE routine_exercise_sets ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

routine_exercise_id BIGINT NOT NULL, 

set_number INT NOT NULL, 

rest_seconds_after INT, 

notes TEXT, 

CONSTRAINT fk_routine_exercise_sets_routine_exercise 

FOREIGN KEY (routine_exercise_id) REFERENCES routine_exercises(id) ON DELETE CASCADE, 

CONSTRAINT uq_routine_exercise_sets_unique_number 

UNIQUE (routine_exercise_id, set_number), 

CONSTRAINT ck_routine_exercise_sets_set_number_positive 

CHECK (set_number >= 1), 

CONSTRAINT ck_routine_exercise_sets_rest_non_negative 

CHECK (rest_seconds_after IS NULL OR rest_seconds_after >= 0) 

); 

 

COMMENT ON TABLE routine_exercise_sets IS 'Series planeadas para un ejercicio dentro de una rutina.'; 

 

-- --------------------------------------------------------- 

-- 15. routine_exercise_set_targets 

-- Objetivos por serie planeada dentro de una rutina. 

-- --------------------------------------------------------- 

CREATE TABLE routine_exercise_set_targets ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

routine_exercise_set_id BIGINT NOT NULL, 

metric_type_id BIGINT NOT NULL, 

target_value_int INT, 

target_value_decimal NUMERIC(12,4), 

target_value_text TEXT, 

target_value_seconds INT, 

target_value_boolean BOOLEAN, 

unit VARCHAR(50), 

CONSTRAINT fk_rest_targets_set 

FOREIGN KEY (routine_exercise_set_id) REFERENCES routine_exercise_sets(id) ON DELETE CASCADE, 

CONSTRAINT fk_rest_targets_metric 

FOREIGN KEY (metric_type_id) REFERENCES metric_types(id) ON DELETE RESTRICT, 

CONSTRAINT uq_rest_targets_metric_per_set 

UNIQUE (routine_exercise_set_id, metric_type_id), 

CONSTRAINT ck_rest_targets_seconds_non_negative 

CHECK (target_value_seconds IS NULL OR target_value_seconds >= 0), 

CONSTRAINT ck_rest_targets_one_value 

CHECK ( 

((target_value_int IS NOT NULL)::INT + 

(target_value_decimal IS NOT NULL)::INT + 

(target_value_text IS NOT NULL)::INT + 

(target_value_seconds IS NOT NULL)::INT + 

(target_value_boolean IS NOT NULL)::INT) = 1 

) 

); 

 

COMMENT ON TABLE routine_exercise_set_targets IS 'Objetivos por serie planeada dentro de una rutina.'; 

 

-- --------------------------------------------------------- 

-- 16. routine_exercise_targets 

-- Objetivos de ejercicios que no usan series. 

-- --------------------------------------------------------- 

CREATE TABLE routine_exercise_targets ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

routine_exercise_id BIGINT NOT NULL, 

metric_type_id BIGINT NOT NULL, 

target_value_int INT, 

target_value_decimal NUMERIC(12,4), 

target_value_text TEXT, 

target_value_seconds INT, 

target_value_boolean BOOLEAN, 

unit VARCHAR(50), 

CONSTRAINT fk_ret_routine_exercise 

FOREIGN KEY (routine_exercise_id) REFERENCES routine_exercises(id) ON DELETE CASCADE, 

CONSTRAINT fk_ret_metric 

FOREIGN KEY (metric_type_id) REFERENCES metric_types(id) ON DELETE RESTRICT, 

CONSTRAINT uq_ret_metric_per_exercise 

UNIQUE (routine_exercise_id, metric_type_id), 

CONSTRAINT ck_ret_seconds_non_negative 

CHECK (target_value_seconds IS NULL OR target_value_seconds >= 0), 

CONSTRAINT ck_ret_one_value 

CHECK ( 

((target_value_int IS NOT NULL)::INT + 

(target_value_decimal IS NOT NULL)::INT + 

(target_value_text IS NOT NULL)::INT + 

(target_value_seconds IS NOT NULL)::INT + 

(target_value_boolean IS NOT NULL)::INT) = 1 

) 

); 

 

COMMENT ON TABLE routine_exercise_targets IS 'Objetivos de ejercicios que no usan series.'; 

 

-- ========================================================= 

-- 5. CHALLENGES 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 17. challenges 

-- Definición general de un challenge. 

-- --------------------------------------------------------- 

CREATE TABLE challenges ( 

id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 

created_by_user_id UUID, 

name VARCHAR(150) NOT NULL, 

description TEXT, 

instructions TEXT, 

visibility challenge_visibility_enum NOT NULL, 

duration_days INT NOT NULL, 

cycle_length_days INT, 

CONSTRAINT fk_challenges_created_by 

FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL, 

CONSTRAINT ck_challenges_duration_positive 

CHECK (duration_days >= 1), 

CONSTRAINT ck_challenges_cycle_positive 

CHECK (cycle_length_days IS NULL OR cycle_length_days >= 1) 

); 

 

COMMENT ON TABLE challenges IS 'Definición general de un challenge.'; 

 

-- --------------------------------------------------------- 

-- 17.1 challenge_invites 

-- Invitaciones de usuarios a challenges. 

-- --------------------------------------------------------- 

CREATE TABLE challenge_invites ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

challenge_id UUID NOT NULL, 

sender_user_id UUID NOT NULL, 

recipient_user_id UUID NOT NULL, 

status challenge_invite_status_enum NOT NULL, 

message TEXT, 

created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

responded_at TIMESTAMP, 

expires_at TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

CONSTRAINT fk_challenge_invites_challenge 

FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE, 

CONSTRAINT fk_challenge_invites_sender 

FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE, 

CONSTRAINT fk_challenge_invites_recipient 

FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE, 

CONSTRAINT ck_challenge_invites_not_self 

CHECK (sender_user_id <> recipient_user_id), 

CONSTRAINT ck_challenge_invites_response_after_create 

CHECK (responded_at IS NULL OR responded_at >= created_at), 

CONSTRAINT ck_challenge_invites_expiration_after_create 

CHECK (expires_at IS NULL OR expires_at >= created_at) 

); 

 

COMMENT ON TABLE challenge_invites IS 'Invitaciones de usuarios a challenges.'; 

 

-- Índice único parcial indicado en el documento para evitar duplicados activos pendientes. 

CREATE UNIQUE INDEX uq_challenge_invite_pending 

ON challenge_invites (challenge_id, sender_user_id, recipient_user_id) 

WHERE status = 'pending' AND is_active = TRUE; 

 

-- --------------------------------------------------------- 

-- 18. challenge_user_map 

-- Relación muchos a muchos entre challenges y usuarios. 

-- --------------------------------------------------------- 

CREATE TABLE challenge_user_map ( 

challenge_id UUID NOT NULL, 

user_id UUID NOT NULL, 

role challenge_user_role_enum NOT NULL, 

joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

status challenge_user_status_enum NOT NULL, 

PRIMARY KEY (challenge_id, user_id), 

CONSTRAINT fk_challenge_user_map_challenge 

FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE, 

CONSTRAINT fk_challenge_user_map_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE challenge_user_map IS 'Relación muchos a muchos entre challenges y usuarios.'; 

 

-- --------------------------------------------------------- 

-- 19. challenge_cycle_days 

-- Días dentro del ciclo de un challenge. 

-- --------------------------------------------------------- 

CREATE TABLE challenge_cycle_days ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

challenge_id UUID NOT NULL, 

day_in_cycle INT NOT NULL, 

routine_id BIGINT, 

day_type challenge_day_type_enum NOT NULL, 

notes TEXT, 

CONSTRAINT fk_challenge_cycle_days_challenge 

FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE, 

CONSTRAINT fk_challenge_cycle_days_routine 

FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL, 

CONSTRAINT uq_challenge_cycle_days 

UNIQUE (challenge_id, day_in_cycle), 

CONSTRAINT ck_challenge_cycle_days_positive 

CHECK (day_in_cycle >= 1) 

); 

 

COMMENT ON TABLE challenge_cycle_days IS 'Días dentro del ciclo de un challenge.'; 

 

-- ========================================================= 

-- 6. WORKOUT LOGS 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 20. workout_logs 

-- Sesión real de entrenamiento. 

-- --------------------------------------------------------- 

CREATE TABLE workout_logs ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

user_id UUID NOT NULL, 

routine_id BIGINT, 

challenge_id UUID, 

challenge_cycle_day_id BIGINT, 

started_at TIMESTAMP NOT NULL, 

ended_at TIMESTAMP, 

status workout_log_status_enum NOT NULL, 

notes TEXT, 

CONSTRAINT fk_workout_logs_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, 

CONSTRAINT fk_workout_logs_routine 

FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL, 

CONSTRAINT fk_workout_logs_challenge 

FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE SET NULL, 

CONSTRAINT fk_workout_logs_challenge_cycle_day 

FOREIGN KEY (challenge_cycle_day_id) REFERENCES challenge_cycle_days(id) ON DELETE SET NULL, 

CONSTRAINT ck_workout_logs_end_after_start 

CHECK (ended_at IS NULL OR ended_at >= started_at) 

); 

 

COMMENT ON TABLE workout_logs IS 'Sesión real de entrenamiento realizada por un usuario.'; 

 

-- --------------------------------------------------------- 

-- 21. workout_log_exercises 

-- Ejercicios ejecutados dentro de un workout. 

-- --------------------------------------------------------- 

CREATE TABLE workout_log_exercises ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

workout_log_id BIGINT NOT NULL, 

exercise_id BIGINT NOT NULL, 

routine_exercise_id BIGINT, 

order_index INT NOT NULL, 

notes TEXT, 

CONSTRAINT fk_workout_log_exercises_workout 

FOREIGN KEY (workout_log_id) REFERENCES workout_logs(id) ON DELETE CASCADE, 

CONSTRAINT fk_workout_log_exercises_exercise 

FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT, 

CONSTRAINT fk_workout_log_exercises_routine_exercise 

FOREIGN KEY (routine_exercise_id) REFERENCES routine_exercises(id) ON DELETE SET NULL, 

CONSTRAINT uq_workout_log_exercises_order 

UNIQUE (workout_log_id, order_index), 

CONSTRAINT ck_workout_log_exercises_order_positive 

CHECK (order_index >= 1) 

); 

 

COMMENT ON TABLE workout_log_exercises IS 'Ejercicios ejecutados dentro de un workout.'; 

 

-- --------------------------------------------------------- 

-- 22. workout_log_exercise_targets 

-- Objetivos copiados al workout para ejercicios sin series. 

-- --------------------------------------------------------- 

CREATE TABLE workout_log_exercise_targets ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

workout_log_exercise_id BIGINT NOT NULL, 

metric_type_id BIGINT NOT NULL, 

target_value_int INT, 

target_value_decimal NUMERIC(12,4), 

target_value_text TEXT, 

target_value_seconds INT, 

target_value_boolean BOOLEAN, 

unit VARCHAR(50), 

CONSTRAINT fk_wlet_workout_log_exercise 

FOREIGN KEY (workout_log_exercise_id) REFERENCES workout_log_exercises(id) ON DELETE CASCADE, 

CONSTRAINT fk_wlet_metric 

FOREIGN KEY (metric_type_id) REFERENCES metric_types(id) ON DELETE RESTRICT, 

CONSTRAINT uq_wlet_metric_per_exercise 

UNIQUE (workout_log_exercise_id, metric_type_id), 

CONSTRAINT ck_wlet_seconds_non_negative 

CHECK (target_value_seconds IS NULL OR target_value_seconds >= 0), 

CONSTRAINT ck_wlet_one_value 

CHECK ( 

((target_value_int IS NOT NULL)::INT + 

(target_value_decimal IS NOT NULL)::INT + 

(target_value_text IS NOT NULL)::INT + 

(target_value_seconds IS NOT NULL)::INT + 

(target_value_boolean IS NOT NULL)::INT) = 1 

) 

); 

 

COMMENT ON TABLE workout_log_exercise_targets IS 'Objetivos copiados al workout para ejercicios sin series.'; 

 

-- --------------------------------------------------------- 

-- 23. workout_log_exercise_metrics 

-- Valores reales registrados para ejercicios sin series. 

-- --------------------------------------------------------- 

CREATE TABLE workout_log_exercise_metrics ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

workout_log_exercise_id BIGINT NOT NULL, 

metric_type_id BIGINT NOT NULL, 

value_int INT, 

value_decimal NUMERIC(12,4), 

value_text TEXT, 

value_seconds INT, 

value_boolean BOOLEAN, 

unit VARCHAR(50), 

CONSTRAINT fk_wlem_workout_log_exercise 

FOREIGN KEY (workout_log_exercise_id) REFERENCES workout_log_exercises(id) ON DELETE CASCADE, 

CONSTRAINT fk_wlem_metric 

FOREIGN KEY (metric_type_id) REFERENCES metric_types(id) ON DELETE RESTRICT, 

CONSTRAINT uq_wlem_metric_per_exercise 

UNIQUE (workout_log_exercise_id, metric_type_id), 

CONSTRAINT ck_wlem_seconds_non_negative 

CHECK (value_seconds IS NULL OR value_seconds >= 0), 

CONSTRAINT ck_wlem_one_value 

CHECK ( 

((value_int IS NOT NULL)::INT + 

(value_decimal IS NOT NULL)::INT + 

(value_text IS NOT NULL)::INT + 

(value_seconds IS NOT NULL)::INT + 

(value_boolean IS NOT NULL)::INT) = 1 

) 

); 

 

COMMENT ON TABLE workout_log_exercise_metrics IS 'Valores reales registrados para ejercicios sin series.'; 

 

-- --------------------------------------------------------- 

-- 24. workout_log_exercise_sets 

-- Series reales ejecutadas dentro de un ejercicio del workout. 

-- --------------------------------------------------------- 

CREATE TABLE workout_log_exercise_sets ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

workout_log_exercise_id BIGINT NOT NULL, 

set_number INT NOT NULL, 

rest_seconds_after INT, 

completed_at TIMESTAMP, 

notes TEXT, 

CONSTRAINT fk_wles_workout_log_exercise 

FOREIGN KEY (workout_log_exercise_id) REFERENCES workout_log_exercises(id) ON DELETE CASCADE, 

CONSTRAINT uq_wles_unique_number 

UNIQUE (workout_log_exercise_id, set_number), 

CONSTRAINT ck_wles_set_number_positive 

CHECK (set_number >= 1), 

CONSTRAINT ck_wles_rest_non_negative 

CHECK (rest_seconds_after IS NULL OR rest_seconds_after >= 0) 

); 

 

COMMENT ON TABLE workout_log_exercise_sets IS 'Series reales ejecutadas dentro de un ejercicio del workout.'; 

 

-- --------------------------------------------------------- 

-- 25. workout_log_exercise_set_targets 

-- Objetivos copiados al workout para cada serie. 

-- --------------------------------------------------------- 

CREATE TABLE workout_log_exercise_set_targets ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

workout_log_exercise_set_id BIGINT NOT NULL, 

metric_type_id BIGINT NOT NULL, 

target_value_int INT, 

target_value_decimal NUMERIC(12,4), 

target_value_text TEXT, 

target_value_seconds INT, 

target_value_boolean BOOLEAN, 

unit VARCHAR(50), 

CONSTRAINT fk_wlest_set 

FOREIGN KEY (workout_log_exercise_set_id) REFERENCES workout_log_exercise_sets(id) ON DELETE CASCADE, 

CONSTRAINT fk_wlest_metric 

FOREIGN KEY (metric_type_id) REFERENCES metric_types(id) ON DELETE RESTRICT, 

CONSTRAINT uq_wlest_metric_per_set 

UNIQUE (workout_log_exercise_set_id, metric_type_id), 

CONSTRAINT ck_wlest_seconds_non_negative 

CHECK (target_value_seconds IS NULL OR target_value_seconds >= 0), 

CONSTRAINT ck_wlest_one_value 

CHECK ( 

((target_value_int IS NOT NULL)::INT + 

(target_value_decimal IS NOT NULL)::INT + 

(target_value_text IS NOT NULL)::INT + 

(target_value_seconds IS NOT NULL)::INT + 

(target_value_boolean IS NOT NULL)::INT) = 1 

) 

); 

 

COMMENT ON TABLE workout_log_exercise_set_targets IS 'Objetivos copiados al workout para cada serie.'; 

 

-- --------------------------------------------------------- 

-- 26. workout_log_exercise_set_metrics 

-- Valores reales registrados para cada serie. 

-- --------------------------------------------------------- 

CREATE TABLE workout_log_exercise_set_metrics ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

workout_log_exercise_set_id BIGINT NOT NULL, 

metric_type_id BIGINT NOT NULL, 

value_int INT, 

value_decimal NUMERIC(12,4), 

value_text TEXT, 

value_seconds INT, 

value_boolean BOOLEAN, 

unit VARCHAR(50), 

CONSTRAINT fk_wlesm_set 

FOREIGN KEY (workout_log_exercise_set_id) REFERENCES workout_log_exercise_sets(id) ON DELETE CASCADE, 

CONSTRAINT fk_wlesm_metric 

FOREIGN KEY (metric_type_id) REFERENCES metric_types(id) ON DELETE RESTRICT, 

CONSTRAINT uq_wlesm_metric_per_set 

UNIQUE (workout_log_exercise_set_id, metric_type_id), 

CONSTRAINT ck_wlesm_seconds_non_negative 

CHECK (value_seconds IS NULL OR value_seconds >= 0), 

CONSTRAINT ck_wlesm_one_value 

CHECK ( 

((value_int IS NOT NULL)::INT + 

(value_decimal IS NOT NULL)::INT + 

(value_text IS NOT NULL)::INT + 

(value_seconds IS NOT NULL)::INT + 

(value_boolean IS NOT NULL)::INT) = 1 

) 

); 

 

COMMENT ON TABLE workout_log_exercise_set_metrics IS 'Valores reales registrados para cada serie.'; 

 

-- ========================================================= 

-- 7. SOCIAL / FEED 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 27. user_follows 

-- Relación dirigida de seguidores y seguidos. 

-- --------------------------------------------------------- 

CREATE TABLE user_follows ( 

follower_user_id UUID NOT NULL, 

followed_user_id UUID NOT NULL, 

created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

PRIMARY KEY (follower_user_id, followed_user_id), 

CONSTRAINT fk_user_follows_follower 

FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE, 

CONSTRAINT fk_user_follows_followed 

FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE, 

CONSTRAINT ck_user_follows_not_self 

CHECK (follower_user_id <> followed_user_id) 

); 

 

COMMENT ON TABLE user_follows IS 'Relación dirigida de seguidores y seguidos.'; 

 

-- --------------------------------------------------------- 

-- 28. workout_posts 

-- Publicación social asociada a un workout_log. 

-- --------------------------------------------------------- 

CREATE TABLE workout_posts ( 

id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 

workout_log_id BIGINT NOT NULL UNIQUE, 

user_id UUID NOT NULL, 

image_url VARCHAR(500) NOT NULL, 

caption TEXT, 

visibility post_visibility_enum NOT NULL, 

created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

CONSTRAINT fk_workout_posts_workout_log 

FOREIGN KEY (workout_log_id) REFERENCES workout_logs(id) ON DELETE CASCADE, 

CONSTRAINT fk_workout_posts_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE workout_posts IS 'Publicación social asociada a un workout_log.'; 

 

-- --------------------------------------------------------- 

-- 29. workout_post_likes 

-- Likes de posts de workout. 

-- --------------------------------------------------------- 

CREATE TABLE workout_post_likes ( 

workout_post_id UUID NOT NULL, 

user_id UUID NOT NULL, 

created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

PRIMARY KEY (workout_post_id, user_id), 

CONSTRAINT fk_workout_post_likes_post 

FOREIGN KEY (workout_post_id) REFERENCES workout_posts(id) ON DELETE CASCADE, 

CONSTRAINT fk_workout_post_likes_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE workout_post_likes IS 'Likes de posts de workout.'; 

 

-- ========================================================= 

-- 8. SPACES / CHATS GRUPALES 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 30. spaces 

-- Comunidades o chats grupales. 

-- --------------------------------------------------------- 

CREATE TABLE spaces ( 

id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 

created_by_user_id UUID NOT NULL, 

name VARCHAR(150) NOT NULL, 

description TEXT, 

image_url VARCHAR(500), 

visibility space_visibility_enum NOT NULL, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

CONSTRAINT fk_spaces_created_by 

FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT 

); 

 

COMMENT ON TABLE spaces IS 'Spaces o chats grupales.'; 

 

-- --------------------------------------------------------- 

-- 31. space_members 

-- Relación entre usuarios y spaces. 

-- --------------------------------------------------------- 

CREATE TABLE space_members ( 

space_id UUID NOT NULL, 

user_id UUID NOT NULL, 

role space_member_role_enum NOT NULL, 

joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

PRIMARY KEY (space_id, user_id), 

CONSTRAINT fk_space_members_space 

FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE, 

CONSTRAINT fk_space_members_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE space_members IS 'Usuarios miembros de spaces.'; 

 

-- --------------------------------------------------------- 

-- 32. space_messages 

-- Mensajes enviados dentro de un space. 

-- --------------------------------------------------------- 

CREATE TABLE space_messages ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

space_id UUID NOT NULL, 

user_id UUID NOT NULL, 

message_text TEXT NOT NULL, 

sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

CONSTRAINT fk_space_messages_space 

FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE, 

CONSTRAINT fk_space_messages_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE space_messages IS 'Mensajes enviados dentro de un space.'; 

 

-- ========================================================= 

-- 9. MENSAJERÍA PRIVADA 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 33. direct_conversations 

-- Conversaciones privadas entre usuarios. 

-- --------------------------------------------------------- 

CREATE TABLE direct_conversations ( 

id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 

created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE 

); 

 

COMMENT ON TABLE direct_conversations IS 'Conversaciones privadas entre usuarios.'; 

 

-- --------------------------------------------------------- 

-- 34. direct_conversation_members 

-- Relación entre usuarios y conversaciones privadas. 

-- --------------------------------------------------------- 

CREATE TABLE direct_conversation_members ( 

direct_conversation_id UUID NOT NULL, 

user_id UUID NOT NULL, 

joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

PRIMARY KEY (direct_conversation_id, user_id), 

CONSTRAINT fk_direct_conversation_members_conversation 

FOREIGN KEY (direct_conversation_id) REFERENCES direct_conversations(id) ON DELETE CASCADE, 

CONSTRAINT fk_direct_conversation_members_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE 

); 

 

COMMENT ON TABLE direct_conversation_members IS 'Participantes de conversaciones privadas.'; 

 

-- --------------------------------------------------------- 

-- 35. direct_messages 

-- Mensajes enviados dentro de conversaciones privadas. 

-- --------------------------------------------------------- 

CREATE TABLE direct_messages ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

direct_conversation_id UUID NOT NULL, 

user_id UUID NOT NULL, 

workout_post_id UUID, 

message_text TEXT NOT NULL, 

sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

CONSTRAINT fk_direct_messages_conversation 

FOREIGN KEY (direct_conversation_id) REFERENCES direct_conversations(id) ON DELETE CASCADE, 

CONSTRAINT fk_direct_messages_user 

FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, 

CONSTRAINT fk_direct_messages_workout_post 

FOREIGN KEY (workout_post_id) REFERENCES workout_posts(id) ON DELETE SET NULL 

); 

 

COMMENT ON TABLE direct_messages IS 'Mensajes enviados dentro de conversaciones privadas.'; 

 

-- ========================================================= 

-- 10. NOTIFICACIONES 

-- ========================================================= 

 

-- --------------------------------------------------------- 

-- 36. notification_types 

-- Tipos posibles de notificación. 

-- --------------------------------------------------------- 

CREATE TABLE notification_types ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

code VARCHAR(100) NOT NULL UNIQUE, 

name VARCHAR(150) NOT NULL, 

description TEXT, 

is_active BOOLEAN NOT NULL DEFAULT TRUE 

); 

 

COMMENT ON TABLE notification_types IS 'Tipos posibles de notificación.'; 

 

-- --------------------------------------------------------- 

-- 37. notifications 

-- Bandeja de notificaciones unificada. 

-- --------------------------------------------------------- 

CREATE TABLE notifications ( 

id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 

recipient_user_id UUID NOT NULL, 

actor_user_id UUID, 

notification_type_id BIGINT NOT NULL, 

related_entity_type notification_related_entity_type_enum NOT NULL, 

related_entity_id BIGINT, 

title VARCHAR(255), 

body TEXT, 

is_read BOOLEAN NOT NULL DEFAULT FALSE, 

created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 

is_active BOOLEAN NOT NULL DEFAULT TRUE, 

CONSTRAINT fk_notifications_recipient 

FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE, 

CONSTRAINT fk_notifications_actor 

FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL, 

CONSTRAINT fk_notifications_type 

FOREIGN KEY (notification_type_id) REFERENCES notification_types(id) ON DELETE RESTRICT 

); 

 

COMMENT ON TABLE notifications IS 'Bandeja de notificaciones unificada.'; 

 

-- ========================================================= 

-- 11. ÍNDICES RECOMENDADOS 

-- ========================================================= 

 

CREATE INDEX idx_exercises_name ON exercises(name); 

CREATE INDEX idx_body_parts_parent_id ON body_parts(parent_id); 

CREATE INDEX idx_routine_exercises_routine_id ON routine_exercises(routine_id); 

CREATE INDEX idx_routine_exercise_sets_routine_exercise_id ON routine_exercise_sets(routine_exercise_id); 

CREATE INDEX idx_challenge_user_map_user_id ON challenge_user_map(user_id); 

CREATE INDEX idx_challenge_cycle_days_challenge_id ON challenge_cycle_days(challenge_id); 

CREATE INDEX idx_workout_logs_user_id ON workout_logs(user_id); 

CREATE INDEX idx_workout_logs_routine_id ON workout_logs(routine_id); 

CREATE INDEX idx_workout_log_exercises_workout_log_id ON workout_log_exercises(workout_log_id); 

CREATE INDEX idx_workout_post_likes_user_id ON workout_post_likes(user_id); 

CREATE INDEX idx_space_members_user_id ON space_members(user_id); 

CREATE INDEX idx_space_messages_space_id ON space_messages(space_id, sent_at); 

CREATE INDEX idx_direct_conversation_members_user_id ON direct_conversation_members(user_id); 

CREATE INDEX idx_direct_messages_conversation_id ON direct_messages(direct_conversation_id, sent_at); 

CREATE INDEX idx_notifications_recipient_is_read_created_at ON notifications(recipient_user_id, is_read, created_at DESC); 

CREATE INDEX idx_notifications_actor_user_id ON notifications(actor_user_id); 

CREATE INDEX idx_notifications_type_id ON notifications(notification_type_id); 

 

