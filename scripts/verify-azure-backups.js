#!/usr/bin/env node
'use strict';

/**
 * B7 — Verificación de los backups automáticos de Azure Database for PostgreSQL
 * Flexible Server. SOLO LECTURA: nunca crea, restaura, modifica ni elimina
 * recursos de Azure.
 *
 * Códigos de salida: 0 = PASS, 1 = FAIL (algún check falló),
 * 2 = no se pudo verificar (sin az, sin sesión, sin permisos, servidor inexistente).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NOT_EXPOSED = 'no expuesto por esta versión de az';
const DEFAULT_MIN_RETENTION_DAYS = 7;
const DEFAULT_MAX_BACKUP_AGE_HOURS = 26;

// `az ... show` incluye el usuario administrador. No es una contraseña, pero es
// media credencial y la evidencia se commitea, así que no se guarda.
const REDACTED_FIELDS = ['administratorLogin', 'administratorLoginPassword'];

class VerificationError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

function parseArgs(argv) {
  const options = {
    server: null,
    resourceGroup: null,
    subscription: null,
    minRetentionDays: DEFAULT_MIN_RETENTION_DAYS,
    maxBackupAgeHours: DEFAULT_MAX_BACKUP_AGE_HOURS,
    out: null,
    json: false,
    fixture: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new VerificationError(`Falta el valor de ${arg}`);
      return value;
    };

    switch (arg) {
      case '--server': options.server = next(); break;
      case '--resource-group': case '-g': options.resourceGroup = next(); break;
      case '--subscription': options.subscription = next(); break;
      case '--min-retention-days': options.minRetentionDays = Number(next()); break;
      case '--max-backup-age-hours': options.maxBackupAgeHours = Number(next()); break;
      case '--out': options.out = next(); break;
      case '--fixture': options.fixture = next(); break;
      case '--json': options.json = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--help': case '-h': options.help = true; break;
      default:
        throw new VerificationError(`Opción desconocida: ${arg}`, 'Usá --help para ver las opciones.');
    }
  }

  if (!Number.isFinite(options.minRetentionDays) || options.minRetentionDays <= 0) {
    throw new VerificationError('--min-retention-days debe ser un número mayor que 0');
  }
  if (!Number.isFinite(options.maxBackupAgeHours) || options.maxBackupAgeHours <= 0) {
    throw new VerificationError('--max-backup-age-hours debe ser un número mayor que 0');
  }

  return options;
}

function printHelp() {
  console.log(`
B7 — Verificación de backups automáticos de Azure PostgreSQL Flexible Server.
Solo lectura: no crea, no restaura, no modifica y no elimina nada.

  node scripts/verify-azure-backups.js --server <nombre> [--resource-group <rg>] [opciones]

Opciones
  --server <nombre>            Servidor a verificar (requerido salvo en --dry-run/--fixture).
  --resource-group, -g <rg>    Resource group. Si falta, se descubre y se aborta si hay varios.
  --subscription <id>          Suscripción a usar.
  --min-retention-days <n>     Retención mínima aceptable. Por defecto ${DEFAULT_MIN_RETENTION_DAYS}.
  --max-backup-age-hours <n>   Antigüedad máxima del backup más reciente. Por defecto ${DEFAULT_MAX_BACKUP_AGE_HOURS}.
  --out <dir>                  Escribe la evidencia (.txt y .json) en ese directorio.
  --json                       Imprime el informe como JSON en vez de texto.
  --fixture <archivo>          Reevalúa una captura guardada, sin llamar a Azure.
  --dry-run                    Ejercita la lógica con datos de ejemplo. NO es evidencia real.
  --help, -h                   Esta ayuda.

Salida
  0  PASS     todos los checks pasaron
  1  FAIL     al menos un check falló
  2  ERROR    no se pudo verificar (sin az, sin sesión, sin permisos, servidor inexistente)
`.trim());
}

function runAz(args) {
  try {
    return JSON.parse(execFileSync('az', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new VerificationError(
        'Azure CLI (az) no está instalado o no está en el PATH.',
        'Instalalo con `brew install azure-cli` (macOS) o seguí https://learn.microsoft.com/cli/azure/install-azure-cli',
      );
    }

    const stderr = String(err.stderr || '');
    if (/az login|AADSTS|not logged in|Please run ['"]?az login/i.test(stderr)) {
      throw new VerificationError('No hay sesión de Azure iniciada.', 'Ejecutá `az login` y volvé a correr el script.');
    }
    if (/AuthorizationFailed|does not have authorization|Forbidden/i.test(stderr)) {
      throw new VerificationError(
        'La cuenta no tiene permisos para leer este recurso.',
        'Hace falta al menos el rol Reader sobre el resource group del servidor.',
      );
    }
    if (/ResourceNotFound|was not found|ResourceGroupNotFound/i.test(stderr)) {
      throw new VerificationError(
        'El servidor o el resource group no existe (o no es visible para esta cuenta).',
        'Verificá el nombre con `az postgres flexible-server list -o table`.',
      );
    }
    throw new VerificationError(
      `Falló \`az ${args.join(' ')}\`.`,
      stderr.trim().split('\n').slice(0, 3).join(' ') || err.message,
    );
  }
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, inner] of Object.entries(value)) {
      copy[key] = REDACTED_FIELDS.includes(key) ? '[redactado]' : redact(inner);
    }
    return copy;
  }
  return value;
}

function pick(source, dottedPath) {
  let current = source;
  for (const key of dottedPath.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

function present(value) {
  return value === undefined || value === null || value === '' ? NOT_EXPOSED : value;
}

function buildDryRunFixture() {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const day = 24 * 60 * 60 * 1000;

  return {
    source: 'fixture',
    note: 'DATOS DE EJEMPLO GENERADOS POR --dry-run. NO SON EVIDENCIA DE NINGÚN SERVIDOR REAL.',
    capturedAt: new Date(now).toISOString(),
    account: { id: '00000000-0000-0000-0000-000000000000', name: 'EXAMPLE-subscription' },
    server: {
      name: 'EXAMPLE-dry-run-server',
      resourceGroup: 'EXAMPLE-resource-group',
      location: 'eastus',
      state: 'Ready',
      version: '16',
      fullyQualifiedDomainName: 'EXAMPLE-dry-run-server.postgres.database.azure.com',
      sku: { name: 'Standard_B1ms', tier: 'Burstable' },
      storage: { storageSizeGB: 32, autoGrow: 'Disabled' },
      highAvailability: { mode: 'Disabled' },
      backup: {
        backupRetentionDays: 7,
        geoRedundantBackup: 'Disabled',
        earliestRestoreDate: iso(7 * day),
      },
    },
    backups: [
      { name: 'EXAMPLE_backup_1', backupType: 'Full', source: 'Automatic', completedTime: iso(2 * 60 * 60 * 1000) },
      { name: 'EXAMPLE_backup_2', backupType: 'Full', source: 'Automatic', completedTime: iso(day + 2 * 60 * 60 * 1000) },
      { name: 'EXAMPLE_backup_3', backupType: 'Full', source: 'Automatic', completedTime: iso(2 * day + 2 * 60 * 60 * 1000) },
    ],
  };
}

function loadFixture(fixturePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } catch (err) {
    throw new VerificationError(`No se pudo leer el fixture ${fixturePath}: ${err.message}`);
  }
  // Acepta tanto un fixture suelto como el JSON de evidencia que emite este mismo script.
  const capture = parsed.capture || parsed;
  if (!capture.server) {
    throw new VerificationError(`El fixture ${fixturePath} no tiene un objeto "server".`);
  }
  return { ...capture, source: 'fixture' };
}

function resolveResourceGroup(serverName, explicitGroup, baseArgs) {
  if (explicitGroup) return explicitGroup;

  const servers = runAz(['postgres', 'flexible-server', 'list', '-o', 'json', ...baseArgs]);
  const matches = servers.filter((server) => server.name === serverName);

  if (matches.length === 0) {
    throw new VerificationError(
      `No se encontró el servidor "${serverName}" en la suscripción activa.`,
      'Revisá el nombre con `az postgres flexible-server list -o table`.',
    );
  }
  if (matches.length > 1) {
    throw new VerificationError(
      `Hay ${matches.length} servidores llamados "${serverName}" en distintos resource groups.`,
      'Indicá cuál con --resource-group.',
    );
  }
  return matches[0].resourceGroup;
}

function captureFromAzure(options) {
  const baseArgs = options.subscription ? ['--subscription', options.subscription] : [];
  const account = runAz(['account', 'show', '-o', 'json', ...baseArgs]);
  const resourceGroup = resolveResourceGroup(options.server, options.resourceGroup, baseArgs);

  const server = runAz([
    'postgres', 'flexible-server', 'show',
    '--resource-group', resourceGroup,
    '--name', options.server,
    '-o', 'json', ...baseArgs,
  ]);

  const backups = runAz([
    'postgres', 'flexible-server', 'backup', 'list',
    '--resource-group', resourceGroup,
    '--server-name', options.server,
    '-o', 'json', ...baseArgs,
  ]);

  return {
    source: 'azure-cli',
    capturedAt: new Date().toISOString(),
    account: { id: account.id, name: account.name },
    server: redact(server),
    backups: redact(Array.isArray(backups) ? backups : []),
    commands: [
      'az account show -o json',
      `az postgres flexible-server show --resource-group ${resourceGroup} --name ${options.server} -o json`,
      `az postgres flexible-server backup list --resource-group ${resourceGroup} --server-name ${options.server} -o json`,
    ],
  };
}

function hoursBetween(laterIso, earlierIso) {
  return (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / (60 * 60 * 1000);
}

function evaluate(capture, options) {
  const checks = [];
  const add = (id, status, label, expected, observed, note) =>
    checks.push({ id, status, label, expected, observed, note });

  const server = capture.server || {};
  const backups = Array.isArray(capture.backups) ? capture.backups : [];
  const now = capture.capturedAt;

  const state = pick(server, 'state');
  add('C1', state === 'Ready' ? 'PASS' : 'FAIL',
    'El servidor existe y está operativo',
    'state = Ready', present(state));

  const retention = pick(server, 'backup.backupRetentionDays');
  if (typeof retention !== 'number') {
    add('C2', 'FAIL', 'Backups automáticos activos',
      `backup.backupRetentionDays >= ${options.minRetentionDays}`, present(retention),
      'Sin retención configurada no hay backups automáticos que verificar.');
  } else {
    add('C2', retention >= options.minRetentionDays ? 'PASS' : 'FAIL',
      'Backups automáticos activos',
      `backup.backupRetentionDays >= ${options.minRetentionDays}`, `${retention} días`,
      retention === options.minRetentionDays
        ? `Igual al mínimo exigido (${options.minRetentionDays}): no hay margen. Azure admite hasta 35 días.`
        : undefined);
  }

  const earliest = pick(server, 'backup.earliestRestoreDate');
  if (!earliest) {
    add('C3', 'FAIL', 'Ventana de recuperación (PITR) abierta',
      'backup.earliestRestoreDate presente', present(earliest));
  } else {
    const windowHours = hoursBetween(now, earliest);
    const maxWindowHours = (typeof retention === 'number' ? retention + 1 : options.minRetentionDays + 1) * 24;
    const valid = Number.isFinite(windowHours) && windowHours > 0 && windowHours <= maxWindowHours;
    add('C3', valid ? 'PASS' : 'FAIL',
      'Ventana de recuperación (PITR) abierta',
      `earliestRestoreDate dentro de la retención (<= ${(maxWindowHours / 24).toFixed(0)} días)`,
      `${earliest} (hace ${windowHours.toFixed(1)} h)`);
  }

  const timed = backups
    .map((backup) => ({ backup, completedTime: backup.completedTime }))
    .filter((entry) => entry.completedTime && Number.isFinite(new Date(entry.completedTime).getTime()));

  if (timed.length === 0) {
    add('C4', 'FAIL', 'Hay puntos de recuperación recientes',
      `al menos 1 backup con completedTime <= ${options.maxBackupAgeHours} h`,
      backups.length === 0 ? 'la lista de backups vino vacía' : `${backups.length} backups, ninguno con completedTime legible`);
  } else {
    const newest = timed.reduce((a, b) => (new Date(a.completedTime) > new Date(b.completedTime) ? a : b));
    const ageHours = hoursBetween(now, newest.completedTime);
    add('C4', ageHours <= options.maxBackupAgeHours ? 'PASS' : 'FAIL',
      'Hay puntos de recuperación recientes',
      `backup más reciente <= ${options.maxBackupAgeHours} h`,
      `${timed.length} backups; el más reciente ${newest.completedTime} (hace ${ageHours.toFixed(1)} h)`,
      'La API no expone un campo de estado por backup: la completitud se infiere de que completedTime exista.');
  }

  const geo = pick(server, 'backup.geoRedundantBackup');
  add('C5', geo === 'Enabled' ? 'PASS' : 'WARN',
    'Redundancia del backup',
    'se registra el valor de backup.geoRedundantBackup', present(geo),
    geo === 'Enabled'
      ? undefined
      : 'Informativo, no es una falla: la geo-redundancia solo se puede elegir al crear el servidor. Si está en Disabled, no hay copia fuera de la región.');

  const failed = checks.filter((check) => check.status === 'FAIL').length;
  return { checks, verdict: failed > 0 ? 'FAIL' : 'PASS', failed };
}

function inventory(server) {
  return [
    ['Servidor', present(pick(server, 'name'))],
    ['Resource group', present(pick(server, 'resourceGroup'))],
    ['FQDN', present(pick(server, 'fullyQualifiedDomainName'))],
    ['Región', present(pick(server, 'location'))],
    ['Estado', present(pick(server, 'state'))],
    ['Versión de PostgreSQL', present(pick(server, 'version'))],
    ['SKU / nivel', `${present(pick(server, 'sku.name'))} / ${present(pick(server, 'sku.tier'))}`],
    ['Almacenamiento (GB)', present(pick(server, 'storage.storageSizeGB'))],
    ['Alta disponibilidad', present(pick(server, 'highAvailability.mode'))],
    ['Retención de backups (días)', present(pick(server, 'backup.backupRetentionDays'))],
    ['Redundancia del backup', present(pick(server, 'backup.geoRedundantBackup'))],
    ['Earliest restore point', present(pick(server, 'backup.earliestRestoreDate'))],
  ];
}

function renderReport(capture, result, options) {
  const line = '='.repeat(80);
  const thin = '-'.repeat(80);
  const isReal = capture.source === 'azure-cli';
  const out = [];

  out.push(line);
  out.push(' B7 — Verificación de backups automáticos (Azure PostgreSQL Flexible Server)');
  out.push(line);
  out.push(` Corrida (UTC)   : ${capture.capturedAt}`);
  out.push(` Origen de datos : ${isReal ? 'AZURE CLI — datos reales' : 'FIXTURE — DATOS DE EJEMPLO, NO ES EVIDENCIA REAL'}`);
  if (!isReal && capture.note) out.push(` Aviso           : ${capture.note}`);
  out.push(` Suscripción     : ${present(pick(capture, 'account.name'))} (${present(pick(capture, 'account.id'))})`);
  out.push(` Umbrales        : retención >= ${options.minRetentionDays} días; backup más reciente <= ${options.maxBackupAgeHours} h`);

  if (Array.isArray(capture.commands) && capture.commands.length > 0) {
    out.push('');
    out.push(' Comandos ejecutados:');
    for (const command of capture.commands) out.push(`   ${command}`);
  }

  out.push('');
  out.push(thin);
  out.push(' CONFIGURACIÓN OBSERVADA');
  out.push(thin);
  for (const [label, value] of inventory(capture.server || {})) {
    out.push(` ${label.padEnd(28)}: ${value}`);
  }

  out.push('');
  out.push(thin);
  out.push(' CHECKS');
  out.push(thin);
  for (const check of result.checks) {
    out.push(` [${check.status.padEnd(4)}] ${check.id}  ${check.label}`);
    out.push(`          esperado : ${check.expected}`);
    out.push(`          observado: ${check.observed}`);
    if (check.note) out.push(`          nota     : ${check.note}`);
  }

  const counts = result.checks.reduce((acc, check) => {
    acc[check.status] = (acc[check.status] || 0) + 1;
    return acc;
  }, {});
  const summary = ['PASS', 'WARN', 'FAIL'].map((key) => `${counts[key] || 0} ${key}`).join(', ');

  out.push('');
  out.push(thin);
  out.push(` RESULTADO: ${result.verdict}   (${result.checks.length} checks: ${summary})   exit=${result.verdict === 'PASS' ? 0 : 1}`);
  if (!isReal) out.push(' ESTE INFORME NO ES EVIDENCIA: proviene de un fixture, no de Azure.');
  out.push(line);

  return out.join('\n');
}

function writeEvidence(dir, capture, result, options, report) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = capture.capturedAt.replace(/[:.]/g, '-');
  const prefix = capture.source === 'azure-cli' ? 'verificacion' : 'FIXTURE-NO-ES-EVIDENCIA';

  const txtPath = path.join(dir, `${prefix}-${stamp}.txt`);
  const jsonPath = path.join(dir, `${prefix}-${stamp}.json`);

  fs.writeFileSync(txtPath, `${report}\n`, 'utf8');
  fs.writeFileSync(jsonPath, `${JSON.stringify({
    tool: 'scripts/verify-azure-backups.js',
    verdict: result.verdict,
    exitCode: result.verdict === 'PASS' ? 0 : 1,
    thresholds: {
      minRetentionDays: options.minRetentionDays,
      maxBackupAgeHours: options.maxBackupAgeHours,
    },
    checks: result.checks,
    capture,
  }, null, 2)}\n`, 'utf8');

  return { txtPath, jsonPath };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    if (err.hint) console.error(`  ${err.hint}`);
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  let capture;
  try {
    if (options.dryRun && options.fixture) {
      throw new VerificationError('--dry-run y --fixture son excluyentes.');
    }
    if (options.dryRun) {
      capture = buildDryRunFixture();
    } else if (options.fixture) {
      capture = loadFixture(options.fixture);
    } else {
      if (!options.server) {
        throw new VerificationError('Falta --server.', 'Usá --server <nombre>, o --dry-run para probar la lógica sin Azure.');
      }
      capture = captureFromAzure(options);
    }
  } catch (err) {
    if (!(err instanceof VerificationError)) throw err;
    console.error(`ERROR: no se pudo verificar — ${err.message}`);
    if (err.hint) console.error(`  ${err.hint}`);
    return 2;
  }

  const result = evaluate(capture, options);
  const report = renderReport(capture, result, options);

  if (options.json) {
    console.log(JSON.stringify({ verdict: result.verdict, checks: result.checks, capture }, null, 2));
  } else {
    console.log(report);
  }

  if (options.out) {
    const { txtPath, jsonPath } = writeEvidence(options.out, capture, result, options, report);
    console.log(`\nEvidencia escrita en:\n  ${txtPath}\n  ${jsonPath}`);
  }

  return result.verdict === 'PASS' ? 0 : 1;
}

process.exitCode = main();
