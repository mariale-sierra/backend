#!/bin/sh
# Demo de presentación en el servidor (ver README.md).
#   ./demo.sh refresh   borra la demo y la vuelve a cargar con fechas de hoy (correr el día de la presentación)
#   ./demo.sh remove    borra la demo por completo: datos y fotos
set -e
cd "$(dirname "$0")"
HOST="${HAVIT_SSH:-azureuser@20.63.84.1}"
KEY="${HAVIT_SSH_KEY:-$HOME/.ssh/havit_vm}"
remote() { ssh -i "$KEY" "$HOST" "$@"; }
sql() { remote 'docker exec -i havit-backend node /tmp/demo-q.js'; }

scp -q -i "$KEY" q.js r2.js "$HOST:/tmp/"
remote 'docker cp /tmp/q.js havit-backend:/tmp/demo-q.js && docker cp /tmp/r2.js havit-backend:/tmp/demo-r2.js'

case "$1" in
  refresh)
    { echo 'BEGIN;'; cat cleanup.sql seed.sql; echo 'COMMIT;'; } | sql
    echo "demo recargada con fecha de hoy" ;;
  remove)
    { echo 'BEGIN;'; cat cleanup.sql; echo 'COMMIT;'; } | sql
    remote "docker exec -w /app havit-backend node /tmp/demo-r2.js delete $(python3 -c 'import json;print(" ".join(json.load(open("ids.json"))["users"].values()))')"
    echo "demo borrada (datos y fotos)" ;;
  *) echo "uso: $0 refresh|remove"; exit 1 ;;
esac
