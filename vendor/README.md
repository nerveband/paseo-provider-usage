# Local security patches

These private forks replace two transitive development dependencies with no published
patched versions as of October 21, 2026. Root npm overrides route every consumer through
them. React, React Native, and the Paseo SDK retain their compatible versions.

- `braces`: copied from the npm `braces@3.0.3` package, retaining its MIT license.
  Fixes [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  by running compile, expand, and stringify visitors on an explicit heap stack.
  Array flattening also uses an explicit stack. Deep valid patterns retain their
  results without exhausting the JavaScript call stack. Parsing and range limits
  remain unchanged.
- `sprintf-js`: copied from the npm `sprintf-js@1.0.3` package used by argparse,
  retaining its BSD-3-Clause license. Fixes
  [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
  by clamping numeric precision to the native Number methods' valid range before
  calling them. String precision and ordinary formatting remain unchanged.

The scoped names identify modified local packages, not upstream releases. Audit output
alone does not verify these patches: `npm test` exercises the attack patterns, ordinary
formatting and glob expansion, and verifies that the overrides select the forks.
Replace the forks with upstream packages once verified fixes are released.
