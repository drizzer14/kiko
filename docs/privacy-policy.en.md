# Privacy Policy for Kiko

> 🇺🇦 [Українською](./privacy-policy.md) · 🇬🇧 English

**Effective date:** 5 October 2026

Kiko is a personal finance app developed by Dmytro Vasylkivskyi ("we", "us").
This policy explains how Kiko handles your information.

**Short version:** Your data stays on your device. Kiko has no server of ours,
and we never receive, store, or have access to your financial data.

**Kiko is an independent app.** It is not a bank or a financial institution,
and it is not affiliated with, endorsed by, or partnered with any bank, broker,
or other service named in the app. Bank and broker names appear only to label
the accounts and statements you choose to add. Kiko never initiates payments or
moves money — it only displays data you provide.

## 1. We operate no server and collect nothing

Kiko has no backend operated by us. There is no Kiko account to create. We do
not collect, receive, transmit to ourselves, or have any access to your data.
Everything you do in Kiko happens on your own device.

## 2. Data stored on your device

The information you enter or sync is stored only on your device:

- Your accounts, holdings, transactions, balances, prices, categories, and
  settings.
- The API credentials you choose to add (for example a Monobank token or a
  Binance API key and secret).
- The reminders you set up. iOS shows them as local notifications on your
  device; their text never names an account or an amount.

This data is kept in an on-device database encrypted with AES-256 (SQLCipher).
Your API credentials are stored in the iOS Keychain, the system's secure
credential store.

**Exports.** When you export your data, Kiko writes an encrypted file
(AES-256-GCM) with a key that is shown only to you. The file includes your
saved tokens and keys only if you turn on "Include saved passwords & keys"
(off by default) and confirm with Face ID or your device passcode. Kiko never
uploads an export anywhere; you choose where to save or share it. Keep the file
and its key safe.

## 3. Connections to third-party services

Kiko communicates directly from your device with the services below, only as
far as your accounts and holdings need them. Some connections run only after
you connect an account, add a Bitcoin address, or save a key (Monobank
statements, Binance, Blockstream). Others run automatically to value
what you track: currency exchange rates (Monobank and the National Bank of
Ukraine), cryptocurrency prices (CoinGecko), and precious-metal prices and the
government bond register (National Bank of Ukraine). Kiko does not route these
connections through any server of ours. Like any internet connection, each
service can see your device's IP address.

- **Monobank** (`api.monobank.ua`) — your bank account information and
  statements, using your personal token; also public currency exchange rates,
  for which no token or personal data is sent.
- **Binance** (`api.binance.com`) — your Binance balances (spot, funding,
  Simple Earn), your deposit and withdrawal history, your Binance Pay history,
  your transfers between your Binance wallets (universal transfer), and your
  Simple Earn subscriptions, redemptions and rewards, using your read-only API
  key.
- **Blockstream** (`blockstream.info`) — the public on-chain balance of a
  Bitcoin address you add. Kiko sends that address to Blockstream to look it up.
- **CoinGecko** (`api.coingecko.com`) — the current price and the daily price
  history of each cryptocurrency you hold. Kiko sends only the names of those
  coins (for example `bitcoin`); no address, amount, or credential is sent.
- **National Bank of Ukraine** (`bank.gov.ua`) — public currency exchange
  rates and their history, precious-metal prices, and the public register of
  government bonds. Kiko downloads the whole register, so the ISIN you enter is
  not sent. No personal data is sent.

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
transactions inside the app at any time. Deleting the app removes its database
from your device, but iOS can keep items saved in the Keychain, such as your
Monobank token and Binance keys, after the app is deleted. To remove them, first
disconnect each connected account (open the account and tap Disconnect), then
delete the app.

## 7. Children

Kiko is not directed to children under 13 and does not knowingly collect data
from them.

## 8. Changes to this policy

We may update this policy. When we do, we will change the effective date at the
top of this page.

## 9. Contact

If you have questions about this policy, contact us at:
**drizzer14@icloud.com**
