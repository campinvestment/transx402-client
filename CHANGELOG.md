# Changelog

All notable changes to `@transx402/client` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] — 2026-07-27

### Fixed

- Preserve `error.code` and `details` from `POST /facilitate` via `FacilitationError`
  instead of opaque `Error` strings (fixes `insufficient_balance` handling in docs)
- Fail fast in the browser when IDRX balance is too low, before MetaMask signing
- Show human-readable insufficient-balance copy in the paywall modal

### Added

- `FacilitationError`, `formatFacilitationError`, and `formatIdrxBaseUnits` helpers
- `readErc20Balance` for reusable balanceOf reads via `publicClient`
- Unit tests for facilitation error formatting and API error parsing

## [0.1.3] — 2026-07-27

### Fixed

- Skip MetaMask `wallet_watchAsset` when the payer already holds a non-zero IDRX
  balance, avoiding redundant "add token" prompts on repeat sandbox payments
- Use `publicClient.readContract(balanceOf)` instead of MetaMask `eth_call` for
  the balance check (the provider path failed silently on custom chains)

### Added

- `hasErc20Balance` helper and `Erc20BalanceReader` type in `wallet.ts`
- Unit tests for balance-gated `watchErc20Asset` behaviour

### Note

- `0.1.2` was reserved on the registry without a downloadable tarball; this release
  replaces that attempt with a complete publish.

## [0.1.1] — 2026-07-24

### Added

- CommonJS builds for `.`, `./browser`, and `./agent` entry points (`require` export conditions)
- Minified browser CDN bundle `dist/transx402.browser.min.js` with source maps
- Source maps for the unminified browser bundle `dist/transx402.browser.js`
- Package `keywords` and `author` metadata
- Expanded README with install, Path 3/4, paywall, CDN, and environment docs
- Release notes and publish workflow documentation

### Changed

- `package.json` `exports` now declare explicit `import` and `require` conditions

## [0.1.0] — 2026-07-24

### Added

- Initial public release of `@transx402/client`
- Path 4 browser client (`createBrowserClient`) and paywall helpers
- Path 3 agent client (`createAgentClient`)
- ESM modules, TypeScript definitions, and CDN browser bundle
- Automated tests via Vitest and `prepublishOnly` gate

[0.1.4]: https://github.com/campinvestment/transx402-client/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/campinvestment/transx402-client/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/campinvestment/transx402-client/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/campinvestment/transx402-client/releases/tag/v0.1.0
