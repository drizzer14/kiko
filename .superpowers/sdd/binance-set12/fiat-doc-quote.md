# Binance fiat and P2P status docs: verbatim quotes (set 12, step 2/14)

Fetched 2026-10-23 with `curl -sS -L` by kiko:developer (binance-s12-a1). Each file was saved to the
scratchpad `doc-quotes/` folder and read as data only. The quoted lines are copied character for
character from the saved files; the `N:` prefix is the line number in the source file. Nothing below the
quoted blocks is a paraphrase of Binance text: the "Reading" lines are this set's own notes.

## 1. Fiat deposit / withdraw history, java connector

- URL: https://raw.githubusercontent.com/binance/binance-connector-java/master/clients/fiat/docs/GetFiatDepositWithdrawHistoryResponseDataInner.md
- Fetch date: 2026-10-23. HTTP status: 200 (696 bytes).

```
3: # GetFiatDepositWithdrawHistoryResponseDataInner
10: |**orderNo** | **String** |  |  [optional] |
11: |**fiatCurrency** | **String** |  |  [optional] |
12: |**indicatedAmount** | **String** |  |  [optional] |
13: |**amount** | **String** |  |  [optional] |
14: |**totalFee** | **String** |  |  [optional] |
15: |**method** | **String** |  |  [optional] |
16: |**status** | **String** | Processing, Failed, Successful, Finished, Refunding, Refunded, Refund Failed, Order Partial Credit Stopped |  [optional] |
17: |**createTime** | **Long** |  |  [optional] |
18: |**updateTime** | **Long** |  |  [optional] |
```

Reading: line 16 is the only status text. It lists eight words and says nothing about money, balance,
credit or debit. There is no `fee` field; the field is `totalFee` (line 14).

## 2. Fiat payments history, java connector

- URL: https://raw.githubusercontent.com/binance/binance-connector-java/master/clients/fiat/docs/GetFiatPaymentsHistoryResponseDataInner.md
- Fetch date: 2026-10-23. HTTP status: 200 (688 bytes).

```
3: # GetFiatPaymentsHistoryResponseDataInner
10: |**orderNo** | **String** |  |  [optional] |
11: |**sourceAmount** | **String** |  |  [optional] |
12: |**fiatCurrency** | **String** |  |  [optional] |
13: |**obtainAmount** | **String** |  |  [optional] |
14: |**cryptoCurrency** | **String** |  |  [optional] |
15: |**totalFee** | **String** |  |  [optional] |
16: |**price** | **String** |  |  [optional] |
17: |**status** | **String** |  |  [optional] |
18: |**paymentMethod** | **String** |  |  [optional] |
19: |**createTime** | **Long** |  |  [optional] |
20: |**updateTime** | **Long** |  |  [optional] |
```

Reading: line 17, `status`, has an empty description. No status word is listed.

## 3. P2P (C2C) trade history, java connector

### 3a. Response fields

- URL: https://raw.githubusercontent.com/binance/binance-connector-java/master/clients/c2c/docs/GetC2CTradeHistoryResponseDataInner.md
- Fetch date: 2026-10-23. HTTP status: 200 (1410 bytes).

```
3: # GetC2CTradeHistoryResponseDataInner
10: |**orderNumber** | **String** |  |  [optional] |
11: |**advNo** | **String** |  |  [optional] |
12: |**tradeType** | **String** |  |  [optional] |
13: |**asset** | **String** |  |  [optional] |
14: |**fiat** | **String** |  |  [optional] |
15: |**fiatSymbol** | **String** |  |  [optional] |
16: |**amount** | **String** | Quantity (in Crypto) |  [optional] |
17: |**totalPrice** | **String** | Total order amount in fiat |  [optional] |
18: |**unitPrice** | **String** | Unit Price (in Fiat) |  [optional] |
19: |**orderStatus** | **String** |  |  [optional] |
20: |**createTime** | **Long** | Order creation timestamp in milliseconds |  [optional] |
21: |**commission** | **String** | Transaction Fee (in Crypto) |  [optional] |
22: |**counterPartNickName** | **String** | Counterparty nickname |  [optional] |
23: |**payMethodName** | **String** | Identifier of the payment method |  [optional] |
24: |**additionalKycVerify** | **Long** | KYC verification status. 0: not required, 1: not verified, 2: verified |  [optional] |
25: |**takerCommissionRate** | **String** | Taker commission rate |  [optional] |
26: |**takerCommission** | **String** | Taker commission amount |  [optional] |
27: |**takerAmount** | **String** | Taker trade amount |  [optional] |
28: |**advertisementRole** | **String** |  |  [optional] |
```

Reading: `orderStatus` (line 19), `tradeType` (line 12) and `advertisementRole` (line 28) have empty
descriptions. No value is listed for any of the three.

### 3b. Endpoint and parameters

- URL: https://raw.githubusercontent.com/binance/binance-connector-java/master/clients/c2c/docs/DefaultApi.md
- Fetch date: 2026-10-23. HTTP status: 200 (3117 bytes).

```
7: | [**getC2CTradeHistory**](DefaultApi.md#getC2CTradeHistory) | **GET** /sapi/v1/c2c/orderMatch/listUserOrderHistory | Get C2C Trade History (USER_DATA) |
12: > GetC2CTradeHistoryResponse getC2CTradeHistory(tradeType, startTimestamp, endTimestamp, page, rows)
16: Get C2C Trade History  Weight(IP): 1  Security Type: USER_DATA  Notes: - The max interval between &#x60;startTimestamp&#x60; and &#x60;endTimestamp&#x60; is 30 days. - If &#x60;startTimestamp&#x60; and &#x60;endTimestamp&#x60; are not sent, the recent 30 days&#39; data is returned. - You can only view data from the past 6 months. For all C2C orders, check &#x60;https://c2c.binance.com/en/fiatOrder&#x60;.
56: | **tradeType** | [**TradeType**](.md)| Trade side filter | [optional] [enum: BUY, SELL] |
57: | **startTimestamp** | **Long**|  | [optional] |
58: | **endTimestamp** | **Long**|  | [optional] |
59: | **page** | **Long**| Page number | [optional] |
60: | **rows** | **Long**| Number of records per page | [optional] |
```

Reading: the doc states "Weight(IP): 1" and "past 6 months" and a 30-day maximum interval. Probes
3-5 measured UID weight 900 and rows back to about 2023-09 (more than 6 months), so the measured values
win (plan step 2/14). The 30-day interval, `tradeType` BUY/SELL, `page` and `rows` are consistent with
what the app sends.

## 4. TypeScript connector types

### 4a. Fiat deposit / withdraw history

- URL: https://raw.githubusercontent.com/binance/binance-connector-js/master/clients/fiat/src/rest-api/types/get-fiat-deposit-withdraw-history-response-data-inner.ts
- Fetch date: 2026-10-23. HTTP status: 200 (1812 bytes).

```
57:     method?: string;
58:     /**
59:      * Processing, Failed, Successful, Finished, Refunding, Refunded, Refund Failed, Order Partial Credit Stopped
60:      * @type {string}
61:      * @memberof GetFiatDepositWithdrawHistoryResponseDataInner
62:      */
63:     status?: string;
```

Reading: the same eight words, same text as source 1.

### 4b. Fiat payments history

- URL: https://raw.githubusercontent.com/binance/binance-connector-js/master/clients/fiat/src/rest-api/types/get-fiat-payments-history-response-data-inner.ts
- Fetch date: 2026-10-23. HTTP status: 200 (1891 bytes).

```
64:     /**
65:      *
66:      * @type {string}
67:      * @memberof GetFiatPaymentsHistoryResponseDataInner
68:      */
69:     status?: string;
```

Reading: line 65 (the description line of `status`) is empty. No word is listed.

## 5. Postman collections (parameters only)

### 5a. Fiat

- URL: https://raw.githubusercontent.com/binance/binance-api-postman/master/collections/Binance%20Fiat%20API.json
- Fetch date: 2026-10-23. HTTP status: 200 (23324 bytes, 552 lines).

```
293:             "name": "Get Fiat Deposit/Withdraw History (USER_DATA)",
315:                     "raw": "{{url}}/sapi/v1/fiat/orders",
321:                             "key": "transactionType",
322:                             "value": "0",
323:                             "description": "0: deposit, 1: withdraw",
327:                             "key": "beginTime",
333:                             "key": "endTime",
339:                             "key": "page",
345:                             "key": "rows",
346:                             "value": "100",
395:                     "raw": "{{url}}/sapi/v1/fiat/payments",
401:                             "key": "transactionType",
402:                             "value": "0",
403:                             "description": "0: buy, 1: sell",
407:                             "key": "beginTime",
413:                             "key": "endTime",
419:                             "key": "page",
425:                             "key": "rows",
426:                             "value": "100",
```

Reading: a search of the whole file (case-insensitive) for `status`, `Processing`, `Failed`, `Refund`,
`Successful` and `Completed` finds nothing. The parameter names match the app's query. The only example
`rows` value is 100 (lines 346, 426), not a stated maximum.

### 5b. C2C

- URL: https://raw.githubusercontent.com/binance/binance-api-postman/master/collections/Binance%20C2C%20API.json
- Fetch date: 2026-10-23. HTTP status: 200 (10645 bytes, 221 lines).

```
152:             "name": "Get C2C Trade History (USER_DATA)",
174:                     "raw": "{{url}}/sapi/v1/c2c/orderMatch/listUserOrderHistory",
180:                             "key": "tradeType",
181:                             "value": "BUY",
182:                             "description": "Trade side filter",
186:                             "key": "startTimestamp",
192:                             "key": "endTimestamp",
198:                             "key": "page",
200:                             "description": "Page number",
204:                             "key": "rows",
205:                             "value": "100",
206:                             "description": "Number of records per page",
```

Reading: a search of the whole file for `status`, `COMPLETED`, `PENDING`, `TRADING`, `BUYER_PAYED`,
`DISTRIBUTING`, `APPEAL` and `CANCEL` finds nothing.

## 6. developers.binance.com pages (bot-checked)

| URL | Fetch date | HTTP status | Body |
|---|---|---|---|
| https://developers.binance.com/docs/fiat/rest-api/Get-Fiat-Deposit-Withdraw-History | 2026-10-23 | 202 | 0 bytes |
| https://developers.binance.com/docs/fiat/rest-api/Get-Fiat-Payments-History | 2026-10-23 | 202 | 0 bytes |
| https://developers.binance.com/docs/c2c/rest-api/Get-C2C-Trade-History | 2026-10-23 | 202 | 0 bytes |

No text could be read. The user pastes the page text if S12-Q4 asks for it.

## Per word: the doc text that shows what each status means for money

C-NR-E: a word is ignored only with text showing that no money moved. No source above contains such
text for any word.

| Endpoint | Word | Doc text | 
|---|---|---|
| fiat orders | `Failed` | no doc text found that says what it means for money; the word appears only in the list, source 1 line 16 and source 4a line 59 |
| fiat orders | `Refunded` | no doc text found that says what it means for money; the word appears only in the same list |
| fiat orders | `Successful` | no doc text found that says what it means for money; the word appears only in the same list |
| fiat orders | `Processing` | no doc text found that says what it means for money; the word appears only in the same list |
| fiat payments | `Failed` | no doc text found (source 2 line 17 and source 4b line 65 are empty) |
| fiat payments | `Refunded` | no doc text found |
| fiat payments | `Completed` | no doc text found |
| fiat payments | `Processing` | no doc text found |
| P2P | `COMPLETED` | no doc text found (source 3a line 19 is empty) |
| P2P | `PENDING` | no doc text found |
| P2P | `TRADING` | no doc text found |
| P2P | `BUYER_PAYED` | no doc text found |
| P2P | `DISTRIBUTING` | no doc text found |
| P2P | `IN_APPEAL` | no doc text found |

Also in the fiat orders list (source 1 line 16), words the plan does not name, none with any text on
money: `Finished`, `Refunding`, `Refund Failed`, `Order Partial Credit Stopped`.
