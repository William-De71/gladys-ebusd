// -----------------------------------------------------------------------------
// ebusd definitions -> what Gladys shows.
//
// ebusd knows hundreds of messages per device (a Vaillant boiler alone has
// about 230, most of them installer settings). Gladys gets, per circuit (one
// eBUS device: the boiler "bai", the controller "700", a mixer "mc"…), the
// fields that:
//
//   1. belong to a read message (active or passive) open to everyone (an
//      empty access level: never "install" or "service");
//   2. have a Gladys category: °C, K, bar, mbar, %, W, kW, Wh, kWh, MWh, h,
//      min, s, V, A, a start counter, an on/off or yes/no state, a list of
//      named values, an error code;
//   3. are worth it: ebusd has seen data for the message on the bus and its
//      name looks useful (temperatures, pressure, modes, flame, power,
//      energy, hours, starts, errors…), or it is one of the well-known
//      messages of ESSENTIALS (read even before ebusd saw it), or the user
//      listed it, or the user chose "every message with data".
//
// A field is writable only when a write message of the same circuit and
// name exists, open to everyone, with a single value field, and it is a
// temperature target (room or hot water, within fixed bounds) or a list of
// named values (an operating mode). Writes stay refused until the user
// allows them (src/writes.js).
//
// Feature keys are `<message>.<field>` in lower case (ebusd names are case
// insensitive and their case changed between configuration releases). They
// are forever, like the Gladys category, type, unit and bounds chosen here:
// the discovery baseline of the tests pins them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { valueFields } from './protocol.js';

// Circuits that are not eBUS devices.
const SKIPPED_CIRCUITS = /^scan(\.|$)|^memory$|^general$/i;

// Message names worth a feature once ebusd has data for them.
export const USEFUL_NAME =
  /temp|press|status|state|mode|flame|modulation|power|energy|yield|consum|hours|starts|count|runtime|error|fault|pump|burner|compressor|humid|curve|demand|load|party|holiday|hwc|dhw|setpoint|desired/i;

// Messages read even before ebusd saw data for them (polled by the
// integration). Lower case. They exist on most Vaillant / Saunier Duval
// installations (boiler bai, heat pump hmu, controllers 700 / 720 / ctlv2),
// and Wolf and Kromschröder ones (circuits of their own configuration).
export const ESSENTIALS = new Set([
  // Boiler (bai) and heat pump (hmu)
  'flowtemp',
  'returntemp',
  'flowtempdesired',
  'hwctemp',
  'hwctempdesired',
  'storagetemp',
  'waterpressure',
  'flame',
  'modulationtempdesired',
  'pumppower',
  'hchours',
  'hwchours',
  'hcstarts',
  'hwcstarts',
  'currenterror',
  'outdoorstemp',
  'outsidetemp',
  'currentcompressorutil',
  'currentconsumedpower',
  'currentyieldpower',
  'compressorstarts',
  'compressorhours',
  'yieldtotal',
  'energyintegral',
  // Controllers (700, 720, ctlv2, ctlv3)
  'displayedoutsidetemp',
  'systemflowtemp',
  'z1roomtemp',
  'z1daytemp',
  'z1nighttemp',
  'z1opmode',
  'z1actualroomtempdesired',
  'hwcopmode',
  'hwcstoragetemp',
  'hc1flowtemp',
  'hc1actualflowtempdesired',
  'hc1pumpstatus',
]);

// The well-known messages, for a name better than the raw ebusd one, and a
// role used by the widgets.
export const KNOWN = {
  flowtemp: { role: 'flow', label: 'flow' },
  hc1flowtemp: { role: 'flow', label: 'flow' },
  systemflowtemp: { role: 'flow', label: 'system_flow' },
  returntemp: { role: 'return', label: 'return' },
  flowtempdesired: { label: 'flow_target' },
  hc1actualflowtempdesired: { label: 'flow_target' },
  hwctemp: { role: 'dhw', label: 'dhw' },
  storagetemp: { role: 'dhw', label: 'storage' },
  hwcstoragetemp: { role: 'dhw', label: 'storage' },
  hwctempdesired: { role: 'dhw_target', label: 'dhw_target' },
  waterpressure: { role: 'pressure', label: 'pressure' },
  flame: { role: 'flame', label: 'flame' },
  modulationtempdesired: { role: 'modulation', label: 'modulation' },
  currentcompressorutil: { role: 'modulation', label: 'compressor' },
  pumppower: { label: 'pump' },
  hchours: { label: 'heating_hours' },
  hwchours: { label: 'dhw_hours' },
  hcstarts: { label: 'heating_starts' },
  hwcstarts: { label: 'dhw_starts' },
  compressorhours: { label: 'compressor_hours' },
  compressorstarts: { label: 'compressor_starts' },
  currenterror: { role: 'error', label: 'error' },
  outdoorstemp: { role: 'outdoor', label: 'outdoor' },
  outsidetemp: { role: 'outdoor', label: 'outdoor' },
  displayedoutsidetemp: { role: 'outdoor', label: 'outdoor' },
  z1roomtemp: { role: 'room', label: 'room' },
  z1daytemp: { role: 'room_target', label: 'room_day' },
  z1nighttemp: { label: 'room_night' },
  z1actualroomtempdesired: { label: 'room_target' },
  z1opmode: { role: 'mode', label: 'heating_mode' },
  hwcopmode: { role: 'dhw_mode', label: 'dhw_mode' },
  hc1pumpstatus: { label: 'pump' },
  currentconsumedpower: { role: 'power', label: 'power_in' },
  currentyieldpower: { label: 'power_out' },
  yieldtotal: { label: 'yield' },
};

// Fields of multi-field messages with a well-known meaning (`message.field`).
// Vaillant boilers answer Status01 with flow, return, outdoor, hot water and
// tank temperatures and the pump state, all at once.
export const KNOWN_FIELDS = {
  'status01.temp': { role: 'flow', label: 'flow' },
  'status01.temp_1': { role: 'return', label: 'return' },
  'status01.temp_2': { role: 'outdoor', label: 'outdoor' },
  'status01.temp_3': { role: 'dhw', label: 'dhw' },
  'status01.temp_4': { label: 'storage' },
  'status01.pumpstate': { label: 'pump' },
};

// Bounds of the writable temperatures (never wider, refused outside).
export const ROOM_TARGET = { min: 5, max: 30, step: 0.5 };
export const DHW_TARGET = { min: 35, max: 70, step: 0.5 };

const NUMERIC_TYPE =
  /^(D1B|D1C|D2B|D2C|DATA1B|DATA1C|DATA2B|DATA2C|FLT|FLR|EXP|EXR|UCH|SCH|UIN|SIN|ULG|SLG|UIR|SIR|ULR|SLR|U3N|S3N|U3R|S3R|BCD|HCD|PIN|BI\d|NUM)/;
const TEXT_TYPE = /^(STR|NTS|HEX|BDA|HDA|DAY|BTI|HTI|VTI|BTM|HTM|VTM|MIN|TTM|TTH|TTQ|BDY|HDY)/;

const sensor = (category, type, unit, min, max) => ({
  category,
  type,
  ...(unit ? { unit } : {}),
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

/** The Gladys shape of a numeric field, by its unit and name. */
function numericShape(unit, name) {
  const u = unit.trim();
  const lower = name.toLowerCase();
  if (u === '°C' || u === 'C' || (u === 'K' && /temp/.test(lower))) {
    return sensor(CAT.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.CELSIUS, -50, 150);
  }
  if (u === 'bar') {
    return sensor(CAT.PRESSURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.BAR, 0, 10);
  }
  if (u === 'mbar') {
    return sensor(CAT.PRESSURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.MILLIBAR, 0, 10000);
  }
  if (u === '%') {
    return /humid/.test(lower)
      ? sensor(CAT.HUMIDITY_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.PERCENT, 0, 100)
      : sensor(CAT.LEVEL_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.PERCENT, 0, 100);
  }
  if (u === 'W') {
    return sensor(CAT.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.POWER, UNITS.WATT, 0, 100000);
  }
  if (u === 'kW') {
    return sensor(CAT.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.POWER, UNITS.KILOWATT, 0, 1000);
  }
  if (u === 'Wh' || u === 'kWh' || u === 'MWh') {
    const unitOf = { Wh: UNITS.WATT_HOUR, kWh: UNITS.KILOWATT_HOUR, MWh: UNITS.MEGAWATT_HOUR };
    return sensor(CAT.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.ENERGY, unitOf[u], 0, 1000000000);
  }
  if (u === 'V') {
    return sensor(CAT.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.VOLTAGE, UNITS.VOLT, 0, 1000);
  }
  if (u === 'A') {
    return sensor(CAT.ENERGY_SENSOR, TYPES.ENERGY_SENSOR.CURRENT, UNITS.AMPERE, 0, 1000);
  }
  if (u === 'h') {
    return sensor(CAT.DURATION, TYPES.DURATION.DECIMAL, UNITS.HOURS, 0, 10000000);
  }
  if (u === 'min') {
    return sensor(CAT.DURATION, TYPES.DURATION.DECIMAL, UNITS.MINUTES, 0, 10000000);
  }
  if (u === 's') {
    return sensor(CAT.DURATION, TYPES.DURATION.DECIMAL, UNITS.SECONDS, 0, 10000000);
  }
  if (!u && /starts|count|cycles/.test(lower)) {
    return sensor(CAT.COUNTER_SENSOR, TYPES.SENSOR.INTEGER, undefined, 0, 1000000000);
  }
  return null;
}

const BINARY_SETS = [
  ['off', 'on'],
  ['no', 'yes'],
];

/** `{ 0: 'off', 1: 'on' }` -> `{ on: 'on', off: 'off' }` when it is a two-state list. */
function binaryOf(values) {
  const names = [...new Set(Object.values(values).map((value) => value.toLowerCase()))].sort();
  const set = BINARY_SETS.find(
    ([a, b]) => names.length === 2 && names.includes(a) && names.includes(b),
  );
  if (!set) {
    return null;
  }
  const original = (wanted) =>
    Object.values(values).find((value) => value.toLowerCase() === wanted);
  return { off: original(set[0]), on: original(set[1]) };
}

const textFeature = () => ({
  category: CAT.TEXT,
  type: TYPES.TEXT.TEXT,
  min: 0,
  max: 0,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

/**
 * @description The Gladys shape and value kind of one field, or null.
 * @param {object} message - Read definition.
 * @param {object} field - Value field.
 * @param {object|null} write - The matching single-field write definition, if open to everyone.
 * @returns {object|null} `{ kind, feature, binary?, options?, bounds? }`.
 */
export function shapeOf(message, field, write) {
  const name = `${message.name} ${field.name}`;
  const lower = message.name.toLowerCase();
  if (field.values) {
    const binary = binaryOf(field.values);
    if (binary) {
      return {
        kind: 'binary',
        binary,
        feature: {
          ...sensor(CAT.SWITCH, TYPES.SWITCH.BINARY, undefined, 0, 1),
          ...(write ? { read_only: false, has_feedback: true } : {}),
        },
      };
    }
    const options = [...new Set(Object.values(field.values))];
    return {
      kind: 'select',
      options,
      feature: {
        category: CAT.TEXT,
        type: write ? TYPES.TEXT.SELECT : TYPES.TEXT.TEXT,
        min: 0,
        max: 0,
        read_only: !write,
        has_feedback: Boolean(write),
        keep_history: false,
        ...(write ? { supported_options: options.map((value) => ({ value, label: value })) } : {}),
      },
    };
  }
  if (/error|fault/i.test(lower) && !field.unit && NUMERIC_TYPE.test(field.type)) {
    return { kind: 'error', feature: textFeature() };
  }
  if (NUMERIC_TYPE.test(field.type)) {
    const shape = numericShape(field.unit, name);
    if (!shape) {
      return null;
    }
    if (write && shape.category === CAT.TEMPERATURE_SENSOR && !/flow|return/.test(lower)) {
      if (/hwc|dhw|storage|ww|water/.test(lower)) {
        return {
          kind: 'number',
          bounds: DHW_TARGET,
          feature: {
            category: CAT.WATER_HEATER,
            type: TYPES.WATER_HEATER.TARGET_TEMPERATURE,
            unit: UNITS.CELSIUS,
            min: DHW_TARGET.min,
            max: DHW_TARGET.max,
            step: DHW_TARGET.step,
            read_only: false,
            has_feedback: true,
            keep_history: true,
          },
        };
      }
      if (/room|day|night|comfort|eco|setback|desired|^z\d/.test(lower)) {
        return {
          kind: 'number',
          bounds: ROOM_TARGET,
          feature: {
            category: CAT.THERMOSTAT,
            type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
            unit: UNITS.CELSIUS,
            min: ROOM_TARGET.min,
            max: ROOM_TARGET.max,
            step: ROOM_TARGET.step,
            read_only: false,
            has_feedback: true,
            keep_history: true,
          },
        };
      }
    }
    return { kind: 'number', feature: shape };
  }
  if (TEXT_TYPE.test(field.type) && /error|fault/i.test(lower)) {
    return { kind: 'error', feature: textFeature() };
  }
  return null;
}

/** A key part: lower case, only letters, digits, `_` and `-`. */
export const keyPart = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_');

/**
 * @description The feature key of a field.
 * @param {string} message - Message name.
 * @param {string} field - Field name.
 * @returns {string} `<message>.<field>`.
 */
export const featureKey = (message, field) => `${keyPart(message)}.${keyPart(field)}`;

/** "FlowTempDesired" -> "Flow temp desired". */
export function humanize(name) {
  const words = String(name ?? '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : '';
}

// The state of a sensor next to its value (ok / short circuit / cut off):
// noise in Gladys, the value itself is null when the sensor fails.
const SENSOR_STATE_FIELD = /^sensor(status|state)?(_\d+)?$/i;

const GENERIC_FIELD =
  /^(value|temp|tempv|onoff|yesno|status|state|error|power|energy|hours|starts|count)(_\d+)?$/i;

/**
 * @description Group the definitions per circuit, decide the features.
 * @param {object} input - Input.
 * @param {object[]} input.definitions - `parseDefinitions` result.
 * @param {Set<string>} input.withData - `circuit.name` (lower case) of the messages that have data.
 * @param {object} [input.info] - `parseInfo` result.
 * @param {boolean} [input.allSeen] - Every mappable message with data, useful name or not.
 * @param {Set<string>} [input.extra] - `circuit.name` (lower case) the user listed.
 * @param {number} [input.maxPerCircuit] - Feature cap per circuit.
 * @returns {Map<string, object>} circuit key -> `{ key, circuit, address, ident, features }`.
 */
export function buildCatalog({
  definitions,
  withData,
  info = null,
  allSeen = false,
  extra = new Set(),
  maxPerCircuit = 80,
}) {
  const reads = [];
  const writes = new Map();
  for (const definition of definitions) {
    if (SKIPPED_CIRCUITS.test(definition.circuit)) {
      continue;
    }
    const id = `${definition.circuit}.${definition.name}`.toLowerCase();
    if (definition.direction === 'write') {
      if (!definition.level && !definition.conditional) {
        const fields = valueFields(definition).filter((field) => field.part === 'm');
        if (fields.length === 1) {
          writes.set(id, { definition, field: fields[0] });
        }
      }
      continue;
    }
    if (!definition.level) {
      reads.push(definition);
    }
  }

  const byAddress = new Map(
    (info?.participants ?? []).map((participant) => [participant.address, participant]),
  );
  const circuits = new Map();
  const seenKeys = new Set();
  for (const message of reads) {
    const id = `${message.circuit}.${message.name}`.toLowerCase();
    const lower = message.name.toLowerCase();
    const hasData = withData.has(id);
    const wanted =
      extra.has(id) ||
      ESSENTIALS.has(lower) ||
      (hasData && (allSeen || USEFUL_NAME.test(message.name)));
    if (!wanted) {
      continue;
    }
    // The value fields of a read: the answer (s), and for a passive message
    // what the sender broadcast (m).
    let fields = valueFields(message).filter(
      (field) =>
        (message.direction === 'passive' || field.part === 's') &&
        !(field.values && SENSOR_STATE_FIELD.test(field.name)),
    );
    if (/error|fault/i.test(message.name) && fields.length > 1) {
      // "Currenterror": the first code is the one pending, the others older.
      fields = fields.slice(0, 1);
    }
    const circuitKey = keyPart(message.circuit);
    let circuit = circuits.get(circuitKey);
    if (!circuit) {
      const participant = byAddress.get(message.zz);
      circuit = {
        key: circuitKey,
        circuit: message.circuit,
        address: message.zz && message.zz !== 'fe' ? message.zz : null,
        ident: participant?.ident ?? {},
        features: [],
      };
      circuits.set(circuitKey, circuit);
    }
    const write = fields.length === 1 ? (writes.get(id) ?? null) : null;
    fields.forEach((field, index) => {
      const shape = shapeOf(message, field, write);
      if (!shape) {
        return;
      }
      const key = featureKey(message.name, field.name || `field${index}`);
      const uniqueKey = `${circuitKey}:${key}`;
      if (seenKeys.has(uniqueKey)) {
        return; // conditional variants of the same message
      }
      seenKeys.add(uniqueKey);
      const known =
        fields.length === 1 ? KNOWN[lower] : KNOWN_FIELDS[`${lower}.${field.name.toLowerCase()}`];
      circuit.features.push({
        key,
        circuit: message.circuit,
        message: message.name,
        field: field.name,
        single: fields.length === 1,
        passive: message.direction === 'passive',
        essential: ESSENTIALS.has(lower),
        hasData,
        role: known?.role ?? null,
        labelKey: known?.label ?? null,
        name: humanize(message.name),
        fieldName:
          fields.length === 1
            ? ''
            : GENERIC_FIELD.test(field.name) && field.comment
              ? field.comment
              : humanize(field.name),
        comment: field.comment || message.comment,
        unit: field.unit,
        values: field.values,
        writable: Boolean(write) && shape.feature.read_only === false,
        ...shape,
      });
    });
  }
  for (const circuit of circuits.values()) {
    // Most useful first; a capped circuit keeps the essentials and the seen ones.
    circuit.features.sort(
      (a, b) =>
        Number(b.essential) - Number(a.essential) ||
        Number(b.hasData) - Number(a.hasData) ||
        a.key.localeCompare(b.key),
    );
    circuit.features = circuit.features.slice(0, maxPerCircuit);
    circuit.features.sort((a, b) => a.key.localeCompare(b.key));
  }
  for (const [key, circuit] of circuits) {
    if (circuit.features.length === 0) {
      circuits.delete(key);
    }
  }
  return circuits;
}

/**
 * @description The Gladys value of a field value read from ebusd.
 * @param {object} feature - Catalog feature.
 * @param {string|undefined} raw - Value text.
 * @returns {number|{text: string}|null} The value, null when unknown.
 */
export function toGladysValue(feature, raw) {
  if (raw === undefined || raw === null) {
    return null;
  }
  const text = String(raw).trim();
  if (feature.kind === 'binary') {
    const lower = text.toLowerCase();
    if (lower === feature.binary.on.toLowerCase()) {
      return 1;
    }
    if (lower === feature.binary.off.toLowerCase()) {
      return 0;
    }
    return null;
  }
  if (feature.kind === 'select') {
    return text && text !== '-' ? { text: text.slice(0, 200) } : null;
  }
  if (feature.kind === 'error') {
    // "-" (or nothing) when no error is pending.
    return { text: text === '-' || text === '' ? '' : text.slice(0, 200) };
  }
  if (text === '' || text === '-') {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * @description The value to write for a Gladys value, or a RangeError.
 * @param {object} feature - Catalog feature (writable).
 * @param {number|string} value - Gladys value.
 * @returns {string} The ebusd value.
 */
export function toEbusdValue(feature, value) {
  if (feature.kind === 'binary') {
    const number = Number(value);
    if (number !== 0 && number !== 1) {
      throw new RangeError(String(value).slice(0, 40));
    }
    return number === 1 ? feature.binary.on : feature.binary.off;
  }
  if (feature.kind === 'select') {
    const wanted = String(value ?? '');
    const option = feature.options.find((item) => item === wanted);
    if (!option) {
      throw new RangeError(wanted.slice(0, 40));
    }
    return option;
  }
  if (feature.kind === 'number' && feature.bounds) {
    const number = Number(value);
    const { min, max, step } = feature.bounds;
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new RangeError(`${String(value).slice(0, 20)} (${min}–${max})`);
    }
    return String(Math.round(number / step) * step);
  }
  throw new RangeError('read only');
}
