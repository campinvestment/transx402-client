# `@transx402/client`

IDRX x402 payment client for browser (Path 4) and Node.js agents (Path 3).

- Source: [github.com/campinvestment/transx402-client](https://github.com/campinvestment/transx402-client)
- npm: [npmjs.com/package/@transx402/client](https://www.npmjs.com/package/@transx402/client)
- Integration docs: [docs.transx402.com](https://docs.transx402.com/integrations/javascript-library)

## Install

```bash
npm install @transx402/client
# or
pnpm add @transx402/client
```

ESM and CommonJS are both supported:

```ts
// ESM
import type { PaymentResult } from "@transx402/client";
import { createBrowserClient } from "@transx402/client/browser";
import { createAgentClient } from "@transx402/client/agent";
```

```js
// CommonJS
const { createBrowserClient } = require("@transx402/client/browser");
const { createAgentClient } = require("@transx402/client/agent");
```

## Usage

### Path 4 — browser (MetaMask / EIP-1193)

Self-paid Permit2 approve once; `signTypedData` on each payment.

```ts
import { createBrowserClient } from "@transx402/client/browser";

const browser = createBrowserClient({
  apiKey: "ipk_sandbox_...",
  environment: "local", // "local" | "camp" | "base"
});

const response = await browser.fetch("https://yourapi.com/premium-data");
```

### Path 3 — agent / Node

Sponsored approve once; Permit2 `signTypedData` on each payment.

```ts
import { createAgentClient } from "@transx402/client/agent";

const agent = createAgentClient({
  apiKey: "ipk_sandbox_...",
  environment: "local",
  privateKey: "0x...",
});

await agent.pay({ to: "0x...", amount: "5000", currency: "IDR" });
```

### Paywall (drop-in UI)

```ts
import { createPaywall } from "@transx402/client/browser";

createPaywall({
  apiKey: "ipk_sandbox_...",
  environment: "local",
  selector: "#premium-content",
  price: 5000,
  currency: "IDR",
  merchantWallet: "0x...",
  title: "Premium Article",
  description: "Pay Rp 5,000 to unlock",
});
```

### CDN (no build step)

Serve `dist/transx402.browser.min.js` (or the unminified `dist/transx402.browser.js`) from your CDN. Example:

```html
<script type="module">
  import TransX402 from "https://cdn.transx402.com/v1/transx402.browser.min.js";

  TransX402.paywall({
    apiKey: "ipk_sandbox_...",
    environment: "local",
    selector: "#premium-content",
    price: 5000,
    currency: "IDR",
    merchantWallet: "0x...",
    title: "Premium Article",
    description: "Pay Rp 5,000 to unlock",
  });

  // Or: TransX402.create({ apiKey, environment })
</script>
```

## Environments

Package developers only need `apiKey` + `environment` (or `facilitatorUrl`). RPC / IDRX / Permit2 belong in the API configuration, not in your app.

| `environment` | Facilitator | Key prefix |
|---------------|-------------|------------|
| `local` | `http://localhost:3402` | `ipk_sandbox_` |
| `camp` | `https://sandbox.transx402.com` | `ipk_sandbox_` |
| `base` | `https://api.transx402.com` | `ipk_live_` |

Sandbox → production: use `environment: "base"` with an `ipk_live_...` key. Same payment code.

## Local development

```bash
pnpm install
pnpm test
pnpm build
```

| Script | Purpose |
|--------|---------|
| `pnpm build` | Emit `dist/` ESM + CJS + browser bundles |
| `pnpm test` | Vitest |
| `pnpm type-check` | `tsc --noEmit` |

## Releases

This package follows [semantic versioning](https://semver.org/).

1. Update [`CHANGELOG.md`](./CHANGELOG.md) and bump `version` in `package.json`.
2. Commit, then tag: `git tag vX.Y.Z && git push origin main --tags`.
3. Publish: `npm publish --access public` (runs `prepublishOnly`: test + build).

CDN deploy (`cdn.transx402.com`) should unpack the published npm tarball and serve `dist/transx402.browser.min.js` (prod) or `dist/transx402.browser.js` (debug).
