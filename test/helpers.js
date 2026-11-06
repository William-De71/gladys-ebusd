// Test helpers: a clock, a silent logger, waiting, and a fake ebusd daemon on
// a real local socket (test/helpers/fake-ebusd.js) that the integration
// reaches through its real code. Nothing leaves 127.0.0.1.

import {
  defaultValues,
  FakeEbusd,
  FIXTURE_DEFINITIONS,
  FIXTURE_INFO,
} from './helpers/fake-ebusd.js';

export { defaultValues, FakeEbusd, FIXTURE_DEFINITIONS, FIXTURE_INFO };

export function fakeClock(start = Date.parse('2026-11-06T08:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * @description Wait until a condition holds (real sockets take a few ms).
 * @param {Function} condition - `() => boolean`.
 * @param {number} [timeoutMs] - Give up after.
 * @returns {Promise<void>} Resolves when true, rejects on timeout.
 */
export async function until(condition, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * @description A started fake ebusd.
 * @param {object} [options] - FakeEbusd options.
 * @returns {Promise<FakeEbusd>} Listening on 127.0.0.1.
 */
export const startFake = (options = {}) => new FakeEbusd(options).listen(0, '127.0.0.1');
