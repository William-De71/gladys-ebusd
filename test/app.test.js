// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`) and the fake ebusd on a real
// local socket: discovery, cached and live values, readings, writes and their
// guards, scene triggers and actions, widgets, ebusd lost and back, settings.
// Nothing leaves 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp } from '../src/app.js';
import { SCENE_ACTION_OUTPUTS, SCENE_TRIGGER_DATA } from '../src/scenes.js';
import { memoryStorage } from '../src/storage.js';
import { DAILY_MAX } from '../src/writes.js';
import { fakeClock, silentLogger, startFake, until } from './helpers.js';

const id = (type, key, feature) =>
  `ext:test-integration:${type}:${key}${feature ? `:${feature}` : ''}`;
const BAI = id('circuit', 'bai');
const CTRL = id('circuit', '700');
const DAEMON = id('daemon', 'ebusd');

/**
 * @description An integration wired to the fake Gladys and a fake ebusd.
 * @param {object} [options] - `{ config, create, fake, storage, logger }`.
 * @returns {Promise<object>} `{ gladys, fake, app, clock, devices, create, stop }`.
 */
async function setup({
  config = {},
  create = true,
  fake,
  storage = memoryStorage(),
  logger = silentLogger,
} = {}) {
  const ebusd = fake ?? (await startFake());
  const gladys = createFakeGladys({
    config: { host: ebusd.host, port: ebusd.port, language: 'fr', ...config },
  });
  const clock = fakeClock();
  const app = createApp(gladys, {
    storage,
    now: clock.now,
    logger,
    timings: { timeoutMs: 500, listenRetryMs: [20] },
  });
  await gladys.connect();
  await app.start();
  const devices = () => gladys.fake.discoveredDevices;
  const createDevice = async (externalId) => {
    const device = devices().find((item) => item.external_id === externalId);
    assert.ok(device, externalId);
    await gladys.fake.deviceCreated(device);
    return device;
  };
  if (create) {
    for (const device of devices()) {
      await gladys.fake.deviceCreated(device);
    }
  }
  return {
    gladys,
    fake: ebusd,
    app,
    clock,
    devices,
    createDevice,
    flush: async () => {
      await app.flushStates();
    },
    async stop() {
      await app.stop();
      await ebusd.close();
    },
  };
}

const stateOf = (gladys, featureId) => {
  const found = [...gladys.fake.states]
    .reverse()
    .find((state) => state.device_feature_external_id === featureId);
  return found ? (found.text ?? found.state) : undefined;
};

test('discovery: ebusd, the boiler, the controller and the broadcast, named in the chosen language', async (t) => {
  const env = await setup({ create: false });
  t.after(() => env.stop());
  const devices = env.devices();
  assert.deepEqual(
    devices.map((device) => device.external_id).sort(),
    [CTRL, BAI, id('circuit', 'broadcast'), DAEMON].sort(),
  );
  const bai = devices.find((device) => device.external_id === BAI);
  assert.equal(bai.name, 'Chaudière bai (Vaillant BAI00)');
  assert.equal(bai.model, 'Vaillant BAI00');
  assert.equal(bai.should_poll, false);
  assert.equal(bai.poll_frequency, undefined);
  assert.deepEqual(
    bai.params.find((param) => param.name === 'EBUSD_ADDRESS'),
    {
      name: 'EBUSD_ADDRESS',
      value: '08',
    },
  );
  const flow = bai.features.find((item) => item.external_id === `${BAI}:flowtemp.temp`);
  assert.equal(flow.name, 'Température de départ');
  const status = env.gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.fr, /ebusd 26\.1\.26\.1 : 3 circuit\(s\) eBUS, en lecture seule/);
  // Nothing published for devices the user has not created.
  await env.flush();
  assert.equal(stateOf(env.gladys, `${BAI}:status01.temp`), undefined);
});

test('values: the cache of ebusd at once when a device is created, then live changes', async (t) => {
  const env = await setup({ create: false });
  t.after(() => env.stop());
  await env.createDevice(BAI);
  await env.createDevice(DAEMON);
  await env.flush();
  assert.equal(stateOf(env.gladys, `${BAI}:status01.temp`), 55.5);
  assert.equal(stateOf(env.gladys, `${BAI}:waterpressure.press`), 1.62);
  assert.equal(stateOf(env.gladys, `${BAI}:flame.value`), 1);
  assert.equal(stateOf(env.gladys, `${BAI}:currenterror.error`), 'Aucune');
  assert.equal(stateOf(env.gladys, `${DAEMON}:signal`), 1);
  await until(() => env.fake.listeners.size === 1);
  env.fake.push('bai.Flame', 'value=off');
  env.fake.push(
    'bai.Status01',
    'temp=61.0;temp_1=44.0;temp_2=6.0;temp_3=48.0;temp_4=49.0;pumpstate=on',
  );
  await until(async () => {
    await env.flush();
    return stateOf(env.gladys, `${BAI}:flame.value`) === 0;
  });
  assert.equal(stateOf(env.gladys, `${BAI}:status01.temp`), 61);
  // The controller is not created: its live values are kept, not published.
  env.fake.push('700.Z1DayTemp', 'value=19');
  await new Promise((resolve) => setTimeout(resolve, 50));
  await env.flush();
  assert.equal(stateOf(env.gladys, `${CTRL}:z1daytemp.value`), undefined);
  await env.createDevice(CTRL);
  await env.flush();
  assert.equal(stateOf(env.gladys, `${CTRL}:z1daytemp.value`), 19);
});

test('readings: the cache when fresh, the bus otherwise, only for created devices', async (t) => {
  const env = await setup({ create: false });
  t.after(() => env.stop());
  await env.createDevice(BAI);
  env.fake.commands.length = 0;
  env.fake.setValue('bai.WaterPressure', 'press=1.48;sensor=ok', { cached: true, age: 600 });
  await env.app.poll();
  await env.flush();
  const reads = env.fake.commands.filter((line) => line.startsWith('read '));
  assert.ok(
    reads.every((line) => line.startsWith('read -m 120 -v -c bai ')),
    reads.join('\n'),
  );
  assert.ok(reads.some((line) => line.endsWith(' WaterPressure')));
  assert.ok(!reads.some((line) => line.includes(' -c 700 ')));
  assert.equal(stateOf(env.gladys, `${BAI}:waterpressure.press`), 1.48);
});

test('no signal: status, signal feature, nothing read on the bus, writes refused', async (t) => {
  const fake = await startFake({ signal: false });
  const env = await setup({ fake, config: { allow_writes: true } });
  t.after(() => env.stop());
  await env.flush();
  assert.equal(stateOf(env.gladys, `${DAEMON}:signal`), 0);
  assert.equal(env.gladys.fake.connectionStatus.connected, false);
  assert.match(env.gladys.fake.connectionStatus.message.fr, /n’entend rien sur l’eBUS/);
  const ctrl = env.devices().find((device) => device.external_id === CTRL);
  const target = ctrl.features.find((item) => item.external_id === `${CTRL}:z1daytemp.value`);
  const ack = await env.gladys.fake.setValue(ctrl, target, 22);
  assert.equal(ack.success, false);
  assert.match(ack.error, /n’entend rien sur l’eBUS/);
  assert.equal(fake.writes.length, 0);
});

test('empty bus: ebusd answers "element not found" to find -d, the status says no signal', async (t) => {
  // The answers of ebusd 26.1 with an adapter and no device on the bus yet
  // (community report: Vaillant boiler not connected).
  const fake = await startFake({ signal: false, values: {} });
  const env = await setup({ fake });
  t.after(() => env.stop());
  await env.flush();
  assert.equal(env.gladys.fake.connectionStatus.connected, false);
  assert.match(env.gladys.fake.connectionStatus.message.fr, /n’entend rien sur l’eBUS/);
  assert.ok(env.devices().some((device) => device.external_id === DAEMON));
  assert.equal(stateOf(env.gladys, `${DAEMON}:signal`), 0);
});

/** A logger that keeps `level message` lines. */
const recordingLogger = () => {
  const lines = [];
  const keep = (level) => (message) => lines.push(`${level} ${message}`);
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
};

test('logs: connection, what a search found, ebusd lost once and back', async (t) => {
  const logger = recordingLogger();
  const env = await setup({ logger });
  t.after(() => env.stop());
  const address = `127.0.0.1:${env.fake.port}`;
  assert.ok(logger.lines.includes(`info ebusd: connected at ${address}`), logger.lines.join('\n'));
  assert.ok(
    logger.lines.some((line) =>
      /^info ebusd .*: signal acquired, \d+ messages defined, \d+ with data, \d+ devices \(.*bai/.test(
        line,
      ),
    ),
  );
  assert.ok(!logger.lines.some((line) => line.includes('[detail]')), 'no detail unless asked');
  await env.fake.close();
  await env.app.poll();
  await env.app.poll();
  const lost = logger.lines.filter((line) =>
    line.startsWith(`warn ebusd: no answer at ${address}`),
  );
  assert.equal(lost.length, 1, 'once per loss');
  await env.fake.listen(env.fake.port, '127.0.0.1');
  await env.app.poll();
  assert.ok(logger.lines.includes(`info ebusd: answers again at ${address}`));
});

test('logs: the detailed log has every command and its answer, never the secret', async (t) => {
  const logger = recordingLogger();
  const fake = await startFake({ users: { gladys: 's3cret-value' } });
  const env = await setup({
    fake,
    logger,
    config: { user: 'gladys', secret: 's3cret-value', debug_logs: true },
  });
  t.after(() => env.stop());
  const detail = () => logger.lines.filter((line) => line.startsWith('info ebusd [detail]: '));
  assert.ok(detail().some((line) => line.includes(': info -> version: ebusd')));
  assert.ok(detail().some((line) => /: find -a -F .* -> .*\(\+\d+ lines\)$/.test(line)));
  assert.ok(
    !logger.lines.some((line) => line.includes('s3cret-value')),
    'the secret is never logged',
  );
  await env.gladys.fake.configUpdated({ ...env.gladys.config, debug_logs: false });
  assert.ok(logger.lines.includes('info ebusd: detailed log off'));
  const count = detail().length;
  await env.app.poll();
  assert.equal(detail().length, count, 'nothing more once off');
});

test('writes: off by default; the value Gladys showed is put back', async (t) => {
  const env = await setup();
  t.after(() => env.stop());
  const ctrl = env.devices().find((device) => device.external_id === CTRL);
  const target = ctrl.features.find((item) => item.external_id === `${CTRL}:z1daytemp.value`);
  const ack = await env.gladys.fake.setValue(ctrl, target, 22);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Autoriser les modifications/);
  assert.equal(env.fake.writes.length, 0);
  await env.flush();
  assert.equal(stateOf(env.gladys, `${CTRL}:z1daytemp.value`), 20.5);
});

test('writes: allowed -> written, read back; same value skipped; bounds, spacing, read only', async (t) => {
  const storage = memoryStorage();
  const env = await setup({ config: { allow_writes: true }, storage });
  t.after(() => env.stop());
  const ctrl = env.devices().find((device) => device.external_id === CTRL);
  const featureOf = (key) => ctrl.features.find((item) => item.external_id === `${CTRL}:${key}`);
  const room = featureOf('z1daytemp.value');
  let ack = await env.gladys.fake.setValue(ctrl, room, 21.7);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(env.fake.writes, [{ circuit: '700', name: 'Z1DayTemp', value: '21.5' }]);
  await env.flush();
  assert.equal(stateOf(env.gladys, `${CTRL}:z1daytemp.value`), 21.5);
  assert.equal(storage.files['writes.json'].count, 1);
  // Already so: nothing on the bus.
  ack = await env.gladys.fake.setValue(ctrl, room, 21.5);
  assert.equal(ack.success, true);
  assert.equal(env.fake.writes.length, 1);
  // A minute between two writes of a message.
  ack = await env.gladys.fake.setValue(ctrl, room, 19);
  assert.equal(ack.success, false);
  assert.match(ack.error, /réessayez dans 60 s/);
  env.clock.advance(61 * 1000);
  ack = await env.gladys.fake.setValue(ctrl, room, 19);
  assert.equal(ack.success, true, ack.error);
  // Out of bounds: refused, never clamped.
  env.clock.advance(61 * 1000);
  ack = await env.gladys.fake.setValue(ctrl, room, 35);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Valeur refusée/);
  // A mode by its name.
  ack = await env.gladys.fake.setValue(ctrl, featureOf('z1opmode.value'), 'night');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(env.fake.writes.at(-1), { circuit: '700', name: 'Z1OpMode', value: 'night' });
  // A sensor is never written.
  ack = await env.gladys.fake.setValue(ctrl, featureOf('z1roomtemp.value'), 20);
  assert.equal(ack.success, false);
  assert.match(ack.error, /ne peut pas être modifiée/);
});

test('writes: the daily quota survives a restart', async (t) => {
  const today = new Date(Date.parse('2026-11-06T08:00:00Z')).toISOString().slice(0, 10);
  const storage = memoryStorage({ 'writes.json': { day: today, count: DAILY_MAX, last: {} } });
  const env = await setup({ config: { allow_writes: true }, storage });
  t.after(() => env.stop());
  const ctrl = env.devices().find((device) => device.external_id === CTRL);
  const room = ctrl.features.find((item) => item.external_id === `${CTRL}:z1daytemp.value`);
  const ack = await env.gladys.fake.setValue(ctrl, room, 22);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Déjà 100 modifications/);
  assert.equal(env.fake.writes.length, 0);
});

test('scene events: an error reported then cleared, never on the first value', async (t) => {
  const env = await setup();
  t.after(() => env.stop());
  await until(() => env.fake.listeners.size === 1);
  env.fake.push('bai.Currenterror', 'error=28;error_1=-;error_2=-;error_3=-;error_4=-');
  await until(() => env.gladys.fake.sceneEvents.length === 1);
  const [reported] = env.gladys.fake.sceneEvents;
  assert.equal(reported.key, 'error_reported');
  assert.deepEqual(reported.data, {
    device: BAI,
    device_name: 'Chaudière bai (Vaillant BAI00)',
    circuit: 'bai',
    message: 'Currenterror',
    error_code: '28',
  });
  assert.deepEqual(
    Object.keys(reported.data).sort(),
    [...SCENE_TRIGGER_DATA.error_reported].sort(),
  );
  env.fake.push('bai.Currenterror', 'error=-;error_1=-;error_2=-;error_3=-;error_4=-');
  await until(() => env.gladys.fake.sceneEvents.length === 2);
  assert.equal(env.gladys.fake.sceneEvents[1].key, 'error_cleared');
  assert.equal(env.gladys.fake.sceneEvents[1].data.error_code, '28');
  await env.flush();
  assert.equal(stateOf(env.gladys, `${BAI}:currenterror.error`), 'Aucune');
});

test('scene events: ebusd offline after 3 minutes, online when back', async (t) => {
  const env = await setup();
  t.after(() => env.stop());
  await env.fake.close();
  await env.app.poll();
  assert.equal(env.gladys.fake.sceneEvents.length, 0, 'not at the first failure');
  assert.equal(env.gladys.fake.connectionStatus.connected, false);
  assert.ok(env.gladys.fake.transports.some((item) => item.transport === 'unreachable'));
  env.clock.advance(3 * 60 * 1000);
  await env.app.poll();
  assert.deepEqual(
    env.gladys.fake.sceneEvents.map((event) => event.key),
    ['ebusd_offline'],
  );
  await env.fake.listen(env.fake.port, '127.0.0.1');
  await env.app.poll();
  assert.deepEqual(
    env.gladys.fake.sceneEvents.map((event) => event.key),
    ['ebusd_offline', 'ebusd_online'],
  );
  assert.equal(env.gladys.fake.sceneEvents[1].data.address, `127.0.0.1:${env.fake.port}`);
  assert.equal(env.gladys.fake.transports.at(-1).transport, 'local');
});

test('scene action read_value: any message, a field, the unit, every field', async (t) => {
  const env = await setup();
  t.after(() => env.stop());
  let ack = await env.gladys.fake.sceneAction('read_value', {
    circuit: 'bai',
    message: 'Status01',
    field: 'temp_1',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    Object.keys(ack.data.outputs).sort(),
    [...SCENE_ACTION_OUTPUTS.read_value].sort(),
  );
  assert.equal(ack.data.outputs.value, '42.0');
  assert.equal(ack.data.outputs.number, 42);
  assert.equal(ack.data.outputs.unit, '°C');
  assert.match(ack.data.outputs.fields, /^temp=55\.5;temp_1=42\.0;/);
  ack = await env.gladys.fake.sceneAction('read_value', { circuit: '700', message: 'HwcOpMode' });
  assert.equal(ack.data.outputs.value, 'auto');
  assert.equal(ack.data.outputs.number, null);
  ack = await env.gladys.fake.sceneAction('read_value', { circuit: 'bai', message: 'Nothing' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /element not found/);
});

test('scene action write_value: guarded, never an installer message', async (t) => {
  const env = await setup();
  t.after(() => env.stop());
  let ack = await env.gladys.fake.sceneAction('write_value', {
    circuit: '700',
    message: 'HwcOpMode',
    value: 'off',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Autoriser les modifications/);
  await env.gladys.fake.configUpdated({ ...env.gladys.config, allow_writes: true });
  ack = await env.gladys.fake.sceneAction('write_value', {
    circuit: '700',
    message: 'HwcOpMode',
    value: 'off',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { result: 'done' });
  ack = await env.gladys.fake.sceneAction('write_value', {
    circuit: '700',
    message: 'HwcMaxFlowTempDesired',
    value: '60',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /niveau d’accès « install »/);
  ack = await env.gladys.fake.sceneAction('write_value', {
    circuit: 'bai',
    message: 'FlowTemp',
    value: '60',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /pas de message d’écriture/);
  assert.equal(env.fake.writes.length, 1);
});

test('widgets: valid contents, live tiles once the devices exist', async (t) => {
  const env = await setup({ create: false });
  t.after(() => env.stop());
  const get = async (key, settings) =>
    (await env.gladys.fake.widgetGet(key, { language: 'fr', settings })).data.content;
  let heating = await get('heating');
  assert.deepEqual(validateWidgetContent(heating), []);
  assert.ok(heating.components.some((item) => item.type === 'value' && item.value === 55.5));
  assert.deepEqual(validateWidgetContent(await get('history', { period: 'last-week' })), []);
  assert.equal((await get('history')).components[0].type, 'text', 'no device yet: a hint');
  const bus = await get('bus');
  assert.deepEqual(validateWidgetContent(bus), []);
  assert.equal(bus.components[0].text.fr, 'ebusd 26.1.26.1');
  assert.ok(bus.components.some((item) => item.type === 'card-list'));
  await env.createDevice(BAI);
  await env.createDevice(CTRL);
  heating = await get('heating');
  assert.deepEqual(validateWidgetContent(heating), []);
  const tiles = heating.components.filter((item) => item.type === 'value');
  assert.ok(tiles.length >= 4 && tiles.length <= 6);
  assert.ok(
    tiles.every((item) => item.device_feature?.startsWith('ext:test-integration:circuit:')),
  );
  const status = heating.components.find((item) => item.type === 'status');
  assert.ok(status.items.some((item) => item.label.fr === 'Flamme' && item.value.fr === 'Allumée'));
  const history = await get('history', { period: 'last-week' });
  assert.equal(history.components[0].type, 'chart');
  assert.equal(history.components[0].interval, 'last-week');
  assert.ok(history.components[0].device_features.length >= 3);
});

test('settings: no address -> a clear status; an address -> discovery; language -> new names', async (t) => {
  const fake = await startFake();
  const gladys = createFakeGladys({ config: { host: '', language: 'en' } });
  const app = createApp(gladys, {
    storage: memoryStorage(),
    logger: silentLogger,
    timings: { timeoutMs: 500, listenRetryMs: [20] },
  });
  t.after(async () => {
    await app.stop();
    await fake.close();
  });
  await gladys.connect();
  await app.start();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Enter the address of ebusd/);
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  let ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.en, /Enter the address/);
  await gladys.fake.configUpdated({ host: `${fake.host}:${fake.port}`, language: 'de' });
  const bai = gladys.fake.discoveredDevices.find((device) => device.external_id === BAI);
  assert.equal(bai.name, 'Heizkessel bai (Vaillant BAI00)');
  ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.fr, /^ebusd 26\.1\.26\.1 répond\. Le signal eBUS est bon\./);
  assert.match(ack.data.message.fr, /Chaudière bai \(Vaillant BAI00\) \(\d+\)/);
  assert.match(ack.data.message.fr, /Lecture seule\.$/);
});

test('settings: extra messages and "every value" change the features offered', async (t) => {
  const env = await setup({ create: false });
  t.after(() => env.stop());
  const keys = () =>
    env
      .devices()
      .find((device) => device.external_id === BAI)
      .features.map((item) => item.external_id.split(':').pop());
  assert.ok(!keys().includes('hwcimpellorswitch.value'));
  await env.gladys.fake.configUpdated({
    ...env.gladys.config,
    extra_messages: 'bai.HwcImpellorSwitch',
  });
  assert.ok(keys().includes('hwcimpellorswitch.value'));
});
