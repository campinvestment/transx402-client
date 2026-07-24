# `@transx402/client`

IDRX x402 payment client for browser (Path 4) and Node.js agents (Path 3).

Extracted from the TransX402 monorepo (`packages/client`). This repo is local-only until you create a GitHub remote and publish to npm.

## Install (after publish)

```bash
pnpm add @transx402/client
```

```ts
import { createBrowserClient } from "@transx402/client/browser";
import { createAgentClient } from "@transx402/client/agent";
```

## Local development / monorepo link (pre-publish)

The TransX402 monorepo depends on this package via:

```json
"@transx402/client": "link:../transx402-client"
```

(Registry version is not available until you publish.)

```bash
pnpm install
pnpm test
pnpm build

# Optional: also register a global link
pnpm link --global
# then in ../transx402: pnpm link --global @transx402/client
```

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm build` | Emit `dist/` ESM + browser bundle |
| `pnpm test` | Vitest |
| `pnpm type-check` | `tsc --noEmit` |

## Before first npm publish

1. Create a GitHub remote and push `main`.
2. Remove `"private": true` from `package.json`.
3. Update `repository.url` to the GitHub URL.
4. `npm publish --access public`

CDN deploy (`cdn.transx402.com`) should build from this repo or unpack the published npm tarball — not from the monorepo.
