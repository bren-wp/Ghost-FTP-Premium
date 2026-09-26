# Ghost FTP versioning

Ghost FTP uses semantic versioning with a pre-1.0 development train.

- Every meaningful development/release cycle changes the central version together with real code/product changes; there are no version-only commits.
- A new development/feature release advances the minor component: `0.14.0` → `0.15.0` → `0.16.0`.
- A hotfix to an already published release advances only the patch component: `0.15.0` → `0.15.1` → `0.15.2`.
- `1.0.0` is reserved for the first fully production-stable release.
- Root `version.json` is the single source of truth for the active product version and build metadata.
- CI rejects metadata drift and invalid version progression.
- Historical canonical versions are assigned only to releases that actually exist on GitHub. Missing legacy RC numbers do not consume a canonical `0.x.0` version.
- Legacy `2.1.1-rc.*` identifiers remain compatibility aliases for already-published assets and links.

The verified mapping is recorded in `docs/releases/version-map.json`.
