# Payment Fee Calculator

An OrangeTower Analytics tool for modeling U.S. merchant fees. Compare Stripe, Shopify Payments, Square, and PayPal using one-time orders, subscriptions, or both. The browser calculates the estimate and can encode the inputs in a shareable URL.

## Run locally

Use Node.js 22.13+ or 24+.

```sh
npm ci
npm run dev
```

The app works at `/` and `/fee-calculator`. Run `npm test` for the nine examples in the brief and additional regression checks. Run `npm run build` to produce the static `dist/` directory at the root of this project.

## Embed and configure

Import the named `Calculator` export from `src/Calculator.tsx` into a React page. The component imports its own styles. Set `syncUrl` on a dedicated calculator page to enable URL sharing. Leave it off inside a host page that manages its own query string. Pass `initialScenario` to set alternate initial values.

Update the CTA in `src/config.ts`. Email is disabled by default. Enabling it opens a draft in the visitor’s mail client.

## Update rates

Provider rates and dated source links live in `src/data/fees.json`. The fee math lives in `src/lib/calc.ts`. Update both the rate and its supporting source when a schedule changes, then rerun the tests.

Shopify's third-party fee applies to eligible online sales. The hosted Shopify plan and external processing charges are shown separately. The calculator treats processing fees kept on refunded sales as part of estimated fees on gross charges. The domestic card breakdown applies selected Visa and Mastercard program examples and an editable network assessment. Its assumptions leave the provider estimate unchanged.
