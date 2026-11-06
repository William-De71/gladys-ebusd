# Test fixtures

- `ebusd-26.1-info.txt` and `ebusd-26.1-definitions.csv`: answers of ebusd
  26.1 (official Docker image `john30/ebusd`) to `info` and to
  `find -a -F type,circuit,level,name,comment,zz,fields`, with a Vaillant
  BAI00 boiler and a VRC 700 announced on an injected bus. The definitions
  come from the [ebusd-configuration](https://github.com/john30/ebusd-configuration)
  files, released under the **GNU General Public License v3.0**; they are
  quoted here as test data for interoperability, under that license, and are
  not part of the Docker image of the integration. The last lines (VRC 700
  room target, mode and room temperature) were written from
  `src/vaillant/15.700.tsp` of the same project.
- `discovery.baseline.json`: the Gladys fields of every feature discovered
  from these fixtures (category, type, unit, bounds). Rewrite it on purpose
  only, with `UPDATE_BASELINE=1 npm test`.
