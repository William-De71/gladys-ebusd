// The ebusd protocol and the catalog, on the real answers of an ebusd 26.1
// (test/fixtures: a Vaillant boiler BAI00 and a VRC 700 controller).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  DHW_TARGET,
  ROOM_TARGET,
  buildCatalog,
  featureKey,
  humanize,
  toEbusdValue,
  toGladysValue,
} from '../src/ebusd/catalog.js';
import {
  EbusdError,
  argument,
  checkAnswer,
  parseDefinition,
  parseDefinitions,
  parseInfo,
  parseState,
  parseValueLine,
  parseValueList,
  safeName,
  splitCsv,
  valueFields,
} from '../src/ebusd/protocol.js';
import { buildDevices, circuitKind, circuitName } from '../src/devices.js';
import { FIXTURE_DEFINITIONS, FIXTURE_INFO } from './helpers.js';

const definitions = parseDefinitions(FIXTURE_DEFINITIONS);
const info = parseInfo(FIXTURE_INFO);
const withData = new Set([
  'bai.status01',
  'bai.flame',
  'bai.hchours',
  'bai.pumppower',
  'bai.dsn',
  '700.hwctempdesired',
  '700.hwcopmode',
  '700.z1daytemp',
  '700.z1opmode',
  'broadcast.outsidetemp',
]);
const catalog = () => buildCatalog({ definitions, withData, info });
const feature = (circuits, circuit, key) =>
  circuits.get(circuit)?.features.find((item) => item.key === key);

test('answers: errors, usage, CSV cells, value lists, names', () => {
  assert.equal(checkAnswer('done', 'write'), 'done');
  assert.throws(
    () => checkAnswer('ERR: no signal', 'read'),
    (error) => {
      assert.ok(error instanceof EbusdError);
      assert.ok(error.noSignal);
      return true;
    },
  );
  assert.throws(
    () => checkAnswer('ERR: element not found', 'read'),
    (error) => error.notFound,
  );
  assert.throws(() => checkAnswer('usage: read [-f] …', 'read -x'), /invalid command/);
  assert.deepEqual(splitCsv('r,bai,,A,"text, with comma",08'), [
    'r',
    'bai',
    '',
    'A',
    'text, with comma',
    '08',
  ]);
  assert.deepEqual(splitCsv('a,"say ""hi""",b'), ['a', 'say "hi"', 'b']);
  assert.deepEqual(parseValueList('0=off;1=on'), { 0: 'off', 1: 'on' });
  assert.equal(parseValueList('10'), null);
  assert.equal(argument('auto'), 'auto');
  assert.equal(argument('02.07.2026 08:00'), '"02.07.2026 08:00"');
  assert.throws(() => argument('a\nb'), RangeError);
  assert.equal(safeName('mc.3'), 'mc.3');
  assert.throws(() => safeName('bai;info'), RangeError);
  assert.throws(() => safeName('a b'), RangeError);
});

test('definitions of ebusd 26.1: kinds, levels, fields, conditions, quoted comments', () => {
  assert.ok(definitions.length > 200);
  const status = definitions.find((item) => item.circuit === 'bai' && item.name === 'Status01');
  assert.equal(status.direction, 'read');
  assert.equal(status.zz, '08');
  assert.deepEqual(
    status.fields.map((field) => [field.name, field.type, field.unit]),
    [
      ['temp', 'D1C', '°C'],
      ['temp_1', 'D1C', '°C'],
      ['temp_2', 'D2B', '°C'],
      ['temp_3', 'D1C', '°C'],
      ['temp_4', 'D1C', '°C'],
      ['pumpstate', 'UCH', ''],
    ],
  );
  assert.deepEqual(status.fields[5].values, { 0: 'off', 1: 'on', 2: 'overrun', 4: 'hwc' });
  const outside = definitions.find((item) => item.name === 'Outsidetemp');
  assert.equal(outside.direction, 'passive');
  assert.equal(outside.fields[0].part, 'm');
  const installWrite = definitions.find(
    (item) => item.direction === 'write' && item.name === 'AccessoriesOne',
  );
  assert.equal(installWrite.level, 'install');
  assert.ok(
    definitions.some((item) => item.conditional),
    'the [id_sw>=413] messages',
  );
  const vortex = definitions.find((item) => item.name === 'VortexFlowSensor');
  assert.match(vortex.comment, /, CH water flow$/);
  const day = definitions.find((item) => item.circuit === '700' && item.name === 'Z1DayTemp');
  assert.deepEqual(
    valueFields(day).map((field) => field.name),
    ['value'],
    'IGN fields carry no value',
  );
  assert.equal(parseDefinition(''), null);
  assert.equal(parseDefinition('x,bai,,Name,,08'), null);
});

test('info: version, signal, participants, their identification and configuration', () => {
  assert.equal(info.version, '26.1.26.1');
  assert.equal(info.signal, false);
  assert.equal(info.messages, 236);
  const boiler = info.participants.find((item) => item.address === '08');
  assert.equal(boiler.role, 'slave');
  assert.deepEqual(boiler.ident, { MF: 'Vaillant', ID: 'BAI00', SW: '0327', HW: '7201' });
  assert.deepEqual(boiler.files, ['vaillant/bai.308523.inc', 'vaillant/08.bai.csv']);
  assert.ok(info.participants.find((item) => item.address === '31').self);
  assert.equal(parseInfo('signal: acquired\nsymbol rate: 42').signal, true);
  assert.equal(parseInfo('signal: acquired\nsymbol rate: 42').symbolRate, 42);
  assert.equal(parseState('signal acquired, 42 symbols/sec (187 max), 3 masters'), true);
  assert.equal(parseState('no signal'), false);
});

test('value lines: read, find and listen formats, errors, no data', () => {
  assert.deepEqual(parseValueLine('Broadcast Outsidetemp value=5.062', true), {
    circuit: 'Broadcast',
    name: 'Outsidetemp',
    values: { value: '5.062' },
    error: null,
  });
  const listen = parseValueLine('bai Status01 = temp=40.0;temp_1=35.0;temp_2=3.133;temp_3=', true);
  assert.deepEqual(listen.values, { temp: '40.0', temp_1: '35.0', temp_2: '3.133', temp_3: '' });
  const partial = parseValueLine(
    'bai Status01 = temp=40.0 (ERR: argument value out of valid range for 1008b5110101 / 09)',
    true,
  );
  assert.deepEqual(partial.values, { temp: '40.0' });
  assert.match(partial.error, /out of valid range/);
  assert.equal(
    parseValueLine('700 DisplayedOutsideTemp = no data stored', true).error,
    'no data stored',
  );
  assert.deepEqual(parseValueLine('time=08:00:00;date=02.07.2026').values, {
    time: '08:00:00',
    date: '02.07.2026',
  });
});

test('catalog: circuits, useful and essential messages only, never install / service ones', () => {
  const circuits = catalog();
  assert.deepEqual([...circuits.keys()].sort(), ['700', 'bai', 'broadcast']);
  const bai = circuits.get('bai');
  assert.equal(bai.address, '08');
  assert.equal(bai.ident.ID, 'BAI00');
  const keys = bai.features.map((item) => item.key);
  // Seen and useful.
  assert.ok(keys.includes('status01.temp'));
  assert.ok(keys.includes('flame.value'));
  assert.ok(keys.includes('pumppower.value') === false, 'PumpPower has no unit: no category');
  // Essential, read even unseen.
  assert.ok(keys.includes('waterpressure.press'));
  assert.ok(keys.includes('flowtemp.temp'));
  // Seen but without a useful name (DSN) or a category: left out.
  assert.ok(!keys.includes('dsn.value'));
  // A sensor state next to its value is noise.
  assert.ok(!keys.some((key) => key.endsWith('.sensor')));
  // The pending error only.
  assert.deepEqual(
    keys.filter((key) => key.startsWith('currenterror')),
    ['currenterror.error'],
  );
  // The controller's "install" write is never writable.
  for (const circuit of circuits.values()) {
    for (const item of circuit.features) {
      assert.ok(!/accessories|maxflowtempdesired/i.test(item.message), item.key);
    }
  }
  // Every message is read: "all seen" adds the seen ones without a useful name.
  const all = buildCatalog({ definitions, withData, info, allSeen: true });
  assert.ok(all.get('bai').features.some((item) => item.key === 'dsn.value') === false);
  const extra = buildCatalog({
    definitions,
    withData: new Set(),
    info,
    extra: new Set(['bai.hwcimpellorswitch']),
  });
  assert.ok(extra.get('bai').features.some((item) => item.key === 'hwcimpellorswitch.value'));
});

test('catalog: Gladys shapes by unit and kind; writable targets within fixed bounds', () => {
  const circuits = catalog();
  const pick = (circuit, key) => feature(circuits, circuit, key).feature;
  assert.deepEqual(
    [pick('bai', 'status01.temp').category, pick('bai', 'status01.temp').unit],
    ['temperature-sensor', 'celsius'],
  );
  assert.equal(pick('bai', 'waterpressure.press').category, 'pressure-sensor');
  assert.equal(pick('bai', 'waterpressure.press').unit, 'bar');
  assert.deepEqual(
    [pick('bai', 'hchours.value').category, pick('bai', 'hchours.value').unit],
    ['duration', 'hours'],
  );
  assert.equal(pick('bai', 'hcstarts.value').category, 'counter-sensor');
  assert.deepEqual(
    [pick('bai', 'flame.value').category, pick('bai', 'flame.value').read_only],
    ['switch', true],
  );
  assert.deepEqual(
    [pick('bai', 'status01.pumpstate').category, pick('bai', 'status01.pumpstate').type],
    ['text', 'text'],
  );
  assert.equal(pick('bai', 'currenterror.error').category, 'text');
  // The boiler shows its hot water target, the controller sets it.
  assert.equal(pick('bai', 'hwctempdesired.value').read_only, true);
  const dhw = pick('700', 'hwctempdesired.value');
  assert.deepEqual(
    [dhw.category, dhw.type, dhw.min, dhw.max, dhw.step, dhw.read_only],
    ['water-heater', 'target-temperature', DHW_TARGET.min, DHW_TARGET.max, 0.5, false],
  );
  const room = pick('700', 'z1daytemp.value');
  assert.deepEqual(
    [room.category, room.type, room.min, room.max, room.read_only],
    ['thermostat', 'target-temperature', ROOM_TARGET.min, ROOM_TARGET.max, false],
  );
  const mode = pick('700', 'z1opmode.value');
  assert.deepEqual([mode.category, mode.type, mode.read_only], ['text', 'select', false]);
  assert.deepEqual(
    mode.supported_options.map((option) => option.value),
    ['off', 'auto', 'day', 'night'],
  );
  assert.equal(pick('700', 'z1roomtemp.value').read_only, true);
  // Every feature has what Gladys requires.
  for (const circuit of circuits.values()) {
    for (const item of circuit.features) {
      for (const key of ['category', 'type', 'min', 'max', 'read_only', 'has_feedback']) {
        assert.notEqual(item.feature[key], undefined, `${item.key}.${key}`);
      }
      assert.match(item.key, /^[a-z0-9_-]+\.[a-z0-9_-]+$/);
    }
  }
});

test('values: ebusd text -> Gladys, Gladys -> ebusd within bounds', () => {
  const circuits = catalog();
  const get = (circuit, key) => feature(circuits, circuit, key);
  assert.equal(toGladysValue(get('bai', 'status01.temp'), '55.5'), 55.5);
  assert.equal(toGladysValue(get('bai', 'status01.temp'), '-'), null);
  assert.equal(toGladysValue(get('bai', 'status01.temp'), ''), null);
  assert.equal(toGladysValue(get('bai', 'flame.value'), 'on'), 1);
  assert.equal(toGladysValue(get('bai', 'flame.value'), 'off'), 0);
  assert.equal(toGladysValue(get('bai', 'flame.value'), '77'), null);
  assert.deepEqual(toGladysValue(get('bai', 'status01.pumpstate'), 'overrun'), { text: 'overrun' });
  assert.deepEqual(toGladysValue(get('bai', 'currenterror.error'), '-'), { text: '' });
  assert.deepEqual(toGladysValue(get('bai', 'currenterror.error'), '28'), { text: '28' });
  const dhw = get('700', 'hwctempdesired.value');
  assert.equal(toEbusdValue(dhw, 52.3), '52.5');
  assert.throws(() => toEbusdValue(dhw, 80), RangeError);
  assert.throws(() => toEbusdValue(dhw, 'hot'), RangeError);
  const room = get('700', 'z1daytemp.value');
  assert.equal(toEbusdValue(room, 21), '21');
  assert.throws(() => toEbusdValue(room, 4), RangeError);
  const mode = get('700', 'z1opmode.value');
  assert.equal(toEbusdValue(mode, 'night'), 'night');
  assert.throws(() => toEbusdValue(mode, 'party'), RangeError);
  assert.throws(() => toEbusdValue(get('bai', 'status01.temp'), 20), RangeError);
});

test('names: circuits, features, humanized ebusd names', () => {
  assert.equal(humanize('FlowTempDesired'), 'Flow temp desired');
  assert.equal(humanize('HwcOpMode'), 'Hwc op mode');
  assert.equal(featureKey('Status01', 'temp_1'), 'status01.temp_1');
  assert.equal(circuitKind('bai'), 'boiler');
  assert.equal(circuitKind('hmu'), 'heatpump');
  assert.equal(circuitKind('700'), 'controller');
  assert.equal(circuitKind('ctlv2'), 'controller');
  assert.equal(circuitKind('mc.3'), 'mixer');
  assert.equal(circuitKind('Broadcast'), 'broadcast');
  const circuits = catalog();
  assert.equal(circuitName(circuits.get('bai'), 'fr'), 'Chaudière bai (Vaillant BAI00)');
  assert.equal(circuitName(circuits.get('broadcast'), 'de'), 'eBUS-Rundruf');
});

const BASELINE = new URL('./fixtures/discovery.baseline.json', import.meta.url);

test('discovery baseline: the Gladys fields of every feature never change by accident', () => {
  const gladys = {
    externalIds: (type, id) => ({
      device: `ext:test:${type}:${id}`,
      feature: (key) => `ext:test:${type}:${id}:${key}`,
    }),
  };
  const devices = buildDevices(gladys, {
    circuits: catalog(),
    info,
    host: '192.168.1.30',
    port: 8888,
    language: 'en',
  });
  const pinned = devices.map((device) => ({
    external_id: device.external_id,
    features: device.features.map((item) =>
      Object.fromEntries(
        ['external_id', 'category', 'type', 'unit', 'min', 'max', 'step', 'read_only'].map(
          (key) => [key, item[key] ?? null],
        ),
      ),
    ),
  }));
  if (process.env.UPDATE_BASELINE) {
    writeFileSync(BASELINE, `${JSON.stringify(pinned, null, 2)}\n`);
  }
  assert.deepEqual(pinned, JSON.parse(readFileSync(BASELINE, 'utf8')));
});
