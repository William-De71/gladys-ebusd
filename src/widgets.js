// -----------------------------------------------------------------------------
// Dashboard widgets.
//
//   heating   the house at a glance: outdoor, flow, return, room and hot
//             water temperatures, pressure, flame, error, modes (from every
//             eBUS device; tiles follow the device states live once the
//             devices are created)
//   history   the curves of these temperatures (a day, three days, a week)
//   bus       ebusd and the eBUS: signal, symbol rate, the devices seen on
//             the bus with their model, software and configuration
//
// Pure: the build functions turn a view into a content, so the tests and
// docs/illustrations/gen.mjs use the exact code Gladys gets. Every text is
// multi-language: Gladys caches the content per language.
// -----------------------------------------------------------------------------

import { number, t, truncate } from './i18n.js';

export const WIDGETS = { HEATING: 'heating', HISTORY: 'history', BUS: 'bus' };
export const HISTORY_PERIODS = ['last-day', 'last-three-days', 'last-week'];
const TTL = { heating: 60, history: 300, bus: 120 };
const MAX_PARTICIPANTS = 8;

// The tiles, in order: role -> label key and color.
export const TILE_ROLES = [
  ['outdoor', 'widgetOutdoor', undefined],
  ['flow', 'widgetFlow', 'primary'],
  ['return', 'widgetReturn', undefined],
  ['room', 'widgetRoom', undefined],
  ['dhw', 'widgetHotWater', 'info'],
  ['pressure', 'widgetPressure', undefined],
  ['modulation', 'widgetModulation', undefined],
  ['power', 'widgetPower', 'primary'],
];
export const HISTORY_ROLES = ['outdoor', 'flow', 'return', 'dhw'];

/**
 * @typedef {object} RoleValue
 * @property {number|string|null} value - Last value (number, or text).
 * @property {string} [unit] - Unit shown (°C, bar, %…).
 * @property {string|null} featureId - External id when the device is created (live tile).
 */

/**
 * @typedef {object} HeatingView
 * @property {boolean} reachable - ebusd answers.
 * @property {boolean} signal - The adapter hears the bus.
 * @property {Record<string, RoleValue>} roles - Values by role (flow, dhw, flame, error, mode…).
 * @property {boolean} anyCircuit - ebusd knows at least one circuit.
 */

const empty = (key, message) => ({
  version: 1,
  ttl_seconds: TTL[key],
  components: [{ type: 'text', text: t(message), variant: 'caption' }],
});

const rounded = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const tile = (role, label, color, entry) => {
  if (!entry) {
    return null;
  }
  if (entry.featureId) {
    return {
      type: 'value',
      label: t(label),
      device_feature: entry.featureId,
      ...(color ? { color } : {}),
    };
  }
  if (typeof entry.value !== 'number') {
    return null;
  }
  const digits = role === 'pressure' ? 2 : role === 'power' || role === 'modulation' ? 0 : 1;
  return {
    type: 'value',
    label: t(label),
    value: rounded(entry.value, digits),
    ...(entry.unit ? { unit: entry.unit } : {}),
    ...(color ? { color } : {}),
  };
};

const unreachable = () => ({
  type: 'status',
  items: [{ label: t('widgetEbusd'), value: t('widgetOffline'), color: 'danger' }],
});

/**
 * @description The `heating` widget.
 * @param {HeatingView|null} view - The view.
 * @returns {object} The widget content.
 */
export function buildHeatingWidget(view) {
  if (!view) {
    return empty(WIDGETS.HEATING, 'widgetNoEbusd');
  }
  if (!view.anyCircuit) {
    return empty(WIDGETS.HEATING, view.reachable ? 'widgetNoCircuit' : 'widgetNoEbusd');
  }
  const components = TILE_ROLES.map(([role, label, color]) =>
    tile(role, label, color, view.roles[role]),
  )
    .filter(Boolean)
    .slice(0, 6);
  if (components.length === 0) {
    components.push({ type: 'text', text: t('widgetNoValueYet'), variant: 'caption' });
  }
  if (!view.reachable) {
    components.push(unreachable());
    return { version: 1, ttl_seconds: TTL.heating, components };
  }
  const items = [];
  if (!view.signal) {
    items.push({ label: t('widgetBus'), value: t('widgetNoSignal'), color: 'danger' });
  }
  const flame = view.roles.flame?.value;
  if (flame === 0 || flame === 1) {
    items.push({
      label: t('widgetFlame'),
      value: t(flame ? 'widgetOn' : 'widgetOff'),
      color: flame ? 'warning' : 'neutral',
    });
  }
  for (const [role, label] of [
    ['mode', 'widgetHeatingMode'],
    ['dhw_mode', 'widgetHotWaterMode'],
  ]) {
    const value = view.roles[role]?.value;
    if (typeof value === 'string' && value) {
      items.push({ label: t(label), value: truncate(value, 24), color: 'neutral' });
    }
  }
  const target = view.roles.dhw_target?.value;
  if (typeof target === 'number') {
    items.push({ label: t('widgetHotWaterTarget'), value: number(target, 1, '°C'), color: 'info' });
  }
  const error = view.roles.error;
  if (error && typeof error.value === 'string') {
    items.push(
      error.value
        ? { label: t('widgetError'), value: truncate(error.value, 24), color: 'danger' }
        : { label: t('widgetError'), value: t('widgetNone'), color: 'success' },
    );
  }
  if (items.length > 0) {
    components.push({ type: 'status', items: items.slice(0, 6) });
  }
  return { version: 1, ttl_seconds: TTL.heating, components };
}

/**
 * @description The `history` widget.
 * @param {HeatingView|null} view - The view.
 * @param {string} [period] - One of HISTORY_PERIODS.
 * @returns {object} The widget content.
 */
export function buildHistoryWidget(view, period = HISTORY_PERIODS[0]) {
  if (!view?.anyCircuit) {
    return empty(WIDGETS.HISTORY, view?.reachable ? 'widgetNoCircuit' : 'widgetNoEbusd');
  }
  const features = HISTORY_ROLES.map((role) => view.roles[role]?.featureId).filter(Boolean);
  if (features.length === 0) {
    return empty(WIDGETS.HISTORY, 'widgetAddDevice');
  }
  const components = [
    {
      type: 'chart',
      title: t('widgetTemperatures'),
      chart_type: 'line',
      device_features: features.slice(0, 4),
      interval: HISTORY_PERIODS.includes(period) ? period : HISTORY_PERIODS[0],
    },
  ];
  if (!view.reachable) {
    components.push(unreachable());
  }
  return { version: 1, ttl_seconds: TTL.history, components };
}

/**
 * @typedef {object} BusView
 * @property {boolean} reachable - ebusd answers.
 * @property {object|null} info - `parseInfo` result.
 * @property {boolean} listening - The live updates connection is up.
 * @property {number} circuits - Circuits with features.
 * @property {string} address - `host:port`.
 */

const participantTitle = (participant) => {
  const model = [participant.ident.MF, participant.ident.ID?.trim()].filter(Boolean).join(' ');
  return truncate(
    `${participant.address.toUpperCase()} · ${model || (participant.self ? 'ebusd' : '?')}`,
    60,
  );
};

/**
 * @description The `bus` widget.
 * @param {BusView|null} view - The view.
 * @returns {object} The widget content.
 */
export function buildBusWidget(view) {
  if (!view?.info) {
    return empty(WIDGETS.BUS, 'widgetNoEbusd');
  }
  const { info } = view;
  const components = [
    {
      type: 'text',
      text: t('widgetBusHeading', { version: info.version ?? '?' }),
      variant: 'heading',
    },
  ];
  const tiles = [
    typeof info.symbolRate === 'number'
      ? { type: 'value', label: t('widgetSymbolRate'), value: info.symbolRate, unit: '/s' }
      : null,
    typeof info.masters === 'number'
      ? { type: 'value', label: t('widgetMasters'), value: info.masters }
      : null,
    typeof info.messages === 'number'
      ? { type: 'value', label: t('widgetMessages'), value: info.messages }
      : null,
  ].filter(Boolean);
  components.push(...tiles);
  const devices = info.participants
    .filter((participant) => participant.role === 'slave' && !participant.self)
    .slice(0, MAX_PARTICIPANTS);
  if (devices.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: devices.map((participant) => {
        const versions = [
          participant.ident.SW ? `SW ${participant.ident.SW}` : null,
          participant.ident.HW ? `HW ${participant.ident.HW}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return {
          title: participantTitle(participant),
          ...(versions ? { subtitle: truncate(versions, 60) } : {}),
          badge:
            participant.files.length > 0
              ? { text: t('widgetConfigLoaded'), color: 'success' }
              : { text: t('widgetNoConfig'), color: 'warning' },
        };
      }),
    });
  }
  const items = view.reachable
    ? [
        {
          label: t('widgetBus'),
          value: t(info.signal ? 'widgetSignal' : 'widgetNoSignal'),
          color: info.signal ? 'success' : 'danger',
        },
        {
          label: t('widgetLive'),
          value: t(view.listening ? 'widgetActive' : 'widgetInactive'),
          color: view.listening ? 'success' : 'warning',
        },
      ]
    : unreachable().items;
  components.push({ type: 'status', items });
  return { version: 1, ttl_seconds: TTL.bus, components };
}
