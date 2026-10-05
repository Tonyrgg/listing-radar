# Local interface fonts

These are the same families configured by `app/layout.tsx`, copied from the application's existing Next font build as WOFF2 Latin subsets.

- `instrument-sans-latin.woff2`: Instrument Sans, normal variable weights 400–700. Source project: https://github.com/Instrument/instrument-sans. License: `InstrumentSans-OFL.txt`, from https://github.com/google/fonts/tree/main/ofl/instrumentsans.
- `ibm-plex-mono-latin.woff2`: IBM Plex Mono, normal weight 400. Source project: https://github.com/IBM/plex. License: `IBMPlexMono-OFL.txt`, from https://github.com/google/fonts/tree/main/ofl/ibmplexmono.

Fonts load from the packaged renderer; no network connection is needed. Latin includes the Italian interface's accented characters. Other scripts can use the configured system fallback.
