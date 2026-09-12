# Kiko

> 🇺🇦 [Українською](./README.md) · 🇬🇧 English

**Kiko (Кіко)** is a private, local-first personal-finance app for iPhone. It
brings your bank, cash, and crypto into one net-worth view — with no server, no
account, and no tracking.

## Features

- **One net worth, many sources.** Track accounts, holdings, and transactions
  across banks, cash, and crypto in a single view.
- **Monobank sync.** Pull your Monobank balance and statements with your
  personal API token.
- **Binance sync.** Read your Binance spot balances with a read-only API key
  (requests are HMAC-signed on-device).
- **Bitcoin on-chain.** Add a Bitcoin address and Kiko reads its balance from a
  public block explorer (Blockstream).
- **Multi-currency.** Hold UAH, USD, EUR, and BTC. Kiko converts everything into
  your base currency using National Bank of Ukraine and CoinGecko rates.
- **Statistics.** A net-worth line over time, an account-contribution donut, and
  a category donut with a spending trend.
- **Categories.** Organize spending with colored categories.
- **Two languages.** Full Ukrainian and English localization.

## Privacy and security

Kiko is local-first and privacy-respecting:

- **No server, no account, no tracking.** The app has no backend operated by us,
  and it contains no analytics, ads, or crash-reporting software.
- **Encrypted at rest.** The database is encrypted with AES-256 (SQLCipher). API
  credentials live in the iOS Keychain.
- **Pinned TLS.** Credential-bearing connections use TLS with certificate
  pinning.
- **App lock.** Optional Face ID or device-passcode lock.

Full policy: [Privacy Policy](./docs/privacy-policy.en.md) ·
online at <https://drizzer14.github.io/kiko/en.html>

## Platform

- iPhone only, iOS 26 or newer (uses Apple's Liquid Glass design).
- Dark theme.

## Tech stack

- **React Native** 0.87 + **TypeScript**, React 19
- **op-sqlite** + **Drizzle ORM** — the encrypted local database
- **react-native-unistyles** — the design system and theming
- **React Navigation** with a native bottom-tab bar
- **react-native-reanimated** + **react-native-sortables** — gestures and
  drag-and-drop
- **react-native-svg** — the charts
- **react-native-keychain** — secure credential storage
- **@noble/hashes** — Binance request signing

## Getting started (development)

You need a working React Native iOS environment: Xcode, Node, and the Ruby
bundler.

```sh
# 1. Install JS dependencies (postinstall also generates .env from .env.example)
npm install

# 2. Install the iOS native pods
bundle install
(cd ios && bundle exec pod install)

# 3. Run on a simulator
npm run ios

# Or deploy to a connected iPhone
npm run deploy:device
```

Configuration lives in `.env` (public, non-secret values, auto-generated from
`.env.example`). Secrets are never stored there — they go in the iOS Keychain.

## Quality harness

Kiko ships a strict, LLM-guarding quality harness. Every check runs through a
wrapper in `scripts/checks/`:

```sh
npm run check:all    # lint, dup, knip, deps, security, rules, plist, secrets, overrides, typecheck
npm run check:deep   # mutation testing, then a known-CVE scan
npm test             # Jest unit tests
```

See [`CLAUDE.md`](./CLAUDE.md) for the full harness reference.

## License

© Dmytro Vasylkivskyi. All rights reserved.
