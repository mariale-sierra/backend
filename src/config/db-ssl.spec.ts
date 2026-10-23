import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as net from 'net';
import * as tls from 'tls';
import type { AddressInfo } from 'net';
import { resolveAppDbSsl, resolveDbSsl } from './db-ssl';

// The migration runner's copy (plain JS, runs before any build).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const runner = require('../../database/scripts/lib') as {
  resolveDbSsl: typeof resolveDbSsl;
};

const AZURE_BUNDLE = join(
  __dirname,
  '..',
  '..',
  'certs',
  'azure-postgres-root-cas.pem',
);

describe('db-ssl', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('verifies the server certificate by default', () => {
    expect(resolveDbSsl({})).toEqual({ rejectUnauthorized: true });
    expect(resolveDbSsl({ DB_SSL: 'true' })).toEqual({
      rejectUnauthorized: true,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('disables TLS only with DB_SSL=false', () => {
    expect(resolveDbSsl({ DB_SSL: 'false' })).toBe(false);
  });

  it('only skips verification when explicitly asked, and warns', () => {
    expect(resolveDbSsl({ DB_SSL_REJECT_UNAUTHORIZED: 'false' })).toEqual({
      rejectUnauthorized: false,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    // Anything else ("0", "no", typos) keeps verification on.
    expect(resolveDbSsl({ DB_SSL_REJECT_UNAUTHORIZED: '0' })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('loads the committed Azure root bundle as the only trusted CAs', () => {
    const ssl = resolveDbSsl({ DB_SSL_CA_PATH: AZURE_BUNDLE });
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    const pems = String((ssl as tls.ConnectionOptions).ca).match(
      /-----BEGIN CERTIFICATE-----/g,
    );
    expect(pems).toHaveLength(3);
  });

  it('fails fast when DB_SSL_CA_PATH does not exist', () => {
    expect(() => resolveDbSsl({ DB_SSL_CA_PATH: '/nope/ca.pem' })).toThrow(
      /DB_SSL_CA_PATH=\/nope\/ca.pem could not be read/,
    );
    expect(() =>
      runner.resolveDbSsl({ DB_SSL_CA_PATH: '/nope/ca.pem' }),
    ).toThrow(/could not be read/);
  });

  it('keeps the migration runner in lockstep with the app', () => {
    const cases = [
      {},
      { DB_SSL: 'false' },
      { DB_SSL: 'true' },
      { DB_SSL_REJECT_UNAUTHORIZED: 'false' },
      { DB_SSL_REJECT_UNAUTHORIZED: 'true' },
      { DB_SSL_CA_PATH: AZURE_BUNDLE },
    ];
    for (const env of cases) {
      expect(runner.resolveDbSsl(env)).toEqual(resolveDbSsl(env));
      expect(runner.resolveDbSsl(env, 'db.example')).toEqual(
        resolveDbSsl(env, 'db.example'),
      );
    }
  });

  it('talks plain to PgBouncer on the Docker network unless DB_POOL_SSL=true', () => {
    expect(resolveAppDbSsl({ DB_POOL_HOST: 'pgbouncer' })).toBe(false);
    expect(
      resolveAppDbSsl({
        DB_HOST: 'db.example',
        DB_POOL_HOST: 'pgbouncer',
        DB_POOL_SSL: 'true',
      }),
    ).toEqual({ rejectUnauthorized: true, host: 'pgbouncer' });
    expect(resolveAppDbSsl({ DB_HOST: 'db.example' })).toEqual({
      rejectUnauthorized: true,
      host: 'db.example',
    });
  });
});

// Real handshakes with the options above (what `pg` hands to tls.connect).
// Needs the openssl CLI to mint a throwaway CA; skipped if it isn't there.
let hasOpenssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  hasOpenssl = false;
}

(hasOpenssl ? describe : describe.skip)('db-ssl handshake', () => {
  let dir: string;
  let server: tls.Server;
  let port: number;

  const openssl = (args: string) =>
    execFileSync('openssl', args.split(' '), { cwd: dir, stdio: 'ignore' });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'havit-db-ssl-'));
    for (const name of ['ca', 'other-ca']) {
      openssl(
        `req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=${name} -keyout ${name}.key -out ${name}.pem`,
      );
    }
    // "localhost" in the SAN on purpose: it is what node falls back to when
    // pg gives it no host, so the IP test below only passes with the fix.
    writeFileSync(
      join(dir, 'san.ext'),
      'subjectAltName=DNS:db.test.local,DNS:localhost\n',
    );
    openssl(
      'req -newkey rsa:2048 -nodes -subj /CN=db.test.local -keyout server.key -out server.csr',
    );
    openssl(
      'x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 1 -extfile san.ext -out server.pem',
    );

    server = tls.createServer(
      {
        key: readFileSync(join(dir, 'server.key')),
        cert: readFileSync(join(dir, 'server.pem')),
      },
      (socket) => socket.end(),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Same steps as pg's Connection#startTls: an already-open socket, the ssl
  // options spread in, and servername only for DNS names.
  const handshake = (caFile: string, host: string) =>
    new Promise<void>((resolve, reject) => {
      const ssl = resolveDbSsl({ DB_SSL_CA_PATH: join(dir, caFile) }, host);
      if (!ssl) return reject(new Error('expected TLS options'));
      const options: tls.ConnectionOptions = {
        socket: net.connect(port, '127.0.0.1'),
        ...ssl,
      };
      if (net.isIP(host) === 0) options.servername = host;
      const socket = tls.connect(options);
      socket.once('secureConnect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', reject);
    });

  it('accepts a server whose chain and host name check out', async () => {
    await expect(handshake('ca.pem', 'db.test.local')).resolves.toBeUndefined();
  });

  it('rejects a certificate from an untrusted CA', async () => {
    const err = await handshake('other-ca.pem', 'db.test.local').catch(
      (e: NodeJS.ErrnoException) => e,
    );
    expect(err?.code).toMatch(
      /UNABLE_TO_VERIFY|SELF_SIGNED|UNABLE_TO_GET_ISSUER/,
    );
  });

  it('rejects a host name the certificate does not cover', async () => {
    await expect(handshake('ca.pem', 'evil.test.local')).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });

  it('checks an IP host against the certificate, not "localhost"', async () => {
    await expect(handshake('ca.pem', '127.0.0.1')).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });
});
