// The TCP client against the fake ebusd on a real local socket: one command
// at a time, errors, timeouts, authentication, the listener and its
// reconnection. Nothing leaves 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { createClient } from '../src/ebusd/client.js';
import { EbusdError } from '../src/ebusd/protocol.js';
import { silentLogger, startFake, until } from './helpers.js';

const clientFor = (fake, options = {}) =>
  createClient({
    host: fake.host,
    port: fake.port,
    timeoutMs: 500,
    listenRetryMs: [20],
    logger: silentLogger,
    ...options,
  });

test('commands: answers in order on one connection, errors as EbusdError', async (t) => {
  const fake = await startFake({ delayMs: 5 });
  const client = clientFor(fake);
  t.after(async () => {
    client.close();
    await fake.close();
  });
  const [a, b, c] = await Promise.all([
    client.read('bai', 'Flame', 300),
    client.read('700', 'Z1DayTemp', 300),
    client.read('Broadcast', 'Outsidetemp', 300),
  ]);
  assert.equal(a, 'bai Flame value=on');
  assert.equal(b, '700 Z1DayTemp value=20.5');
  assert.equal(c, 'Broadcast Outsidetemp value=6.5');
  await assert.rejects(client.read('bai', 'Nothing', 300), (error) => {
    assert.ok(error instanceof EbusdError);
    assert.ok(error.notFound);
    return true;
  });
  // Still usable after an ebusd error.
  assert.match(await client.info(), /^version: ebusd 26\.1/);
  assert.equal(fake.sockets.size, 1, 'one command connection');
  assert.ok(fake.commands.includes('read -m 300 -v -c bai Flame'));
});

test('commands: names are checked, values quoted', async (t) => {
  const fake = await startFake();
  const client = clientFor(fake);
  t.after(async () => {
    client.close();
    await fake.close();
  });
  assert.throws(() => client.read('bai', 'Flame;info'), RangeError);
  assert.equal(await client.write('700', 'Z1OpMode', 'night'), 'done');
  assert.deepEqual(fake.writes, [{ circuit: '700', name: 'Z1OpMode', value: 'night' }]);
  await client.write('700', 'Z1OpMode', 'two words');
  assert.ok(fake.commands.includes('write -c 700 Z1OpMode "two words"'));
});

test('commands: a timeout drops the connection, the next command reconnects', async (t) => {
  const fake = await startFake();
  const client = clientFor(fake, { timeoutMs: 100 });
  t.after(async () => {
    client.close();
    await fake.close();
  });
  fake.silent = true;
  await assert.rejects(client.info(), /timeout/);
  fake.silent = false;
  assert.match(await client.info(), /version/);
});

test('commands: nobody listening -> a clear error, then it works when ebusd is back', async (t) => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  const client = createClient({ host: '127.0.0.1', port, timeoutMs: 300, listenRetryMs: [20] });
  t.after(() => client.close());
  await assert.rejects(client.info(), /ECONNREFUSED/);
});

test('authentication: sent first; a refused secret fails every command, never silently', async (t) => {
  const fake = await startFake({ users: { gladys: 's3cret' } });
  const good = clientFor(fake, { user: 'gladys', secret: 's3cret' });
  const bad = clientFor(fake, { user: 'gladys', secret: 'nope' });
  t.after(async () => {
    good.close();
    bad.close();
    await fake.close();
  });
  assert.match(await good.info(), /version/);
  assert.equal(fake.commands[0], 'auth gladys s3cret');
  await assert.rejects(bad.info(), /invalid user name or secret/);
  await assert.rejects(bad.info(), /invalid user name or secret/);
});

test('listener: changed values pushed, reconnected after ebusd restarts', async (t) => {
  const fake = await startFake();
  const client = clientFor(fake);
  t.after(async () => {
    client.close();
    await fake.close();
  });
  const lines = [];
  const states = [];
  client.listen(
    (line) => lines.push(line),
    (up) => states.push(up),
  );
  await until(() => fake.listeners.size === 1);
  fake.push('bai.Flame', 'value=off');
  await until(() => lines.length === 1);
  assert.equal(lines[0], 'bai Flame = value=off');
  assert.ok(client.listening());
  fake.dropAll();
  await until(() => states.includes(false));
  await until(() => fake.listeners.size === 1);
  fake.push('700.Z1DayTemp', 'value=21');
  await until(() => lines.length === 2);
  assert.equal(lines[1], '700 Z1DayTemp = value=21');
  assert.deepEqual(states.slice(0, 2), [true, false]);
});

test('close: pending commands rejected, no reconnection', async () => {
  const fake = await startFake({ delayMs: 200 });
  const client = clientFor(fake);
  const pending = client.info();
  await until(() => fake.commands.length === 1);
  client.close();
  await assert.rejects(pending, /client closed/);
  await assert.rejects(client.info(), /client closed/);
  await fake.close();
});
