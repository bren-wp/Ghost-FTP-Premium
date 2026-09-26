# Ghost FTP versioning

Ghost FTP uses semantic versioning with a pre-1.0 development train.

- Development and feature releases advance the minor version: `0.1.0`, `0.2.0`, `0.3.0`, …
- Hotfixes advance only the patch version: `0.3.1`, `0.3.2`, …
- `1.0.0` is reserved for the first fully production-stable release.
- Root `version.json` is the single source of truth for the active product version.
- CI rejects metadata drift and version jumps that are neither the next minor nor the next patch.
- Legacy `2.1.1-rc.*` identifiers are retained only as compatibility aliases for already-published references; canonical release documentation uses the mapped `0.x.0` version.

The mapping is recorded in `docs/releases/version-map.json`.
