# Demo de presentación

Datos de demo **en el servidor**: 8 perfiles con fotos reales, 8 retos, unos 220 entrenamientos con
78 publicaciones, likes, comentarios, 3 espacios con mensajes, chats y notificaciones. Nada de esto
corre al arrancar ni al desplegar; solo se carga a mano.

- Cuenta para presentar: `andres.castillo@havit.dev` / `HavitDemo2026!`
  (todas las cuentas de demo usan la misma contraseña y correo `@havit.dev`).
- Andrés **no** tiene registrado el día de hoy, para registrarlo en vivo, y **no** está en
  "Reto 10K de noviembre", para unirse en vivo.
- Las publicaciones de demo son "solo seguidores": los usuarios reales no las ven en su feed.

## Comandos (desde una máquina con acceso SSH al servidor)

```sh
./demo.sh refresh   # el día de la presentación: borra y recarga con fechas de hoy (rachas, "hoy", "ayer")
./demo.sh remove    # al terminar: borra usuarios, todo lo que crearon y sus fotos en R2
```

Las fechas son relativas al momento de carga, en hora de Guatemala.

## Cómo está hecho

- `gen.py` + `personas.py` generan `seed.sql`, `cleanup.sql` y `uploads.tsv`. Los IDs son fijos, así que
  regenerar no cambia URLs ni usuarios.
- Las fotos ya están subidas a R2 en `uploads/<id del usuario demo>/` (`r2.js upload`). `remove` las borra
  por esa carpeta. Créditos en `CREDITS.md`.
- `cleanup.sql` borra por los IDs de los usuarios demo y sus retos, incluida la actividad de usuarios
  reales en esos retos.
