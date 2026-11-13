// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
//   discovery   `info` (the eBUS devices seen, their configuration files),
//               `find -a -F …` (every message definition) and `find -d`
//               (the messages ebusd has data for) -> src/ebusd/catalog.js
//               -> one Gladys device per circuit, plus ebusd itself. ebusd
//               loads a device's configuration a few minutes after it sees
//               it on the bus: the discovery runs again every 10 minutes
//               during the first hour, then every hour, and publishes only
//               when something changed
//   readings    two ways, both into the same values: `listen -v` pushes
//               every value that changes on the bus (most of them, the
//               controller of the house keeps asking the boiler), and every
//               interval each message of the created devices is read with
//               `read -m <interval>` (the ebusd cache when fresh enough, the
//               bus otherwise)
//   scenes      error reported / cleared by a device, ebusd lost / back ->
//               scene events; read and write any message from a scene
//   commands    room and hot water targets, on/off, modes: only when the
//               user allowed changes, within bounds, spaced, counted
//               (src/writes.js), then read back
//   widgets     heating, history, bus
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { buildDevices, DAEMON_ID, DEVICE_TYPES, SIGNAL_KEY, circuitName } from './devices.js';
import { buildCatalog, keyPart, toEbusdValue, toGladysValue } from './ebusd/catalog.js';
import { createClient } from './ebusd/client.js';
import {
  EbusdError,
  parseDefinitions,
  parseInfo,
  parseValueLine,
  valueFields,
} from './ebusd/protocol.js';
import { t, text, truncate, truncateAll } from './i18n.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS } from './scenes.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import { buildBusWidget, buildHeatingWidget, buildHistoryWidget, WIDGETS } from './widgets.js';
import { createWriteGuard, WriteRefused } from './writes.js';

export const ACTIONS = { TEST: 'test_connection' };

const MINUTE = 60 * 1000;
const OFFLINE_AFTER_MS = 3 * MINUTE;
const WIDGET_REFRESH_SPACING_MS = 11 * 1000;
const EARLY_DISCOVERY_MS = 10 * MINUTE;
const LATE_DISCOVERY_MS = 60 * MINUTE;
const EARLY_PERIOD_MS = 60 * MINUTE;
const MAX_MESSAGE = 1800;
const LANGUAGES = ['en', 'fr', 'de', 'es'];
const ROLE_UNITS = { pressure: 'bar', modulation: '%', power: 'W' };

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies.
 * @param {object} [deps.storage] - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {Function} [deps.clientFactory] - `(options) => client` (tests).
 * @param {object} [deps.timings] - `{ timeoutMs, listenRetryMs }` (tests: short).
 * @returns {object} `{ start, stop, discover, poll, … }`.
 */
export function createApp(
  gladys,
  {
    storage = createStorage(),
    logger = sdkLogger,
    now = Date.now,
    clientFactory = createClient,
    timings = {},
  } = {},
) {
  let config = normalizeConfig(gladys.config ?? {});
  let client = null;
  let stopped = false;
  let startedAt = now();
  let discovering = null;
  let polling = null;
  let pollTimer = null;
  let discoveryTimer = null;
  let statusKey = '';

  let info = null;
  let definitions = [];
  let circuits = new Map(); // circuit key -> catalog circuit
  let catalogKey = '';
  let reachable = null; // null: never tried
  let failingSince = null;
  let lastError = null;
  let offlineFired = false;
  let signal = false;
  let listening = false;

  const created = new Set(); // device external ids
  const values = new Map(); // feature external id -> Gladys value
  const transports = new Map();
  const widgetRefresh = new Map();

  const states = createStatePublisher(gladys, {
    logger,
    now,
    isCreated: (externalId) => created.has(externalId),
  });
  const guard = createWriteGuard({ storage, now });

  // The detailed log is a setting (users cannot set LOG_LEVEL on a container
  // the Gladys supervisor creates): written at the info level when it is on.
  const trace = (line) => {
    if (config.debugLogs) {
      logger.info(`ebusd [detail]: ${line}`);
    }
  };

  const safely = (task, what) =>
    Promise.resolve()
      .then(task)
      .catch((error) => logger.warn(`ebusd: ${what} failed: ${error?.message ?? error}`));

  // --- Ids -----------------------------------------------------------------------------------------

  const daemonIds = () => gladys.externalIds(DEVICE_TYPES.DAEMON, DAEMON_ID);
  const circuitIds = (circuit) => gladys.externalIds(DEVICE_TYPES.CIRCUIT, circuit.key);

  /** `ext:sel:circuit:bai[:flowtemp.temp]` -> `{ type, id, key }`. */
  const parseId = (externalId) => {
    const prefix = gladys.externalId('');
    const value = String(externalId ?? '');
    if (!value.startsWith(prefix)) {
      return null;
    }
    const [type, id, ...rest] = value.slice(prefix.length).split(':');
    if (!Object.values(DEVICE_TYPES).includes(type) || !id) {
      return null;
    }
    return { type, id, key: rest.length > 0 ? rest.join(':') : null };
  };

  const featureOf = (externalId) => {
    const parsed = parseId(externalId);
    if (!parsed || parsed.type !== DEVICE_TYPES.CIRCUIT || !parsed.key) {
      return null;
    }
    const circuit = circuits.get(parsed.id);
    const feature = circuit?.features.find((item) => item.key === parsed.key);
    return feature ? { circuit, feature } : null;
  };

  // --- Widgets, transports, status -----------------------------------------------------------------

  const refreshWidget = (key) => {
    const slot = widgetRefresh.get(key) ?? { at: 0, timer: null };
    widgetRefresh.set(key, slot);
    const wait = slot.at + WIDGET_REFRESH_SPACING_MS - now();
    if (wait <= 0) {
      slot.at = now();
      safely(() => gladys.requestWidgetRefresh(key), 'widget refresh');
    } else if (!slot.timer) {
      slot.timer = setTimeout(() => {
        slot.timer = null;
        refreshWidget(key);
      }, wait);
      slot.timer.unref?.();
    }
  };
  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  // One channel: the catalog badge says it; the device badge tells local from unreachable.
  const publishTransports = () => {
    if (reachable === null) {
      return;
    }
    const transport = reachable ? 'local' : 'unreachable';
    const list = [...created]
      .filter((deviceId) => transports.get(deviceId) !== transport)
      .map((deviceId) => {
        transports.set(deviceId, transport);
        return { external_id: deviceId, transport };
      });
    if (list.length > 0) {
      safely(() => gladys.publishTransports(list), 'transport badges');
    }
  };

  function publishStatus() {
    let key;
    let connected;
    let message;
    if (!config.host) {
      [key, connected, message] = ['nohost', false, t('statusNoHost')];
    } else if (reachable === false) {
      [key, connected, message] = [
        `off:${lastError}`,
        false,
        t('statusUnreachable', {
          address: `${config.host}:${config.port}`,
          error: truncate(lastError, 120),
        }),
      ];
    } else if (reachable === null) {
      [key, connected, message] = ['wait', true, t('statusConnecting')];
    } else if (!signal) {
      [key, connected, message] = ['nosignal', false, t('statusNoSignal')];
    } else {
      key = `ok:${circuits.size}:${config.allowWrites}`;
      connected = true;
      message = t(config.allowWrites ? 'statusConnectedWrites' : 'statusConnected', {
        count: circuits.size,
        version: info?.version ?? '?',
      });
    }
    if (key !== statusKey) {
      statusKey = key;
      safely(() => gladys.setConnectionStatus(connected, message), 'status');
    }
  }

  // --- Reachability --------------------------------------------------------------------------------

  const fire = (key, data) =>
    safely(() => gladys.publishSceneEvent(key, data), `scene event ${key}`);

  const markReachable = () => {
    failingSince = null;
    lastError = null;
    if (reachable !== true) {
      logger.info(
        `ebusd: ${reachable === false ? 'answers again' : 'connected'} at ${config.host}:${config.port}`,
      );
      reachable = true;
      publishTransports();
      refreshWidgets();
    }
    if (offlineFired) {
      offlineFired = false;
      fire(SCENE_TRIGGERS.EBUSD_ONLINE, { address: `${config.host}:${config.port}` });
    }
    publishStatus();
  };

  const markUnreachable = (error) => {
    lastError = truncate(error?.message ?? String(error), 160);
    failingSince = failingSince ?? now();
    if (reachable !== false) {
      // Once per loss: the status in Gladys says it too, the log keeps the command.
      const sent = error instanceof EbusdError && error.command ? ` (${error.command})` : '';
      logger.warn(`ebusd: no answer at ${config.host}:${config.port}: ${lastError}${sent}`);
      reachable = false;
      publishTransports();
      refreshWidgets();
    }
    if (!offlineFired && created.size > 0 && now() - failingSince >= OFFLINE_AFTER_MS) {
      offlineFired = true;
      fire(SCENE_TRIGGERS.EBUSD_OFFLINE, { address: `${config.host}:${config.port}` });
    }
    publishStatus();
  };

  const setSignal = (value) => {
    const changed = signal !== value;
    signal = value;
    states.push(daemonIds().feature(SIGNAL_KEY), value ? 1 : 0);
    if (changed) {
      publishStatus();
      refreshWidgets();
    }
  };

  // --- Values --------------------------------------------------------------------------------------

  const noErrorText = () => text('noError', config.language);

  const detectError = (circuit, feature, featureId, previous, current) => {
    if (feature.kind !== 'error' || !created.has(circuitIds(circuit).device)) {
      return;
    }
    if (previous === undefined) {
      return; // first value: not news
    }
    const before = previous?.raw ?? '';
    const after = current.raw;
    if (after === before) {
      return;
    }
    const base = {
      device: circuitIds(circuit).device,
      device_name: truncate(circuitName(circuit, config.language), 200),
      circuit: circuit.circuit,
      message: feature.message,
    };
    if (before) {
      fire(SCENE_TRIGGERS.ERROR_CLEARED, { ...base, error_code: truncate(before, 100) });
    }
    if (after) {
      fire(SCENE_TRIGGERS.ERROR_REPORTED, { ...base, error_code: truncate(after, 100) });
    }
    refreshWidgets();
  };

  /**
   * @description Store and publish the values of one message.
   * @param {string} circuitNameRaw - ebusd circuit name.
   * @param {string} messageName - Message name.
   * @param {Record<string, string>} fieldValues - field -> value text.
   * @returns {number} Features updated.
   */
  const applyValues = (circuitNameRaw, messageName, fieldValues) => {
    const circuit = circuits.get(keyPart(circuitNameRaw));
    if (!circuit) {
      return 0;
    }
    const lowerMessage = String(messageName).toLowerCase();
    const ids = circuitIds(circuit);
    let count = 0;
    for (const feature of circuit.features) {
      if (feature.message.toLowerCase() !== lowerMessage) {
        continue;
      }
      const raw =
        fieldValues[feature.field] ?? (feature.single ? Object.values(fieldValues)[0] : undefined);
      const value = toGladysValue(feature, raw);
      if (value === null) {
        continue;
      }
      const featureId = ids.feature(feature.key);
      const previous = values.get(featureId);
      if (feature.kind === 'error') {
        const current = { raw: value.text };
        values.set(featureId, current);
        states.push(featureId, { text: value.text || noErrorText() });
        detectError(circuit, feature, featureId, previous, current);
      } else {
        values.set(featureId, value);
        states.push(featureId, value);
      }
      count += 1;
    }
    return count;
  };

  const pushAllKnown = () => {
    for (const circuit of circuits.values()) {
      const ids = circuitIds(circuit);
      for (const feature of circuit.features) {
        const featureId = ids.feature(feature.key);
        const value = values.get(featureId);
        if (value === undefined) {
          continue;
        }
        states.push(
          featureId,
          feature.kind === 'error' ? { text: value.raw || noErrorText() } : value,
        );
      }
    }
    states.push(daemonIds().feature(SIGNAL_KEY), signal ? 1 : 0);
  };

  const onListenLine = (line) => {
    const parsed = parseValueLine(line, true);
    if (!parsed.circuit || !parsed.name || Object.keys(parsed.values).length === 0) {
      return;
    }
    if (applyValues(parsed.circuit, parsed.name, parsed.values) > 0) {
      refreshWidget(WIDGETS.HEATING);
    }
  };

  const onListenState = (up, error) => {
    if (listening !== up) {
      listening = up;
      if (!up && error) {
        logger.info(`ebusd: live updates lost (${error.message}), reconnecting`);
      }
      refreshWidget(WIDGETS.BUS);
    }
  };

  // --- Discovery -----------------------------------------------------------------------------------

  const ensureClient = () => {
    if (!client && config.host) {
      client = clientFactory({
        host: config.host,
        port: config.port,
        user: config.user,
        secret: config.secret,
        logger,
        trace,
        ...(timings.timeoutMs ? { timeoutMs: timings.timeoutMs } : {}),
        ...(timings.listenRetryMs ? { listenRetryMs: timings.listenRetryMs } : {}),
      });
      client.listen(onListenLine, onListenState);
    }
    return client;
  };

  const resetClient = () => {
    client?.close();
    client = null;
    listening = false;
  };

  const readInfo = async () => {
    info = parseInfo(await client.info());
    setSignal(info.signal);
    return info;
  };

  function publishDiscovered() {
    if (!config.host) {
      return Promise.resolve();
    }
    return safely(
      () =>
        gladys.publishDiscoveredDevices(
          buildDevices(gladys, {
            circuits,
            info,
            host: config.host,
            port: config.port,
            language: config.language,
          }),
        ),
      'discovery',
    );
  }

  const discoverOnce = async ({ force = false } = {}) => {
    if (!ensureClient()) {
      publishStatus();
      return circuits;
    }
    let withData;
    try {
      await readInfo();
      definitions = parseDefinitions(await client.definitions());
      withData = new Set(
        (await client.withData())
          .split('\n')
          .map((line) => line.trim().toLowerCase().replace(',', '.'))
          .filter((line) => line && !line.endsWith('.')),
      );
      circuits = buildCatalog({
        definitions,
        withData,
        info,
        allSeen: config.allSeen,
        extra: config.extra,
      });
      markReachable();
    } catch (error) {
      if (error instanceof EbusdError && error.message.includes('user name or secret')) {
        markUnreachable(new Error(text('errorAuth', config.language)));
      } else {
        markUnreachable(error);
      }
      return circuits;
    }
    const key = JSON.stringify(
      [...circuits.values()].map((circuit) => [
        circuit.key,
        circuit.ident,
        circuit.features.map((feature) => [feature.key, feature.feature]),
      ]),
    );
    if (force || key !== catalogKey) {
      logger.info(
        `ebusd ${info?.version ?? '?'}: signal ${signal ? 'acquired' : 'none'}, ` +
          `${definitions.length} messages defined, ${withData.size} with data, ` +
          `${circuits.size} devices${circuits.size > 0 ? ` (${[...circuits.keys()].join(', ')})` : ''}`,
      );
      catalogKey = key;
      await publishDiscovered();
      refreshWidgets();
    }
    // The values ebusd already holds (never the bus): Gladys shows something
    // at once, the readings and the live updates refresh them.
    try {
      for (const line of (await client.cached()).split('\n')) {
        const parsed = parseValueLine(line, true);
        if (parsed.circuit && parsed.name && Object.keys(parsed.values).length > 0) {
          applyValues(parsed.circuit, parsed.name, parsed.values);
        }
      }
    } catch (error) {
      trace(`cached values not read: ${error.message}`);
    }
    pushAllKnown();
    publishStatus();
    return circuits;
  };

  /** Run a discovery, or join the one running. */
  const discover = (options = {}) => {
    if (!discovering) {
      discovering = discoverOnce(options).finally(() => {
        discovering = null;
      });
    }
    return discovering;
  };

  const scheduleDiscovery = () => {
    clearTimeout(discoveryTimer);
    discoveryTimer = null;
    if (stopped) {
      return;
    }
    const wait = now() - startedAt < EARLY_PERIOD_MS ? EARLY_DISCOVERY_MS : LATE_DISCOVERY_MS;
    discoveryTimer = setTimeout(() => {
      safely(() => discover(), 'discovery').finally(scheduleDiscovery);
    }, wait);
    discoveryTimer.unref?.();
  };

  // --- Readings ------------------------------------------------------------------------------------

  /** The messages of the created devices, once each. */
  const messagesToRead = () => {
    const list = [];
    for (const circuit of circuits.values()) {
      if (!created.has(circuitIds(circuit).device)) {
        continue;
      }
      const seen = new Set();
      for (const feature of circuit.features) {
        const lower = feature.message.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          list.push({ circuit: feature.circuit, message: feature.message });
        }
      }
    }
    return list;
  };

  const readMessage = async (circuit, message, maxAge) => {
    const answer = await client.read(circuit, message, maxAge);
    const parsed = parseValueLine(answer, true);
    return parsed.values;
  };

  const pollOnce = async () => {
    if (!ensureClient()) {
      return;
    }
    try {
      await readInfo();
      markReachable();
    } catch (error) {
      markUnreachable(error);
      return;
    }
    let changed = false;
    for (const { circuit, message } of messagesToRead()) {
      if (stopped) {
        break;
      }
      try {
        const fieldValues = await readMessage(circuit, message, config.pollSeconds);
        changed = applyValues(circuit, message, fieldValues) > 0 || changed;
      } catch (error) {
        if (error instanceof EbusdError) {
          if (error.noSignal) {
            setSignal(false);
            break; // nothing can be read on the bus now
          }
          trace(`${circuit} ${message} not read: ${error.message}`);
          continue; // no data yet for a passive message, a device that does not answer…
        }
        markUnreachable(error);
        break;
      }
    }
    if (changed) {
      refreshWidget(WIDGETS.HEATING);
    }
  };

  /** Read the created devices (joins a reading in progress). */
  const poll = () => {
    if (!polling) {
      polling = pollOnce().finally(() => {
        polling = null;
      });
    }
    return polling;
  };

  const schedulePolling = () => {
    clearInterval(pollTimer);
    pollTimer = null;
    if (!stopped) {
      pollTimer = setInterval(() => safely(() => poll(), 'reading'), config.pollSeconds * 1000);
      pollTimer.unref?.();
    }
  };

  // --- Commands ------------------------------------------------------------------------------------

  const userError = (key, vars = {}) => new Error(text(key, config.language, vars));

  const refusal = (error) => {
    if (error instanceof WriteRefused) {
      return userError(`writeRefused_${error.reason}`, error.vars);
    }
    if (error instanceof RangeError) {
      return userError('writeRefused_range', { value: truncate(error.message, 60) });
    }
    if (error instanceof EbusdError) {
      return userError(error.noSignal ? 'errorNoSignal' : 'errorEbusd', {
        error: truncate(error.message, 160),
      });
    }
    return userError('errorUnreachable', {
      address: `${config.host}:${config.port}`,
      error: truncate(error?.message ?? error, 160),
    });
  };

  const sameValue = (feature, current, wanted) => {
    if (current === undefined) {
      return false;
    }
    if (feature.kind === 'select') {
      return current?.text === wanted;
    }
    if (feature.kind === 'binary') {
      return current === (wanted === feature.binary.on ? 1 : 0);
    }
    return typeof current === 'number' && Math.abs(current - Number(wanted)) < 1e-6;
  };

  /** Write, count, read back. */
  const writeMessage = async (circuitNameRaw, message, value) => {
    guard.check({
      enabled: config.allowWrites,
      message: `${circuitNameRaw}.${message}`.toLowerCase(),
    });
    if (!ensureClient()) {
      throw new Error(config.host || 'no address');
    }
    const answer = await client.write(circuitNameRaw, message, value);
    await guard.record(`${circuitNameRaw}.${message}`.toLowerCase());
    logger.info(`ebusd: ${circuitNameRaw} ${message} set to ${value}`);
    return answer;
  };

  gladys.onSetValue(async (device, feature, value) => {
    const target = featureOf(feature?.external_id);
    if (!target) {
      throw userError('errorUnknownDevice');
    }
    const featureId = feature.external_id;
    const spec = target.feature;
    try {
      if (!spec.writable) {
        throw new WriteRefused('read_only');
      }
      const wanted = toEbusdValue(spec, value);
      if (sameValue(spec, values.get(featureId), wanted)) {
        // Already so: nothing goes on the bus.
        states.forget(featureId);
        pushAllKnown();
        return;
      }
      await writeMessage(spec.circuit, spec.message, wanted);
      try {
        applyValues(spec.circuit, spec.message, await readMessage(spec.circuit, spec.message, 0));
      } catch {
        // The device took the value; it will be read again at the next interval.
      }
      states.forget(featureId);
      pushAllKnown();
      refreshWidgets();
    } catch (error) {
      // Gladys shows the value asked for: put the real one back.
      states.forget(featureId);
      pushAllKnown();
      throw refusal(error);
    }
  });

  // --- Device events -------------------------------------------------------------------------------

  const trackCreated = (device) => {
    const parsed = parseId(device?.external_id);
    if (!parsed || parsed.key) {
      return false;
    }
    created.add(device.external_id);
    return true;
  };

  gladys.onDeviceCreated(async (device) => {
    if (trackCreated(device)) {
      // States published before the creation were thrown away by Gladys.
      states.republish(device.external_id);
      pushAllKnown();
      transports.delete(device.external_id);
      publishTransports();
      safely(() => poll(), 'reading');
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    if (trackCreated(device)) {
      states.republish(device.external_id);
      pushAllKnown();
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted(async (device) => {
    if (device?.external_id) {
      created.delete(device.external_id);
      transports.delete(device.external_id);
      states.forget(device.external_id);
    }
    refreshWidgets();
  });

  gladys.onScanRequest(async () => {
    await discover({ force: true });
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw ?? {});
    const connectionChanged =
      previous.host !== config.host ||
      previous.port !== config.port ||
      previous.user !== config.user ||
      previous.secret !== config.secret;
    if (connectionChanged) {
      resetClient();
      reachable = null;
      offlineFired = false;
      failingSince = null;
    }
    if (previous.pollSeconds !== config.pollSeconds) {
      schedulePolling();
    }
    if (previous.debugLogs !== config.debugLogs) {
      logger.info(`ebusd: detailed log ${config.debugLogs ? 'on' : 'off'}`);
    }
    if (previous.allowWrites !== config.allowWrites) {
      logger.info(`ebusd: changes ${config.allowWrites ? 'allowed' : 'disabled'}`);
    }
    const catalogChanged =
      previous.allSeen !== config.allSeen ||
      [...previous.extra].join() !== [...config.extra].join() ||
      previous.language !== config.language;
    if (connectionChanged || catalogChanged) {
      await discover({ force: true });
    }
    if (previous.language !== config.language) {
      [...created].forEach((deviceId) => states.forget(deviceId));
      pushAllKnown();
    }
    publishStatus();
  });

  // --- Configuration button ------------------------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    if (!config.host) {
      return t('statusNoHost');
    }
    await discover({ force: true });
    if (!reachable) {
      return t('testUnreachable', {
        address: `${config.host}:${config.port}`,
        error: truncate(lastError ?? '?', 160),
      });
    }
    const message = {};
    for (const language of LANGUAGES) {
      const list = [...circuits.values()]
        .map((circuit) =>
          text('testCircuit', language, {
            name: circuitName(circuit, language),
            count: circuit.features.length,
          }),
        )
        .join(' ; ');
      message[language] = [
        text('testOk', language, { version: info?.version ?? '?' }),
        text(signal ? 'testSignal' : 'testNoSignal', language),
        circuits.size > 0
          ? text('testCircuits', language, { list })
          : text('testNoCircuit', language),
        text(config.allowWrites ? 'testWritesOn' : 'testWritesOff', language),
      ].join(' ');
    }
    return truncateAll(message, MAX_MESSAGE);
  });

  // --- Scene actions -------------------------------------------------------------------------------

  const definitionOf = (circuit, message, direction) =>
    definitions.find(
      (definition) =>
        definition.direction === direction &&
        definition.circuit.toLowerCase() === String(circuit).toLowerCase() &&
        definition.name.toLowerCase() === String(message).toLowerCase(),
    );

  gladys.onSceneAction(SCENE_ACTIONS.READ_VALUE, async (fields = {}) => {
    const circuit = String(fields.circuit ?? '').trim();
    const message = String(fields.message ?? '').trim();
    const wantedField = String(fields.field ?? '').trim();
    if (!ensureClient()) {
      throw userError('errorNoHost');
    }
    const maxAge = Number.isFinite(Number(fields.max_age)) ? Number(fields.max_age) : 300;
    let fieldValues;
    try {
      fieldValues = await readMessage(circuit, message, Math.min(Math.max(maxAge, 0), 3600));
    } catch (error) {
      throw refusal(error);
    }
    applyValues(circuit, message, fieldValues);
    const entries = Object.entries(fieldValues);
    const chosen = wantedField
      ? entries.find(([name]) => name.toLowerCase() === wantedField.toLowerCase())
      : entries[0];
    if (!chosen) {
      throw userError('errorNoField', { field: truncate(wantedField, 40) });
    }
    const definition =
      definitionOf(circuit, message, 'read') ?? definitionOf(circuit, message, 'passive');
    const unit =
      (definition ? valueFields(definition).find((field) => field.name === chosen[0])?.unit : '') ??
      '';
    const asNumber = Number(chosen[1]);
    return {
      value: truncate(chosen[1], 1000),
      number: chosen[1] !== '' && Number.isFinite(asNumber) ? asNumber : null,
      unit: truncate(unit, 20),
      fields: truncate(entries.map(([name, value]) => `${name}=${value}`).join(';'), 5000),
    };
  });

  gladys.onSceneAction(SCENE_ACTIONS.WRITE_VALUE, async (fields = {}) => {
    const circuit = String(fields.circuit ?? '').trim();
    const message = String(fields.message ?? '').trim();
    const value = String(fields.value ?? '').trim();
    const definition = definitionOf(circuit, message, 'write');
    if (!definition) {
      throw userError('errorNoWriteMessage', {
        message: truncate(`${circuit} ${message}`, 60),
      });
    }
    if (definition.level) {
      throw userError('writeRefused_level', { level: truncate(definition.level, 20) });
    }
    try {
      const answer = await writeMessage(definition.circuit, definition.name, value);
      safely(async () => {
        const read = definitionOf(circuit, message, 'read');
        if (read) {
          applyValues(read.circuit, read.name, await readMessage(read.circuit, read.name, 0));
        }
      }, 'reading back');
      return { result: truncate(answer || 'done', 1000) };
    } catch (error) {
      throw refusal(error);
    }
  });

  // --- Widgets -------------------------------------------------------------------------------------

  const roleValue = (circuit, feature) => {
    const featureId = circuitIds(circuit).feature(feature.key);
    const value = values.get(featureId);
    const isCreated = created.has(circuitIds(circuit).device);
    let plain = null;
    if (feature.kind === 'error') {
      plain = value?.raw ?? null;
    } else if (value && typeof value === 'object') {
      plain = value.text;
    } else if (value !== undefined) {
      plain = value;
    }
    return {
      value: plain,
      unit: feature.unit === '°C' ? '°C' : (ROLE_UNITS[feature.role] ?? feature.unit),
      featureId: isCreated && feature.kind === 'number' ? featureId : null,
      created: isCreated,
      known: value !== undefined,
    };
  };

  const heatingView = () => {
    if (!config.host) {
      return null;
    }
    const roles = {};
    for (const circuit of circuits.values()) {
      for (const feature of circuit.features) {
        if (!feature.role) {
          continue;
        }
        const candidate = roleValue(circuit, feature);
        const current = roles[feature.role];
        // Prefer a created device, then a known value.
        const score = (entry) => (entry.created ? 2 : 0) + (entry.known ? 1 : 0);
        if (!current || score(candidate) > score(current)) {
          roles[feature.role] = candidate;
        }
      }
    }
    return {
      reachable: Boolean(reachable),
      signal,
      roles,
      anyCircuit: circuits.size > 0,
    };
  };

  gladys.onWidgetGet(WIDGETS.HEATING, async () => buildHeatingWidget(heatingView()));
  gladys.onWidgetGet(WIDGETS.HISTORY, async ({ settings } = {}) =>
    buildHistoryWidget(heatingView(), settings?.period),
  );
  gladys.onWidgetGet(WIDGETS.BUS, async () =>
    buildBusWidget(
      config.host
        ? {
            reachable: Boolean(reachable),
            info,
            listening,
            circuits: circuits.size,
            address: `${config.host}:${config.port}`,
          }
        : null,
    ),
  );

  // --- Lifecycle -----------------------------------------------------------------------------------

  return {
    /** Read the devices created, discover, then listen and read. */
    async start() {
      stopped = false;
      startedAt = now();
      config = normalizeConfig(gladys.config ?? {});
      created.clear();
      await guard.load();
      (gladys.devices ?? []).forEach((device) => trackCreated(device));
      publishStatus();
      await discover({ force: true });
      schedulePolling();
      scheduleDiscovery();
      safely(() => poll(), 'reading');
    },

    async stop() {
      stopped = true;
      clearInterval(pollTimer);
      clearTimeout(discoveryTimer);
      widgetRefresh.forEach((slot) => clearTimeout(slot.timer));
      states.stop();
      await Promise.allSettled([discovering, polling]);
      resetClient();
    },

    discover,
    poll,
    flushStates: () => states.flush(),
    values,
    circuits: () => circuits,
  };
}
