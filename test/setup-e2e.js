// Jest 27 (testEnvironment node) no expone `crypto` como global, pero
// @nestjs/schedule lo usa al registrar los @Cron de AppModule.
if (!globalThis.crypto) {
  globalThis.crypto = require('crypto').webcrypto;
}
