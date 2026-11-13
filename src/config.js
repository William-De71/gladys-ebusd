// -----------------------------------------------------------------------------
// Integration configuration: the `config_schema` values of the manifest,
// normalized so the rest of the code never deals with strings from a form or
// `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
// Seconds. ebusd answers from its cache when the value is younger than the
// interval: most values are already read by the controller of the house, the
// integration only asks the bus for the others.
export const POLL_INTERVALS = [60, 120, 300, 600];
export const MESSAGE_SETS = ['useful', 'all'];
export const DEFAULT_PORT = 8888;

// Defaults: they MUST stay consistent with the `default` values of the
// manifest `config_schema` (test/manifest.test.js checks it).
export const DEFAULTS = {
  host: '',
  port: DEFAULT_PORT,
  user: '',
  secret: '',
  poll_interval: '120',
  messages: 'useful',
  extra_messages: '',
  allow_writes: false,
  language: 'en',
  debug_logs: false,
};

const bool = (value, fallback) => {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
};

/**
 * @description "192.168.1.20", "ebusd.local:8888", "[fd00::5]:8888" -> host and port.
 * @param {string} raw - Address typed by the user.
 * @param {number|string} rawPort - Port setting.
 * @returns {{ host: string, port: number }} Host ('' when none) and port.
 */
export function parseAddress(raw, rawPort) {
  let host = String(raw ?? '')
    .trim()
    .replace(/^tcp:\/\//i, '')
    .replace(/\/.*$/, '');
  let port = Number(rawPort);
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(host);
  if (bracketed) {
    host = bracketed[1];
    if (bracketed[2]) {
      port = Number(bracketed[2]);
    }
  } else if ((host.match(/:/g) ?? []).length === 1) {
    const [name, typedPort] = host.split(':');
    host = name;
    if (/^\d+$/.test(typedPort)) {
      port = Number(typedPort);
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    port = DEFAULT_PORT;
  }
  return { host, port };
}

/**
 * @description "bai.FlowTemp, 700 Z1DayTemp" -> Set of `circuit.name` in lower case.
 * @param {string} raw - The setting.
 * @returns {Set<string>} The messages.
 */
export function parseExtraMessages(raw) {
  const set = new Set();
  for (const item of String(raw ?? '').split(/[,;\n]+/)) {
    const match = /^\s*([\w.-]+?)[.\s/]+(\w+)\s*$/.exec(item);
    if (match) {
      set.add(`${match[1]}.${match[2]}`.toLowerCase());
    }
  }
  return set;
}

/**
 * @description Normalize the raw configuration.
 * @param {object} raw - `gladys.config` or the `onConfigUpdated` payload.
 * @returns {object} `{ host, port, user, secret, pollSeconds, allSeen, extra, allowWrites, language, debugLogs }`.
 */
export function normalizeConfig(raw = {}) {
  const interval = Number(raw.poll_interval ?? DEFAULTS.poll_interval);
  const { host, port } = parseAddress(raw.host ?? DEFAULTS.host, raw.port ?? DEFAULTS.port);
  return {
    host,
    port,
    user: String(raw.user ?? DEFAULTS.user).trim(),
    secret: String(raw.secret ?? DEFAULTS.secret),
    pollSeconds: POLL_INTERVALS.includes(interval) ? interval : Number(DEFAULTS.poll_interval),
    allSeen: (MESSAGE_SETS.includes(raw.messages) ? raw.messages : DEFAULTS.messages) === 'all',
    extra: parseExtraMessages(raw.extra_messages ?? DEFAULTS.extra_messages),
    allowWrites: bool(raw.allow_writes, DEFAULTS.allow_writes),
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULTS.language,
    debugLogs: bool(raw.debug_logs, DEFAULTS.debug_logs),
  };
}
