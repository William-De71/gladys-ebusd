// -----------------------------------------------------------------------------
// Writing on the eBUS, carefully.
//
// A write goes to the boiler or the controller like a change made on its own
// screen: it is stored in its memory, and a wrong value can leave a house
// cold or a hot water tank lukewarm. So:
//
//   - writing is OFF until the user ticks "Allow changes" in the settings;
//   - only what src/ebusd/catalog.js made writable can be written: a room or
//     hot water target within fixed bounds, an on/off, a named mode; never a
//     message reserved to the installer or the service ("install",
//     "service" access levels);
//   - a value equal to the current one is not written (src/app.js);
//   - one message is written at most once a minute (a slider or a scene that
//     flaps), and 100 writes a day at most, counted in /data/writes.json
//     across restarts.
// -----------------------------------------------------------------------------

export const MESSAGE_SPACING_MS = 60 * 1000;
export const DAILY_MAX = 100;

export class WriteRefused extends Error {
  /**
   * @param {string} reason - `disabled`, `read_only`, `range`, `spacing`, `quota`.
   * @param {object} [vars] - Details for the message.
   */
  constructor(reason, vars = {}) {
    super(reason);
    this.name = 'WriteRefused';
    this.reason = reason;
    this.vars = vars;
  }
}

/**
 * @description The guard: switch, spacing and daily quota.
 * @param {object} deps - `{ storage, now }`.
 * @returns {object} The guard.
 */
export function createWriteGuard({ storage, now }) {
  let state = { day: '', count: 0, last: {} };
  const today = () => new Date(now()).toISOString().slice(0, 10);

  const slot = () => {
    const day = today();
    if (state.day !== day) {
      state = { day, count: 0, last: state.last ?? {} };
    }
    return state;
  };

  return {
    async load() {
      const saved = await storage.read('writes.json');
      if (saved && typeof saved === 'object' && saved.last && typeof saved.last === 'object') {
        state = {
          day: String(saved.day ?? ''),
          count: Number(saved.count) || 0,
          last: saved.last,
        };
      }
    },

    /**
     * @description Refuse (throw) when a write may not happen now.
     * @param {object} input - `{ enabled, message }` (message: `circuit.name`).
     */
    check({ enabled, message }) {
      if (!enabled) {
        throw new WriteRefused('disabled');
      }
      const current = slot();
      if (current.count >= DAILY_MAX) {
        throw new WriteRefused('quota', { max: DAILY_MAX });
      }
      const wait = (current.last[message] ?? -Infinity) + MESSAGE_SPACING_MS - now();
      if (wait > 0) {
        throw new WriteRefused('spacing', { seconds: Math.ceil(wait / 1000) });
      }
    },

    /** @description Count a write that reached the bus. */
    async record(message) {
      const current = slot();
      current.count += 1;
      current.last[message] = now();
      // Old entries are of no use after the spacing: keep the file small.
      for (const [key, at] of Object.entries(current.last)) {
        if (now() - at > 24 * 60 * 60 * 1000) {
          delete current.last[key];
        }
      }
      await storage.write('writes.json', current);
    },

    /** @returns {number} Writes left today. */
    left: () => DAILY_MAX - slot().count,
  };
}
