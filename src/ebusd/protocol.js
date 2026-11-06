// -----------------------------------------------------------------------------
// The text protocol of the ebusd daemon (TCP port 8888), as documented in the
// ebusd wiki, "3.1. TCP client commands". Pure functions only: the socket is
// in src/ebusd/client.js.
//
// A request is one line; the answer is one or more lines ended by an empty
// line. An error starts with "ERR: ", a wrong syntax with "usage:".
//
//   info                         version, signal, the participants seen and
//                                the configuration file loaded for each
//   find -a -F type,circuit,level,name,comment,zz,fields
//                                every message definition, one CSV line each
//                                ("[condition]" prefix for conditional ones)
//   find -d -F circuit,name      the messages that have data
//   read -m S -v -c C NAME       "C NAME field=value;field=value", from the
//                                cache when younger than S seconds, else read
//                                on the bus (passive messages: cache only)
//   write -c C NAME VALUE        "done" or the hex answer of the device
//   listen -v                    then "C NAME = field=value;..." per change
//
// A field of a definition is six columns: name, part (m = master data, s =
// slave data), data type, divider or value list ("0=off;1=on"), unit,
// comment. IGN fields are never part of a value.
// -----------------------------------------------------------------------------

export class EbusdError extends Error {
  /**
   * @param {string} message - The text after "ERR: ".
   * @param {string} [command] - The command sent.
   */
  constructor(message, command = '') {
    super(message);
    this.name = 'EbusdError';
    this.command = command;
  }

  /** @returns {boolean} The eBUS adapter has no signal. */
  get noSignal() {
    return /no signal/i.test(this.message);
  }

  /** @returns {boolean} The message or field does not exist. */
  get notFound() {
    return /element not found|no data stored/i.test(this.message);
  }
}

/**
 * @description Throw when an answer is an error.
 * @param {string} answer - The answer, empty line removed.
 * @param {string} command - The command sent.
 * @returns {string} The answer.
 */
export function checkAnswer(answer, command) {
  const text = String(answer ?? '').trim();
  if (text.startsWith('ERR:')) {
    throw new EbusdError(text.slice(4).trim(), command);
  }
  if (text.startsWith('usage:')) {
    throw new EbusdError(`invalid command: ${command.split(' ')[0]}`, command);
  }
  return text;
}

/**
 * @description Split one CSV line the way ebusd writes it: comma separated,
 * a cell holding a comma is quoted, a quote in it doubled.
 * @param {string} line - The line.
 * @returns {string[]} The cells.
 */
export function splitCsv(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/**
 * @description A value list "0=off;1=on" -> `{ 0: 'off', 1: 'on' }`.
 * @param {string} text - The divider / values column.
 * @returns {Record<string, string>|null} The list, null for a divider.
 */
export function parseValueList(text) {
  if (!text || !text.includes('=')) {
    return null;
  }
  const list = {};
  for (const pair of text.split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) {
      list[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
    }
  }
  return Object.keys(list).length > 0 ? list : null;
}

const FIELD_COLUMNS = 6;

/**
 * @description One line of `find -a -F type,circuit,level,name,comment,zz,fields`.
 * @param {string} line - The line.
 * @returns {object|null} `{ type, direction, circuit, level, name, comment, zz, conditional, fields }`.
 */
export function parseDefinition(line) {
  let text = String(line ?? '').trim();
  if (!text || text.startsWith('#') || text.startsWith('*')) {
    return null;
  }
  let conditional = false;
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end < 0) {
      return null;
    }
    conditional = true;
    text = text.slice(end + 1);
  }
  const cells = splitCsv(text);
  if (cells.length < 6) {
    return null;
  }
  const [type, circuit, level, name, comment, zz, ...rest] = cells;
  if (!circuit || !name) {
    return null;
  }
  // r, r1..r9 (poll priority): active read; w: write; u / uw: passive (update).
  const kind = type.trim().toLowerCase();
  let direction;
  if (kind.startsWith('r')) {
    direction = 'read';
  } else if (kind.startsWith('w')) {
    direction = 'write';
  } else if (kind.startsWith('u')) {
    direction = 'passive';
  } else {
    return null;
  }
  const fields = [];
  for (let i = 0; i + FIELD_COLUMNS <= rest.length; i += FIELD_COLUMNS) {
    const [fieldName, part, dataType, divider, unit, fieldComment] = rest.slice(
      i,
      i + FIELD_COLUMNS,
    );
    const values = parseValueList(divider);
    fields.push({
      name: fieldName.trim(),
      part: part.trim() === 'm' ? 'm' : 's',
      type: dataType.trim().toUpperCase(),
      values,
      divider: values ? null : divider.trim(),
      unit: unit.trim(),
      comment: fieldComment.trim(),
    });
  }
  return {
    type: kind,
    direction,
    circuit: circuit.trim(),
    level: level.trim(),
    name: name.trim(),
    comment: comment.trim(),
    zz: zz.trim().toLowerCase(),
    conditional,
    fields,
  };
}

/**
 * @description Every definition of a `find -a -F …` answer.
 * @param {string} answer - The answer.
 * @returns {object[]} The definitions.
 */
export function parseDefinitions(answer) {
  return String(answer ?? '')
    .split('\n')
    .map(parseDefinition)
    .filter(Boolean);
}

/**
 * @description The fields that carry a value: IGN fields are never output,
 * and the master part of a read message is its request (an index, a day).
 * @param {object} definition - Parsed definition.
 * @returns {object[]} The fields, in the order of a value line.
 */
export function valueFields(definition) {
  return definition.fields.filter((field) => !field.type.startsWith('IGN'));
}

/**
 * @description The values of a line `[C NAME [=]] field=value;field=value`.
 * @param {string} text - The values part, or a whole line.
 * @param {boolean} [withHeader] - The line starts with "circuit name".
 * @returns {{ circuit: string|null, name: string|null, values: Record<string, string>, error: string|null }} The values.
 */
export function parseValueLine(text, withHeader = false) {
  let rest = String(text ?? '').trim();
  let circuit = null;
  let name = null;
  if (withHeader) {
    const match = /^(\S+)\s+(\S*)\s*(?:=\s?)?(.*)$/.exec(rest);
    if (!match) {
      return { circuit: null, name: null, values: {}, error: 'unreadable' };
    }
    [, circuit, name, rest] = match;
    // A message without values: "C NAME = " (or the "no data stored" text).
  }
  let error = null;
  const errorAt = rest.indexOf(' (ERR:');
  if (errorAt >= 0) {
    error = rest.slice(errorAt + 6, rest.lastIndexOf(')')).trim() || 'error';
    rest = rest.slice(0, errorAt);
  }
  if (/^no data stored$/i.test(rest.trim())) {
    return { circuit, name, values: {}, error: 'no data stored' };
  }
  const values = {};
  for (const part of rest.split(';')) {
    const at = part.indexOf('=');
    if (at > 0) {
      const key = part.slice(0, at).trim();
      if (key) {
        values[key] = part.slice(at + 1).trim();
      }
    }
  }
  return { circuit, name, values, error };
}

/**
 * @description The answer of `info`.
 * @param {string} answer - The answer.
 * @returns {object} `{ version, signal, symbolRate, maxSymbolRate, masters, messages, device, participants }`.
 */
export function parseInfo(answer) {
  const info = {
    version: null,
    signal: false,
    symbolRate: null,
    maxSymbolRate: null,
    masters: null,
    messages: null,
    device: null,
    reconnects: null,
    participants: [],
  };
  for (const raw of String(answer ?? '').split('\n')) {
    const line = raw.trim();
    const at = line.indexOf(':');
    if (at < 0) {
      continue;
    }
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key === 'version') {
      info.version = value.replace(/^ebusd\s+/i, '');
    } else if (key === 'signal') {
      info.signal = /^acquired/i.test(value);
    } else if (key === 'symbol rate') {
      info.symbolRate = Number(value);
    } else if (key === 'max symbol rate') {
      info.maxSymbolRate = Number(value);
    } else if (key === 'masters') {
      info.masters = Number(value);
    } else if (key === 'messages') {
      info.messages = Number(value);
    } else if (key === 'reconnects') {
      info.reconnects = Number(value);
    } else if (key === 'device') {
      info.device = value;
    } else if (key.startsWith('address ')) {
      info.participants.push(parseParticipant(key.slice(8), value));
    }
  }
  return info;
}

/**
 * @description One "address 08: slave #11, scanned "…", loaded "…"" line.
 * @param {string} address - Hex address.
 * @param {string} text - What follows the colon.
 * @returns {object} `{ address, role, self, ident, files, circuits }`.
 */
function parseParticipant(address, text) {
  const role = /^(master|slave)/i.exec(text)?.[1]?.toLowerCase() ?? 'unknown';
  const ident = {};
  const scanned = /scanned "([^"]*)"/.exec(text)?.[1];
  if (scanned) {
    for (const pair of scanned.split(';')) {
      const [key, ...value] = pair.split('=');
      if (key && value.length > 0) {
        ident[key.trim().toUpperCase()] = value.join('=').trim();
      }
    }
  }
  const loaded = /loaded (.*)$/.exec(text)?.[1] ?? '';
  const files = [...loaded.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return {
    address: address.trim().toLowerCase(),
    role,
    self: /\bebusd\b/.test(text),
    ident,
    files,
  };
}

/**
 * @description The answer of `state`: true when the bus has a signal.
 * @param {string} answer - The answer.
 * @returns {boolean} Signal acquired.
 */
export function parseState(answer) {
  return /^signal acquired/i.test(String(answer ?? '').trim());
}

/**
 * @description Quote a value for a command line: ebusd splits arguments on
 * spaces, a value holding one (a date, a text) is quoted.
 * @param {string} value - The value.
 * @returns {string} The argument.
 */
export function argument(value) {
  const text = String(value ?? '');
  if (/[\r\n]/.test(text)) {
    throw new RangeError('line break');
  }
  return /[\s"]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

/**
 * @description A circuit or message name safe for a command line.
 * @param {string} name - The name.
 * @returns {string} The name.
 */
export function safeName(name) {
  const text = String(name ?? '');
  if (!/^[\w.-]+$/u.test(text)) {
    throw new RangeError(`invalid name: ${text.slice(0, 40)}`);
  }
  return text;
}
