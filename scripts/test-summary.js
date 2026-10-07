#!/usr/bin/env node
// Convierte los reportes JSON de Jest (reports/*.json) en una tabla Markdown
// con el resultado de cada prueba. En GitHub Actions se escribe en
// $GITHUB_STEP_SUMMARY (visible en la pestaña del run) y además se guarda en
// reports/summary.md, que se sube como artefacto. Termina con código 1 si
// alguna prueba falló, para que el job nunca quede en verde por error.
const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'reports');
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  : [];

const icon = { passed: '✅', failed: '❌', pending: '⏭️', skipped: '⏭️' };
let out = '# Resultados de pruebas\n\n';
let failed = 0;
let total = 0;

if (files.length === 0) {
  out += '⚠️ No se encontró ningún reporte en `reports/`.\n';
  failed = 1;
}

for (const file of files.sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  total += r.numTotalTests;
  failed += r.numFailedTests + r.numFailedTestSuites;
  out += `## ${file.replace('.json', '')}\n\n`;
  out += `**${r.numPassedTests} pasaron · ${r.numFailedTests} fallaron · ${r.numPendingTests} omitidas** (de ${r.numTotalTests})\n\n`;
  out += '| Resultado | Suite | Prueba | ms |\n|---|---|---|---|\n';
  for (const suite of r.testResults) {
    const name = path.relative(process.cwd(), suite.name).replace(/\\/g, '/');
    if (suite.assertionResults.length === 0 && suite.status === 'failed') {
      out += `| ❌ | ${name} | (la suite no pudo ejecutarse) | - |\n`;
    }
    for (const t of suite.assertionResults) {
      const title = t.fullName.replace(/\|/g, '\\|');
      out += `| ${icon[t.status] || t.status} | ${name} | ${title} | ${t.duration ?? '-'} |\n`;
    }
  }
  out += '\n';
  for (const suite of r.testResults) {
    for (const t of suite.assertionResults.filter(
      (x) => x.status === 'failed',
    )) {
      out += `<details><summary>❌ ${t.fullName}</summary>\n\n\`\`\`\n${(
        t.failureMessages || []
      )
        .join('\n')
        .replace(/\u001b\[[0-9;]*m/g, '')
        .slice(0, 3000)}\n\`\`\`\n</details>\n\n`;
    }
  }
}

out +=
  failed === 0
    ? `**Estado: ✅ ${total} pruebas, sin fallos**\n`
    : '**Estado: ❌ hay fallos**\n';
fs.writeFileSync(path.join(dir, 'summary.md'), out);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
}
console.log(out);
process.exit(failed === 0 ? 0 : 1);
