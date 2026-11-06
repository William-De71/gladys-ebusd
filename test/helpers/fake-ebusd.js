// A fake ebusd daemon on a real local TCP socket, for the tests: it answers
// the commands the integration sends the way ebusd 26.1 does (answers ended
// by an empty line, "ERR: …" errors, `listen` pushes). The definitions and
// the `info` answer are the real ones of an ebusd 26.1 (test/fixtures),
// captured from the official Docker image with a Vaillant boiler (BAI00) and
// a VRC 700 announced on an injected bus.
//
// Nothing starts on import: `node --test` runs this file too.

import net from 'node:net';
import { readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/', import.meta.url);

export const FIXTURE_INFO = readFileSync(new URL('ebusd-26.1-info.txt', FIXTURES), 'utf8');
export const FIXTURE_DEFINITIONS = readFileSync(
  new URL('ebusd-26.1-definitions.csv', FIXTURES),
  'utf8',
);

/** Values a running Vaillant installation would have. */
export const defaultValues = () => ({
  'bai.Status01': 'temp=55.5;temp_1=42.0;temp_2=6.5;temp_3=48.0;temp_4=49.5;pumpstate=on',
  'bai.FlowTemp': 'temp=55.5;sensor=ok',
  'bai.ReturnTemp': 'temp=42.0;tempmirror=42.0;sensor=ok',
  'bai.WaterPressure': 'press=1.62;sensor=ok',
  'bai.Flame': 'value=on',
  'bai.HcHours': 'value=10234',
  'bai.HcStarts': 'value=45100',
  'bai.Currenterror': 'error=-;error_1=-;error_2=-;error_3=-;error_4=-',
  'bai.ModulationTempDesired': 'value=38.5',
  '700.DisplayedOutsideTemp': 'value=6.4',
  '700.Z1DayTemp': 'value=20.5',
  '700.Z1OpMode': 'value=auto',
  '700.Z1RoomTemp': 'value=20.1',
  '700.HwcTempDesired': 'value=50',
  '700.HwcOpMode': 'value=auto',
  'Broadcast.Outsidetemp': 'value=6.5',
});

/** Parse the definitions once: `circuit.name` (lower) -> { read, write } lines. */
function indexDefinitions(text) {
  const index = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\[[^\]]*\]/, '');
    const [type, circuit, level, name, , , ...fields] = line.split(',');
    if (!circuit || !name) {
      continue;
    }
    const key = `${circuit}.${name}`.toLowerCase();
    const entry = index.get(key) ?? { circuit, name, read: null, write: null };
    if (type.startsWith('w')) {
      entry.write = { level, fields };
    } else if (!entry.read) {
      entry.read = { level, passive: type.startsWith('u'), fields };
    }
    index.set(key, entry);
  }
  return index;
}

/** Split a command line, quotes kept together. */
function words(line) {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) =>
    match[1] !== undefined ? match[1].replace(/\\"/g, '"') : match[2],
  );
}

export class FakeEbusd {
  /**
   * @param {object} [options] - Options.
   * @param {boolean} [options.signal] - The adapter hears the bus.
   * @param {object} [options.values] - `Circuit.Name` -> `field=value;…`.
   * @param {object} [options.users] - `{ name: secret }` (an ACL: anonymous reads only).
   * @param {number} [options.delayMs] - Delay before each answer.
   * @param {string} [options.info] - Another `info` answer than the fixture.
   */
  constructor({
    signal = true,
    values = defaultValues(),
    users = null,
    delayMs = 0,
    info = FIXTURE_INFO,
  } = {}) {
    this.signal = signal;
    this.info = info;
    this.users = users;
    this.delayMs = delayMs;
    this.definitions = FIXTURE_DEFINITIONS;
    this.index = indexDefinitions(this.definitions);
    this.values = new Map(); // lower key -> { circuit, name, text, at }
    this.bus = new Map(); // lower key -> text the device would answer
    for (const [key, text] of Object.entries(values)) {
      this.setValue(key, text, { cached: true });
    }
    this.commands = [];
    this.writes = [];
    this.listeners = new Set();
    this.sockets = new Set();
    this.silent = false;
    this.server = net.createServer((socket) => this.accept(socket));
  }

  /**
   * @description Set what a device answers (and, with `cached`, what ebusd holds).
   * @param {string} key - `Circuit.Name`.
   * @param {string} text - `field=value;…`.
   * @param {object} [options] - `{ cached, age }` (age in seconds).
   */
  setValue(key, text, { cached = true, age = 0 } = {}) {
    const lower = key.toLowerCase();
    const entry = this.index.get(lower);
    const [circuit, name] = entry ? [entry.circuit, entry.name] : key.split('.');
    this.bus.set(lower, text);
    if (cached) {
      this.values.set(lower, { circuit, name, text, at: Date.now() - age * 1000 });
    }
  }

  /** @description A value changes on the bus: cache it and tell the listeners. */
  push(key, text) {
    this.setValue(key, text);
    const { circuit, name } = this.values.get(key.toLowerCase());
    for (const socket of this.listeners) {
      socket.write(`${circuit} ${name} = ${text}\n`);
    }
  }

  async listen(port = 0, host = '127.0.0.1') {
    await new Promise((resolve) => this.server.listen(port, host, resolve));
    this.host = host;
    this.port = this.server.address().port;
    return this;
  }

  /** @description Drop every connection (ebusd restarted). */
  dropAll() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    this.listeners.clear();
  }

  async close() {
    this.dropAll();
    await new Promise((resolve) => this.server.close(resolve));
  }

  accept(socket) {
    this.sockets.add(socket);
    const session = { user: null };
    let buffer = '';
    socket.on('error', () => {});
    socket.on('close', () => {
      this.sockets.delete(socket);
      this.listeners.delete(socket);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) {
          this.commands.push(line);
          if (this.silent) {
            continue;
          }
          const answer = this.answer(line, socket, session);
          const send = () => !socket.destroyed && socket.write(`${answer}\n\n`);
          if (this.delayMs > 0) {
            setTimeout(send, this.delayMs);
          } else {
            send();
          }
        }
      }
    });
  }

  infoText() {
    const lines = this.info
      .trimEnd()
      .split('\n')
      .map((line) => {
        if (line.startsWith('signal:')) {
          return `signal: ${this.signal ? 'acquired' : 'no signal'}`;
        }
        if (line.startsWith('device:')) {
          return 'device: 192.168.1.30:9999, TCP, enhanced';
        }
        return line;
      });
    if (this.signal) {
      const at = lines.findIndex((line) => line.startsWith('signal:'));
      lines.splice(at + 1, 0, 'symbol rate: 42', 'max symbol rate: 187');
    }
    return lines.join('\n');
  }

  answer(line, socket, session) {
    const [command, ...args] = words(line);
    switch (command) {
      case 'info':
        return this.infoText();
      case 'state':
        return this.signal
          ? 'signal acquired, 42 symbols/sec (187 max), 3 masters'
          : 'ERR: no signal';
      case 'auth':
        if (this.users && this.users[args[0]] === args[1]) {
          session.user = args[0];
          return 'done';
        }
        return 'ERR: invalid user name or secret';
      case 'listen':
        this.listeners.add(socket);
        return 'listen started';
      case 'find':
        return this.find(args);
      case 'read':
        return this.read(args);
      case 'write':
        return this.write(args, session);
      default:
        return 'ERR: command not found';
    }
  }

  find(args) {
    if (args.includes('-a') && args.includes('-F')) {
      return this.definitions.trimEnd();
    }
    if (args.includes('-d') && args.includes('-F')) {
      return [...this.values.values()].map(({ circuit, name }) => `${circuit},${name}`).join('\n');
    }
    if (args.includes('-d') && args.includes('-v')) {
      return [...this.values.values()]
        .map(({ circuit, name, text }) => `${circuit} ${name} = ${text}`)
        .join('\n');
    }
    return 'ERR: invalid argument';
  }

  read(args) {
    let maxAge = 300;
    let circuit = null;
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '-m') {
        maxAge = Number(args[++i]);
      } else if (args[i] === '-c') {
        circuit = args[++i];
      } else if (args[i] === '-f') {
        maxAge = 0;
      } else if (!args[i].startsWith('-')) {
        rest.push(args[i]);
      }
    }
    const key = `${circuit}.${rest[0]}`.toLowerCase();
    const entry = this.index.get(key);
    if (!entry?.read) {
      return 'ERR: element not found';
    }
    const cached = this.values.get(key);
    if (cached && (entry.read.passive || Date.now() - cached.at < maxAge * 1000)) {
      return `${cached.circuit} ${cached.name} ${cached.text}`;
    }
    if (entry.read.passive) {
      return 'ERR: no data stored';
    }
    if (!this.signal) {
      return 'ERR: no signal';
    }
    const text = this.bus.get(key);
    if (text === undefined) {
      return 'ERR: read timeout';
    }
    this.setValue(key, text);
    return `${entry.circuit} ${entry.name} ${text}`;
  }

  write(args, session) {
    let circuit = null;
    const rest = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '-c') {
        circuit = args[++i];
      } else {
        rest.push(args[i]);
      }
    }
    const [name, value] = rest;
    const key = `${circuit}.${name}`.toLowerCase();
    const entry = this.index.get(key);
    if (!entry?.write) {
      return 'ERR: element not found';
    }
    if (entry.write.level && !session.user) {
      return 'ERR: access denied';
    }
    if (!this.signal) {
      return 'ERR: no signal';
    }
    this.writes.push({ circuit: entry.circuit, name: entry.name, value });
    if (entry.read) {
      this.bus.set(key, `value=${value}`);
    }
    return 'done';
  }
}
