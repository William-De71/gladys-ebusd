// -----------------------------------------------------------------------------
// The catalog -> Gladys devices.
//
//   daemon            ebusd itself: the eBUS signal (on when the adapter
//                     hears the bus)
//   circuit:<name>    one per eBUS circuit ebusd knows: the boiler "bai",
//                     the heat pump "hmu", the controller "700", a mixer
//                     "mc", the broadcast messages…
//
// External ids: `ext:{selector}:daemon:ebusd[:signal]` and
// `ext:{selector}:circuit:{circuit}[:{message}.{field}]`, lower case. They
// are forever: never rename a type, a circuit key or a feature key.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
} from '@gladysassistant/integration-sdk';
import { text, truncate } from './i18n.js';

export const DEVICE_TYPES = { DAEMON: 'daemon', CIRCUIT: 'circuit' };
export const DAEMON_ID = 'ebusd';
export const SIGNAL_KEY = 'signal';

/**
 * @description The kind of eBUS device behind a circuit name.
 * @param {string} circuit - Circuit name (`bai`, `700`, `mc.3`…).
 * @returns {string} `boiler`, `heatpump`, `controller`, `mixer`, `hwc`, `solar`, `broadcast`, `module`, `other`.
 */
export function circuitKind(circuit) {
  const lower = String(circuit ?? '').toLowerCase();
  if (lower === 'broadcast') {
    return 'broadcast';
  }
  if (/^(bai|bmu|cha|gas|bc|zeo|bk)/.test(lower)) {
    return 'boiler';
  }
  if (/^(hmu|ehp|vwz|hp|wp|recov)/.test(lower)) {
    return 'heatpump';
  }
  if (
    /^(\d{3}|ctl|vrc|b7v|bas|uih|ui$|e7|f\d|calormatic|multimatic|sdr|vai|wai|heb|hep|rcc|bm|cw|cs)/.test(
      lower,
    )
  ) {
    return 'controller';
  }
  if (/^(mc|hc|mm|vr6|vr_6|zm)/.test(lower)) {
    return 'mixer';
  }
  if (/^(hwc|dhw|ww|sm)/.test(lower)) {
    return 'hwc';
  }
  if (/^(sol|sc|solsy)/.test(lower)) {
    return 'solar';
  }
  if (/^(vr|vl|vd|vms|pms|vmd|pmw|v\d|ebus)/.test(lower)) {
    return 'module';
  }
  return 'other';
}

/**
 * @description The name of a circuit device.
 * @param {object} circuit - Catalog circuit.
 * @param {string} language - Language.
 * @returns {string} `Boiler bai (Vaillant BAI00)`.
 */
export function circuitName(circuit, language) {
  const kind = circuitKind(circuit.circuit);
  const base =
    kind === 'broadcast'
      ? text('device_broadcast', language)
      : `${text(`device_${kind}`, language)} ${circuit.circuit}`;
  const model = [circuit.ident?.MF, circuit.ident?.ID?.trim()].filter(Boolean).join(' ');
  return truncate(model ? `${base} (${model})` : base, 120);
}

/**
 * @description The name of a feature.
 * @param {object} feature - Catalog feature.
 * @param {string} language - Language.
 * @returns {string} The name.
 */
export function featureName(feature, language) {
  if (feature.labelKey) {
    return text(`label_${feature.labelKey}`, language);
  }
  return truncate(feature.fieldName ? `${feature.name} – ${feature.fieldName}` : feature.name, 120);
}

const params = (entries) =>
  Object.entries(entries)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([name, value]) => ({ name, value: String(value) }));

/**
 * @description The Gladys devices of an ebusd daemon.
 * @param {object} gladys - SDK client (ids).
 * @param {object} input - `{ circuits, info, host, port, language }`.
 * @returns {object[]} Devices for `publishDiscoveredDevices`.
 */
export function buildDevices(gladys, { circuits, info, host, port, language }) {
  const daemonIds = gladys.externalIds(DEVICE_TYPES.DAEMON, DAEMON_ID);
  const devices = [
    {
      name: text('device_daemon', language),
      external_id: daemonIds.device,
      model: info?.version ? `ebusd ${info.version}` : 'ebusd',
      should_poll: false,
      params: params({ EBUSD_HOST: host, EBUSD_PORT: port }),
      features: [
        {
          name: text('feature_signal', language),
          external_id: daemonIds.feature(SIGNAL_KEY),
          category: CAT.SWITCH,
          type: TYPES.SWITCH.BINARY,
          min: 0,
          max: 1,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
      ],
    },
  ];
  for (const circuit of circuits.values()) {
    const ids = gladys.externalIds(DEVICE_TYPES.CIRCUIT, circuit.key);
    const model = [circuit.ident?.MF, circuit.ident?.ID?.trim()].filter(Boolean).join(' ');
    devices.push({
      name: circuitName(circuit, language),
      external_id: ids.device,
      model: model || `ebusd ${circuit.circuit}`,
      should_poll: false,
      params: params({
        EBUSD_CIRCUIT: circuit.circuit,
        EBUSD_ADDRESS: circuit.address,
        EBUSD_SOFTWARE: circuit.ident?.SW,
        EBUSD_HARDWARE: circuit.ident?.HW,
      }),
      features: circuit.features.map((feature) => ({
        name: featureName(feature, language),
        external_id: ids.feature(feature.key),
        ...feature.feature,
      })),
    });
  }
  return devices;
}
