# `@transx402/client`

IDRX x402 payment client for browser (Path 4) and Node.js agents (Path 3).

Source: [github.com/campinvestment/transx402-client](https://github.com/campinvestment/transx402-client)  
Integration docs: [docs.transx402.com](https://docs.transx402.com/integrations/javascript-library)

## Install (after publish)

```bash
pnpm add @transx402/client
```

```ts
import { createBrowserClient } from "@transx402/client/browser";
import { createAgentClient } from "@transx402/client/agent";
```

## Local development (TransX402 monorepo, pre-publish)

The platform monorepo depends on a sibling checkout until the package is on npm:

```json
"@transx402/client": "link:../transx402-client"
```

```bash
pnpm install
pnpm test
pnpm build
```

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm build` | Emit `dist/` ESM + browser bundle |
| `pnpm test` | Vitest |
| `pnpm type-check` | `tsc --noEmit` |

## Before first npm publish

1. Push `main` to `origin` (if not already).
2. `npm publish --access public`

CDN deploy (`cdn.transx402.com`) should build from this repo or unpack the published npm tarball.
