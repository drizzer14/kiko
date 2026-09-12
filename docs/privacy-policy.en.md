# Privacy Policy for Kiko

> 🇺🇦 [Українською](./privacy-policy.md) · 🇬🇧 English

**Effective date:** 12 September 2026

Kiko is a personal finance app developed by Dmytro Vasylkivskyi ("we", "us").
This policy explains how Kiko handles your information.

**Short version:** Your data stays on your device. Kiko has no server of ours,
and we never receive, store, or have access to your financial data.

## 1. We operate no server and collect nothing

Kiko has no backend operated by us. There is no Kiko account to create. We do
not collect, receive, transmit to ourselves, or have any access to your data.
Everything you do in Kiko happens on your own device.

## 2. Data stored on your device

The information you enter or sync is stored only on your device:

- Your accounts, holdings, transactions, balances, categories, and settings.
- The API credentials you choose to add (for example a Monobank token or a
  Binance API key and secret).

This data is kept in an on-device database encrypted with AES-256 (SQLCipher).
Your API credentials are stored in the iOS Keychain, the system's secure
credential store.

## 3. Connections to third-party financial services

When you choose to connect an account, Kiko communicates directly from your
device to that service, using the credentials you provided, to fetch your own
data. Kiko does not route these connections through any server of ours.

- **Monobank** (`api.monobank.ua`) — your bank account information and
  statements, using your personal token.
- **Binance** (`api.binance.com`) — your Binance spot balances, using your
  read-only API key.
- **Blockstream** (`blockstream.info`) — the public on-chain balance of a
  Bitcoin address you add.
- **CoinGecko** (`api.coingecko.com`) — the public Bitcoin price. No personal
  data is sent.
- **National Bank of Ukraine** (`bank.gov.ua`) — public currency exchange
  rates. No personal data is sent.

Each service processes your requests under its own privacy policy. Kiko sends
only what a service needs to return your data. Connections that carry a
credential use TLS with certificate pinning.

## 4. No analytics, tracking, or advertising

Kiko contains no analytics, advertising, tracking, or crash-reporting software.
We do not track you across apps or websites, and we do not build a profile of
you. Kiko does not display ads and does not sell or share your data.

## 5. Security

- The on-device database is encrypted with AES-256 (SQLCipher).
- API credentials are stored in the iOS Keychain.
- Credential-bearing network connections use TLS with certificate pinning.
- You can protect the app with Face ID or your device passcode.

## 6. Data retention and deletion

Your data lives only on your device. You can delete accounts, holdings, and
transactions inside the app at any time. Deleting the app removes all of its
local data and stored credentials from your device.

## 7. Children

Kiko is not directed to children under 13 and does not knowingly collect data
from them.

## 8. Changes to this policy

We may update this policy. When we do, we will change the effective date at the
top of this page.

## 9. Contact

If you have questions about this policy, contact us at:
**drizzer14@icloud.com**
