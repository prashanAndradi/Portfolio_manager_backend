/**
 * Loads .env and records HOW it was resolved, so a deployed environment can be
 * asked where its configuration actually came from.
 *
 * dotenv resolves `.env` against process.cwd(), which is whatever directory the
 * process manager started the app in - not necessarily the directory holding
 * server.js. When those differ, editing the .env next to server.js changes
 * nothing and there is no message to say so. This loads both locations (cwd
 * first, then the app directory) and keeps a record of what each supplied.
 *
 * dotenv never overwrites a variable already present in process.env, so real
 * environment variables (systemd Environment=, a pm2 ecosystem file, docker -e)
 * still win over both files, and loading a second file cannot clobber the first.
 *
 * Only KEY NAMES are ever recorded - never values.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const sources = [];

/** Variables that were already in the real environment before any file was read. */
const preExisting = new Set(Object.keys(process.env));

function loadFrom(file, label) {
  const record = { label, path: file, exists: fs.existsSync(file) };
  if (record.exists) {
    const result = dotenv.config({ path: file });
    record.error = result.error ? result.error.message : undefined;
    record.keys = result.parsed ? Object.keys(result.parsed).sort() : [];
    // A key present in the file but already set in the real environment was
    // NOT applied - the existing value stands.
    record.overriddenByEnvironment = record.keys.filter((k) => preExisting.has(k));
  }
  sources.push(record);
  return record;
}

function load() {
  if (sources.length) return; // idempotent - safe if required more than once
  loadFrom(path.resolve(process.cwd(), '.env'), 'cwd');
  const appEnv = path.resolve(__dirname, '..', '.env');
  if (appEnv !== path.resolve(process.cwd(), '.env')) {
    loadFrom(appEnv, 'app directory');
  }
}

/**
 * Where a given variable came from: a file, the real environment, or nowhere.
 * Returns the origin only - never the value.
 */
function originOf(key) {
  if (!(key in process.env) || process.env[key] === '') return 'not set';
  if (preExisting.has(key)) return 'process environment';
  const hit = sources.find((s) => s.keys && s.keys.includes(key));
  return hit ? `${s_label(hit)}` : 'process environment';
}

function s_label(source) {
  return `${source.label} .env (${source.path})`;
}

/** Diagnostic summary for the health endpoints. Key names only, no values. */
function describe(keysOfInterest = []) {
  return {
    cwd: process.cwd(),
    appDir: path.resolve(__dirname, '..'),
    files: sources.map((s) => ({
      label: s.label,
      path: s.path,
      exists: s.exists,
      error: s.error,
      keyCount: s.keys ? s.keys.length : 0,
      overriddenByEnvironment: s.overriddenByEnvironment
    })),
    origins: Object.fromEntries(keysOfInterest.map((k) => [k, originOf(k)]))
  };
}

module.exports = { load, describe, originOf };
