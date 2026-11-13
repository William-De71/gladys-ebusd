// -----------------------------------------------------------------------------
// TCP client of the ebusd daemon (port 8888 by default).
//
// Two connections:
//
//   commands   one request at a time (ebusd answers in order, an answer ends
//              with an empty line), queued, each with a timeout; opened on
//              the first command, kept open, reopened after an error
//   listener   `listen -v`: ebusd pushes one line per changed value; it is
//              reopened with a growing pause when it drops
//
// With a user name, `auth USER SECRET` is sent first on each connection (an
// ebusd ACL file can limit what an anonymous client may read or write). The
// secret is never logged.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { EbusdError, argument, checkAnswer, safeName } from './protocol.js';

const DEFAULT_TIMEOUT_MS = 15 * 1000;
const CONNECT_TIMEOUT_MS = 8 * 1000;
const MAX_ANSWER = 4 * 1024 * 1024;
const LISTEN_RETRY_MS = [5000, 15000, 30000, 60000];

/**
 * @description ebusd answers `find -d` with "ERR: element not found" when no
 * message has data yet (a bus without devices, or just started): that is an
 * empty list, not a failure.
 * @param {Promise<string>} answer - The answer of a `find -d` command.
 * @returns {Promise<string>} The answer, empty when nothing has data.
 */
async function emptyWhenNothing(answer) {
  try {
    return await answer;
  } catch (error) {
    if (error instanceof EbusdError && /element not found/i.test(error.message)) {
      return '';
    }
    throw error;
  }
}

/**
 * @description Open a socket, or fail within the connect timeout.
 * @param {string} host - Host.
 * @param {number} port - Port.
 * @param {number} timeoutMs - Connect timeout.
 * @returns {Promise<net.Socket>} The connected socket.
 */
function openSocket(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no answer from ${host}:${port}`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.setKeepAlive(true, 30 * 1000);
      socket.setNoDelay(true);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

/**
 * @description Create the client.
 * @param {object} options - Options.
 * @param {string} options.host - ebusd host.
 * @param {number} options.port - ebusd TCP port.
 * @param {string} [options.user] - ACL user name.
 * @param {string} [options.secret] - ACL secret.
 * @param {number} [options.timeoutMs] - Per command timeout.
 * @param {number[]} [options.listenRetryMs] - Pauses before reopening the listener.
 * @param {object} [options.logger] - Logger.
 * @returns {object} The client.
 */
export function createClient({
  host,
  port,
  user = '',
  secret = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  listenRetryMs = LISTEN_RETRY_MS,
  logger,
}) {
  let socket = null;
  let opening = null;
  let buffer = '';
  let current = null; // { resolve, reject, timer }
  let running = false;
  const queue = [];
  let closed = false;

  let listenSocket = null;
  let listenTimer = null;
  let listenAttempts = 0;
  let onLine = null;
  let onListenState = null;

  const fail = (error) => {
    const pending = current;
    current = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  };

  const drop = (error) => {
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
      socket = null;
    }
    buffer = '';
    fail(error);
  };

  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > MAX_ANSWER) {
      drop(new Error('answer too long'));
      return;
    }
    const end = buffer.indexOf('\n\n');
    if (end < 0 || !current) {
      return;
    }
    const answer = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const pending = current;
    current = null;
    clearTimeout(pending.timer);
    pending.resolve(answer.replace(/\r/g, ''));
  };

  const send = (raw) =>
    new Promise((resolve, reject) => {
      current = {
        resolve,
        reject,
        timer: setTimeout(() => {
          // The daemon may still answer later: the connection is dropped so
          // that late answer never meets the next command.
          drop(new Error('timeout'));
        }, timeoutMs),
      };
      current.timer.unref?.();
      socket.write(`${raw}\n`);
    });

  const open = async () => {
    if (socket) {
      return;
    }
    if (!opening) {
      opening = (async () => {
        const fresh = await openSocket(host, port, CONNECT_TIMEOUT_MS);
        fresh.on('data', onData);
        fresh.on('error', (error) => drop(error));
        fresh.on('close', () => {
          if (socket === fresh) {
            drop(new Error('connection closed'));
          }
        });
        socket = fresh;
        if (user) {
          try {
            checkAnswer(await send(`auth ${argument(user)} ${argument(secret)}`), 'auth');
          } catch (error) {
            // Never go on unauthenticated: the next command reconnects.
            drop(error);
            throw new EbusdError('invalid user name or secret', 'auth');
          }
        }
      })().finally(() => {
        opening = null;
      });
    }
    await opening;
  };

  async function next() {
    if (running || closed) {
      return;
    }
    const job = queue.shift();
    if (!job) {
      return;
    }
    running = true;
    try {
      await open();
      const answer = await send(job.command);
      job.resolve(answer);
    } catch (error) {
      if (!(error instanceof EbusdError)) {
        drop(error);
      }
      job.reject(error);
    } finally {
      running = false;
    }
    next();
  }

  /**
   * @description Send a raw command, get its answer (errors thrown).
   * @param {string} line - The command line.
   * @returns {Promise<string>} The answer.
   */
  const command = (line) => {
    if (closed) {
      return Promise.reject(new Error('client closed'));
    }
    return new Promise((resolve, reject) => {
      queue.push({ command: line, resolve, reject });
      next();
    }).then((answer) => checkAnswer(answer, line.split(' ')[0]));
  };

  // --- Listener ------------------------------------------------------------------------------------

  const scheduleListen = () => {
    if (closed || !onLine || listenTimer) {
      return;
    }
    const wait = listenRetryMs[Math.min(listenAttempts, listenRetryMs.length - 1)];
    listenAttempts += 1;
    listenTimer = setTimeout(() => {
      listenTimer = null;
      startListening();
    }, wait);
    listenTimer.unref?.();
  };

  async function startListening() {
    if (closed || !onLine || listenSocket) {
      return;
    }
    let fresh;
    try {
      fresh = await openSocket(host, port, CONNECT_TIMEOUT_MS);
    } catch (error) {
      onListenState?.(false, error);
      scheduleListen();
      return;
    }
    if (closed) {
      fresh.destroy();
      return;
    }
    listenSocket = fresh;
    let pending = '';
    let started = false;
    const lost = (error) => {
      if (listenSocket !== fresh) {
        return;
      }
      listenSocket.removeAllListeners();
      listenSocket.destroy();
      listenSocket = null;
      onListenState?.(false, error);
      scheduleListen();
    };
    fresh.on('error', lost);
    fresh.on('close', () => lost(new Error('connection closed')));
    fresh.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      if (pending.length > MAX_ANSWER) {
        lost(new Error('listen buffer overflow'));
        return;
      }
      let at;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at).replace(/\r$/, '');
        pending = pending.slice(at + 1);
        if (!line.trim()) {
          continue;
        }
        if (!started) {
          if (/^listen (started|continued)/i.test(line)) {
            started = true;
            listenAttempts = 0;
            onListenState?.(true);
          } else if (/^ERR:/.test(line)) {
            lost(new EbusdError(line.slice(4).trim(), 'listen'));
            return;
          }
          continue;
        }
        if (/^ERR:/.test(line) || /^done$/i.test(line)) {
          continue;
        }
        try {
          onLine(line);
        } catch (error) {
          logger?.warn?.(`ebusd: listen line skipped: ${error.message}`);
        }
      }
    });
    if (user) {
      fresh.write(`auth ${argument(user)} ${argument(secret)}\n`);
    }
    fresh.write('listen -v\n');
  }

  return {
    command,

    /** @returns {Promise<string>} `info` answer. */
    info: () => command('info'),

    /** @returns {Promise<string>} `state` answer (throws "no signal"). */
    state: () => command('state'),

    /** @returns {Promise<string>} Every definition. */
    definitions: () => command('find -a -F type,circuit,level,name,comment,zz,fields'),

    /** @returns {Promise<string>} The messages that have data. */
    withData: () => emptyWhenNothing(command('find -d -F circuit,name')),

    /** @returns {Promise<string>} `C NAME = field=value;…` of every message with data (cache only). */
    cached: () => emptyWhenNothing(command('find -v -d')),

    /**
     * @description Read a message (the cache when younger than maxAge).
     * @param {string} circuit - Circuit.
     * @param {string} name - Message name.
     * @param {number} [maxAgeSeconds] - Cache age accepted.
     * @returns {Promise<string>} `C NAME field=value;…`.
     */
    read: (circuit, name, maxAgeSeconds = 300) =>
      command(
        `read -m ${Math.max(0, Math.round(maxAgeSeconds))} -v -c ${safeName(circuit)} ${safeName(name)}`,
      ),

    /**
     * @description Write a message.
     * @param {string} circuit - Circuit.
     * @param {string} name - Message name.
     * @param {string} value - Value (several fields: `a;b`).
     * @returns {Promise<string>} `done` or the device answer.
     */
    write: (circuit, name, value) =>
      command(`write -c ${safeName(circuit)} ${safeName(name)} ${argument(value)}`),

    /**
     * @description Receive the changed values.
     * @param {Function} lineHandler - `(line) => void` for each `C NAME = …` line.
     * @param {Function} [stateHandler] - `(listening, error) => void`.
     */
    listen(lineHandler, stateHandler) {
      onLine = lineHandler;
      onListenState = stateHandler;
      listenAttempts = 0;
      startListening();
    },

    /** @returns {boolean} The listener is connected. */
    listening: () => Boolean(listenSocket),

    close() {
      closed = true;
      clearTimeout(listenTimer);
      listenTimer = null;
      if (listenSocket) {
        listenSocket.removeAllListeners();
        listenSocket.destroy();
        listenSocket = null;
      }
      drop(new Error('client closed'));
      queue.splice(0).forEach((job) => job.reject(new Error('client closed')));
    },
  };
}
