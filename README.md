# 🏋️‍♂️ Havit — Backend

Backend de **Havit**, una plataforma de fitness basada en challenges donde los usuarios registran su progreso diario, se unen a retos y visualizan su avance.

> ⚠️ **Este backend corre en un servidor remoto.** No está pensado para ejecutarse localmente — la base de datos solo es accesible desde el servidor. Si necesitas revisar el estado del servicio o los logs, conéctate directamente al servidor (ver sección de acceso más abajo).

---

## 🚀 Stack

- **NestJS** + TypeScript
- **TypeORM** + PostgreSQL
- **JWT** para autenticación
- **Swagger** para documentación de APIs
- **Cloudflare** para almacenamiento remoto de las imágenes
- Desplegado en VM con base de datos remota

---

## ☁️ Acceso al servidor

El backend está corriendo en:

```
http://20.63.84.1:3000
```

Para ver los logs en tiempo real, conéctate al servidor vía SSH y ejecuta:

```bash
# Ver logs del proceso activo
docker-compose logs backend
```

> 🔒 No detener ni reiniciar el proceso — el servidor está en producción.

---

## ⚙️ Variables de entorno

El archivo `.env` en el servidor ya está configurado. Su estructura es:

```env
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME
JWT_SECRET=tu_secret
```

---

## 🔐 Autenticación

El sistema usa JWT. Para obtener un token:

```http
POST /auth/login
```

Respuesta:

```json
{
  "accessToken": "..."
}
```

En endpoints protegidos, incluir el header:

```
Authorization: Bearer <TOKEN>
```

---

## 📡 Endpoints principales

### 🧑 Usuarios

```http
GET /users/me
GET /users/me/challenges
```

### 🏋️ Challenges

```http
GET  /challenges
GET  /challenges/:id
POST /challenges
POST /challenges/:id/join
GET  /challenges/progress
```

### 📈 Progreso

```http
POST /progress
GET  /challenges/progress
```

### 📸 Posts

```http
POST /workout-posts
```

---

## 🧠 Flujo principal

```
Usuario inicia sesión
        ↓
Explora challenges disponibles
        ↓
Se une a un challenge
        ↓
Registra progreso diario
        ↓
Sube evidencia (imagen como URL)
        ↓
Visualiza su avance
```

---

## 🧪 Ejemplo de request (Postman / Thunder Client)

```http
POST /progress
Authorization: Bearer <TOKEN>

{
  "challengeId": 1,
  "imageUrl": "https://test.com/img.jpg",
  "caption": "Workout done 💪",
  "visibility": "private",
  "isRestDay": false
}
```

---

## ⚠️ Reglas de negocio importantes

- Solo se permite **un registro por día** por challenge
- El progreso se calcula dinámicamente según workouts completados
- Las imágenes se manejan como URLs (integración con Cloudflare R2 pendiente)

---

## 🗺️ Próximos pasos

- [ ] Sistema de comunidad entre usuarios
- [ ] Notificaciones push
- [ ] Métricas avanzadas de progreso

---


