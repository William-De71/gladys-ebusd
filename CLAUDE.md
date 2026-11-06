# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **eBUS heating systems**
(Vaillant, Saunier Duval, AWB, Bulex, Wolf, Kromschröder…) through the
[ebusd](https://github.com/john30/ebusd) daemon. A Node.js service (Node 22+,
ESM, no build step; only dependency: the SDK) in its own sandboxed Docker
container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to ebusd **on the local network only** (`transports: ["local"]`), over
its text protocol, TCP port 8888.

A **device integration** (`type: "device"`, Gladys 5.3.0+: catalog keywords,
widgets and scenes). The client in `src/ebusd/` was written from the ebusd
wiki ("3.1. TCP client commands") and the answers of the official ebusd 26.1
image: no code copied (ebusd is GPL-3.0, see NOTICE).

## Commands

```bash
npm install
npm test                                  # node --test, never leaves 127.0.0.1
node --test test/app.test.js              # one file
node --test --test-name-pattern "writes"  # tests whose name matches
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
docs/illustrations/render.sh              # widget illustrations (Chrome, ImageMagick, Pillow)
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg (Inkscape, ImageMagick)
```

A real ebusd without an adapter, for manual checks (the scan answers are
injected, the configuration files come from the ebusd server):

```bash
docker run -d --name ebusd-lab -p 18888:8888 john30/ebusd:latest -f \
  --device=enh:127.0.0.1:9999 --nodevicecheck --scanconfig --accesslevel='*' \
  --enablehex --enabledefine --inject FF08070400/0AB5424149303003277201
```

## Architecture

```
index.js                     SDK wiring only: createApp(gladys) + connect + start
src/app.js                   every handler: discovery, readings, live values, commands, scene events and actions, widgets, status
src/ebusd/client.js          TCP client: one command at a time (queued, timeout, reconnect, auth) + the `listen -v` connection
src/ebusd/protocol.js        pure parsers: answers, errors, CSV definitions, value lines, info
src/ebusd/catalog.js         definitions -> circuits and features (what is useful, Gladys shapes, writable targets and bounds), value conversion
src/devices.js               catalog -> Gladys devices (daemon + one per circuit), names
src/writes.js                the write guard: switch, spacing (1 min per message), daily quota (100)
src/states.js                state publication: created devices only, coalesced, 240/min, 429 pause
src/scenes.js                scene trigger / action keys, event data, outputs
src/widgets.js               the heating, history and bus widgets (pure, reused by docs/illustrations)
src/i18n.js                  runtime texts in en / fr / de / es, numbers per language
src/storage.js               JSON file in /data (writes.json)
src/config.js                config_schema -> { host, port, user, secret, pollSeconds, allSeen, extra, allowWrites, language }
test/helpers/fake-ebusd.js   a fake ebusd on a real local socket, fed with the real ebusd 26.1 answers of test/fixtures
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `ext:{selector}:daemon:ebusd[:signal]` and
  `ext:{selector}:circuit:{circuit}[:{message}.{field}]`, all lower case
  (ebusd names are case insensitive, their case changed between
  configuration releases). Config, action, field, widget, trigger, variable
  and output keys too.
- **Feature fields** compared by the Discover "Update" (category, type, unit,
  min, max, step, features added or removed) are decided in
  `src/ebusd/catalog.js` only: the baseline pins them.
- **Writes are dangerous**: a wrong value can leave a house cold. Never bypass
  `src/writes.js`: off unless `allow_writes`, never a message with an access
  level (`install`, `service`), room targets 5–30 °C, hot water 35–70 °C,
  never the same value, one minute per message, 100 a day.
- **The eBUS is slow and shared** with the controller of the house: never
  read faster than a minute (`POLL_INTERVALS`), always with `read -m
<interval>` so ebusd answers from its cache when it can; `listen -v` brings
  the values that change.
- **Scene events**: one per transition seen; never fired by a command or a
  scene action; the first value of an error is not news.
- **The container rootfs is read-only**: the only writable folder is /data.
- **Widget content**: after any change, run `docs/illustrations/render.sh` and
  look at the four images. Budget: 2 texts, 1 focal, 6 tiles, 1 status, 4
  buttons. Tile labels fit about 12 characters.
- **User-facing text** exists in en, fr, de and es: manifest, `src/i18n.js`,
  `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.

## Pitfalls

- An answer ends with an empty line; an error starts with `ERR: ` (`no
signal`, `element not found`, `no data stored`, `read timeout`), a bad
  syntax with `usage:`.
- `find -F` writes CSV: a comment holding a comma is quoted. A field is six
  columns (name, part, type, divider or value list, unit, comment); `IGN`
  fields never appear in a value line. Conditional definitions start with
  `[condition]`.
- `read -v` answers `C NAME field=value;…`, `find -v` and `listen -v` answer
  `C NAME = field=value;…`; a field that cannot be decoded is cut with
  ` (ERR: …)`. A passive message (`u`) is only in the cache: `read` never
  sends it on the bus.
- `read -m` refuses ages over a day (86400 s, a usage answer); the scene
  action caps it at an hour.
- Write messages are listed by `find -a` only.
- ebusd loads the configuration of a device a few minutes after it sees it:
  the discovery runs again every 10 minutes during the first hour.
- `localhost` does not reach ebusd from the integration container.
- `node --test` also runs the files of `test/helpers/`: they must not start
  anything on import.
- A top-level `const SVG` in `docs/illustrations/render.js` shadows the global
  of ApexCharts (charts render empty): it is `SVG_NS`.
- Gladys does not send the user's language with a scan or a command: device
  and feature names, text states and scene errors use the `language`
  setting.
- Never tested on a real eBUS: when a user reports a difference, add their
  `ebusctl info` / `find` answers to `test/fixtures` first, then fix the code.
