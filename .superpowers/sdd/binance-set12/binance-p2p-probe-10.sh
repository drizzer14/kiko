#!/usr/bin/env bash
# Kiko crypto-exchanges 1.3: P2P FIRST WALK probe 10 (S12-Q7, S12-Q8). A READ-ONLY live probe with
# the user's OWN Binance key (a key with ONLY "Enable Reading" is enough).
#
# Why: set 12 reads the P2P history (GET /sapi/v1/c2c/orderMatch/listUserOrderHistory) forward from
# HISTORY_FLOOR_MS in 30-day windows, two series (BUY, SELL) per window, and the lane cap
# `LANE_CALL_CAPS.p2p` is 10 until a measured reason moves it. The spec asks for a measured
# first-walk report. Probe 10 walks exactly what the app would walk, with NO lane cap, and measures:
#   1  the P2P walk      every 30-day window from HISTORY_FLOOR_MS (1499990400000, 2017-07-14) to
#                        now, windows contiguous as `buildWalkWindows` builds them (the end of a
#                        window is the start of the next, the last ends at now), BUY then SELL in
#                        each window, page=1.. rows=100 until a short page (or the response total
#                        is read, or 20 pages). Report: calls, pages, wall time, the gate estimate,
#                        the X-SAPI-USED-UID-WEIGHT-1M peak, throttle waits, the index of the oldest
#                        and of the newest window that holds an order, the orders read, and the
#                        orderStatus / tradeType / advertisementRole WORDS the account really has.
#   2  the lane caps     from the calls of step 1, the app runs a lane cap of 10, 20 and 40 calls
#                        would need (a window starts in a run only when room for both series is
#                        left, as `readSeriesSpan` requires), the run each end window falls in, the
#                        largest UID weight any 60 s of a run holds (the measured call start times
#                        of that run) and the run wall times. Arithmetic over measured calls; no
#                        extra call is made for it.
#   3  fiat samples      ONE page each of GET /sapi/v1/fiat/orders (transactionType 0 and 1, rows
#                        500) and GET /sapi/v1/fiat/payments (transactionType 0 and 1, rows
#                        100) over the newest 2-year window (the app's FIAT_WINDOW_MS = 730
#                        days): HTTP status, the Binance code, the row count, the response
#                        total, the key names of the first record and the status WORDS. Nothing
#                        else of a fiat row.
#
# Output rule (strict): only counts, window indexes, JSON type words, enum WORDS (orderStatus,
# tradeType, advertisementRole, fiat status; a word that is not letters, underscores and spaces,
# or is longer than 40 characters, is shown as (other)), key names of a schema, wall times in ms,
# weight peaks, HTTP status and Binance codes. NEVER an order number, amount, price, asset, fiat
# code, nickname, time, user id or key. The order rows live in the private temp directory only and
# no report function prints a column of them but the three word columns. The ONE exception, kept
# from probes 8 and 9: the Binance error msg of an error answer, with every digit run masked as #
# (so an IP address becomes #.#.#.#), every character outside letters, digits, space and
# . , : ; _ ( ) - shown as ?, a run of 20 or more letters and digits masked, and cut at 160
# characters.
#
# Kept from probe 9, unchanged in behaviour:
#   key loading   the key and the secret come from a hidden prompt only (no argument, no
#                 environment variable, no file); curl gets the URL and the key header on stdin
#                 (`--config -`), so neither is in argv or `ps`; the HMAC secret goes to perl on
#                 stdin, never in argv.
#   clock         GET /api/v3/time (public) at the start; the offset is serverTime minus the local
#                 clock when the first response byte arrived, a LOWER BOUND (a signed timestamp can
#                 lag the server clock but never lead it). recvWindow is 10000, doubled for the rest
#                 of the run after a retried -1021, and the offset is read again after every -1021.
#   retry         ONE retry per call on HTTP 400 code -1021, HTTP 000 or HTTP 5xx; a retry counts
#                 against the call cap and the weight throttle like any call.
#   limits        the run stops, and prints what it read, at the call cap or after the run time
#                 limit, whichever comes first (exit 3). A 418, 429 or 403 stops the run at once.
#                 The run waits (60 s weight window) until a call's weight fits the budget. The
#                 first signed call failing (the account read) stops the run (exit 3) and the
#                 report still prints the error answer. Three errors in a row stop the run.
#   GET only      every request goes through signed_call (signed) or public_get (public), and both
#                 refuse, before a byte is sent, any method but GET, any path that is not on the
#                 allowlist below and any query that is not the one listed for its path. There is
#                 no POST, PUT or DELETE anywhere in this file. The curl config is refused unless
#                 it is a plain url + header GET.
#   key check     the first signed call is GET /api/v3/account?omitZeroBalances=true (IP weight 20);
#                 its body is never read, only its HTTP status.
#
# Changed from probe 9, on purpose:
#   gate          PAUSE_MS is 350, the app's BINANCE_REQUEST_INTERVAL_MS, and it is the gap from the
#                 START of one request to the start of the next, as the app's gate counts it: after
#                 a response the script sleeps only what is left of 350 ms. (Probe 9 slept 350 ms
#                 after every response.) The per-minute call rate, and so the UID weight peak, is
#                 then the app's, not lower.
#   UID budget    UID_BUDGET_1M is 180000, the app's UID_WEIGHT_BUDGET_1M, so the probe waits where
#                 the app would; the waits are counted per part.
#   walk          no lane cap: the walk reads every window. CALL_CAP and MAX_RUN_SECONDS are sized
#                 when the window count is known (see size_limits); until then a setup cap of 30
#                 calls and 900 s hold. An explicit CALL_CAP or MAX_RUN_SECONDS in the environment
#                 is used as given for the whole run.
#
# Endpoint allowlist (all GET):
#   public   /api/v3/time           (no query)
#   signed   /api/v3/account        (IP weight 20; only omitZeroBalances=true)
#            /sapi/v1/c2c/orderMatch/listUserOrderHistory   (UID weight 900; only
#                 tradeType=BUY|SELL&startTimestamp=<digits>&endTimestamp=<digits>&page=<digits>
#                 &rows=100)
#            /sapi/v1/fiat/orders    (UID weight 45000; only transactionType=0|1&beginTime=<digits>
#                 &endTime=<digits>&page=1&rows=500)
#            /sapi/v1/fiat/payments  (IP weight 1; only transactionType=0|1&beginTime=<digits>
#                 &endTime=<digits>&page=1&rows=100)
#
# Run it from the MAIN checkout (memory/refs lives there), with the path of this file in the set 12
# worktree; the report goes to the file, progress stays on the terminal:
#   PROBE=/Users/drizzer14/orca/workspaces/pff-ios/binance-set7/.superpowers/sdd/binance-set12
#   cd /Users/drizzer14/Developer/Projects/pff-ios
#   bash "$PROBE/binance-p2p-probe-10.sh" probe10 \
#     > memory/refs/binance-p2p-probe-10-output-$(date +%F).txt
# Offline self-test of the paging, the caps, the words, the report and the allowlist (no network, no
# key prompt):
#   bash .superpowers/sdd/binance-set12/binance-p2p-probe-10.sh selftest
# Paste the output file back. Do not open or refresh Kiko during the run (it shares the Binance
# weight budget). Expected time: about 2 x windows + 4 calls (about 230 calls) at 350 ms to 1 s
# each, so 2 to 5 minutes; the plan line gives the numbers. Ctrl-C prints what was read so far.
#
# Exit codes: 0 done (or selftest passed; an empty history is a valid answer), 1 usage / bad input /
# selftest failed, 3 the run stopped (cap, time limit, a failed first signed call, rate limit),
# 129/130 hang-up / interrupted.
#
# Tunables (environment variables, all optional): PAUSE_MS (350), UID_BUDGET_1M (180000, per
# endpoint), IP_BUDGET_1M (3000), CALL_CAP and MAX_RUN_SECONDS (sized from the window count),
# EXTRA_PAGES_ALLOWANCE (40), RETRY_ALLOWANCE (20), RECV_WINDOW (10000, 1000 to 60000), LANE_CAPS
# ("10 20 40", the caps of the second report part).
#
# Data handling: the response body of the call in flight, the order rows and the call logs live in a
# private temp directory (umask 077) that is deleted when the script exits (also on Ctrl-C or a 429
# stop).
set -euo pipefail
umask 077
# One byte order for every sort, so the tallies print in the same order on every machine.
export LC_ALL=C

PART="${1:-probe10}"
case "$PART" in
  probe10 | selftest) ;;
  *)
    echo "Usage: bash binance-p2p-probe-10.sh [probe10|selftest]. Stop." >&2
    exit 1
    ;;
esac

BASE_URL='https://api.binance.com'
RECV_WINDOW="${RECV_WINDOW:-10000}"
RECV_WINDOW_START="$RECV_WINDOW"
RECV_WINDOW_MAX=60000
PAUSE_MS="${PAUSE_MS:-350}"
UID_BUDGET_1M="${UID_BUDGET_1M:-180000}"
IP_BUDGET_1M="${IP_BUDGET_1M:-3000}"
EXTRA_PAGES_ALLOWANCE="${EXTRA_PAGES_ALLOWANCE:-40}"
RETRY_ALLOWANCE="${RETRY_ALLOWANCE:-20}"
LANE_CAPS="${LANE_CAPS:-10 20 40}"
CALL_CAP_USER="${CALL_CAP:-}"
MAX_RUN_USER="${MAX_RUN_SECONDS:-}"
# The setup holds until the window count is known: the clock and the account read with a retry
# each, and the clock reads a -1021 retry makes.
SETUP_CALL_CAP=30
SETUP_MAX_RUN_SECONDS=900
CALL_CAP="${CALL_CAP_USER:-$SETUP_CALL_CAP}"
MAX_RUN_SECONDS="${MAX_RUN_USER:-$SETUP_MAX_RUN_SECONDS}"
# What one call takes in the worst plausible case, for the run time limit: the 0.35 s gate plus a
# response of up to 1.65 s; a retry waits 2 s and repeats the call.
SECONDS_PER_CALL=2
SECONDS_PER_RETRY=5
TIME_SLACK_SECONDS=180
# Each SAPI endpoint has its own UID limit of 180000 a minute (research-binance-ops.md).
UID_LIMIT_1M=180000
TIME_PATH='/api/v3/time'
ACCOUNT_PATH='/api/v3/account'
ACCOUNT_QUERY='omitZeroBalances=true'
P2P_PATH='/sapi/v1/c2c/orderMatch/listUserOrderHistory'
FIAT_ORDERS_PATH='/sapi/v1/fiat/orders'
FIAT_PAYMENTS_PATH='/sapi/v1/fiat/payments'
# binance.transactions.ts: HISTORY_FLOOR_MS = Date.UTC(2017, 6, 14).
HISTORY_FLOOR_MS=1499990400000
DAY_MS=86400000
# P2P_WINDOW_MS (30 days) and FIAT_WINDOW_MS (730 days) of the set 12 plan.
WINDOW_MS=$((30 * DAY_MS))
FIAT_SPAN_MS=$((730 * DAY_MS))
P2P_ROWS=100
P2P_PAGE_CAP=20
FIAT_ORDERS_ROWS=500
FIAT_PAYMENTS_ROWS=100
# The measured weights: P2P UID 900 a call, fiat orders UID 45000 a call (probes 3-5); the account
# read IP 20; fiat payments IP 1.
P2P_UID_COST=900
FIAT_ORDERS_UID_COST=45000
FIAT_PAYMENTS_UID_COST=0
ACCOUNT_IP_COST=20
SAPI_IP_COST=1
for number in "$UID_BUDGET_1M" "$IP_BUDGET_1M" "$CALL_CAP" "$MAX_RUN_SECONDS" "$RECV_WINDOW" "$EXTRA_PAGES_ALLOWANCE" "$RETRY_ALLOWANCE" "$PAUSE_MS"; do
  case "$number" in
    '' | *[!0-9]*)
      echo "A budget, cap, time limit, allowance, pause or recvWindow is not a whole number. Stop." >&2
      exit 1
      ;;
  esac
done
for number in $LANE_CAPS; do
  case "$number" in
    '' | *[!0-9]* | 0)
      echo "LANE_CAPS must hold whole numbers above zero. Stop." >&2
      exit 1
      ;;
  esac
done
if [ "$RECV_WINDOW" -lt 1000 ] || [ "$RECV_WINDOW" -gt "$RECV_WINDOW_MAX" ]; then
  echo "RECV_WINDOW must be 1000 to ${RECV_WINDOW_MAX}. Stop." >&2
  exit 1
fi

for tool in jq perl curl date mktemp sleep awk sort sed cat wc tr cut; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing tool: ${tool}. Install it first (for jq: brew install jq). Stop." >&2
    exit 1
  fi
done

# ---- the allowlist: the ONLY requests this script can send ----
ALLOWED_SIGNED_PATHS=" ${ACCOUNT_PATH} ${P2P_PATH} ${FIAT_ORDERS_PATH} ${FIAT_PAYMENTS_PATH} "
ALLOWED_PUBLIC_PATHS=" ${TIME_PATH} "
# request_allowed <method> <path> <signed|public>: success only for a GET of an allowlisted path.
request_allowed() {
  [ "$1" = GET ] || return 1
  case "$3" in
    signed)
      case "$ALLOWED_SIGNED_PATHS" in *" $2 "*) return 0 ;; esac
      ;;
    public)
      case "$ALLOWED_PUBLIC_PATHS" in *" $2 "*) return 0 ;; esac
      ;;
  esac
  return 1
}
# query_allowed <path> <query>: success only for the one query shape listed for the path.
query_allowed() {
  local p2p_pattern='^tradeType=(BUY|SELL)&startTimestamp=[0-9]+&endTimestamp=[0-9]+&page=[0-9]+&rows=100$'
  local orders_pattern='^transactionType=[01]&beginTime=[0-9]+&endTime=[0-9]+&page=1&rows=500$'
  local payments_pattern='^transactionType=[01]&beginTime=[0-9]+&endTime=[0-9]+&page=1&rows=100$'
  case "$1" in
    "$TIME_PATH") [ -z "$2" ] ;;
    "$ACCOUNT_PATH") [ "$2" = "$ACCOUNT_QUERY" ] ;;
    "$P2P_PATH") [[ $2 =~ $p2p_pattern ]] ;;
    "$FIAT_ORDERS_PATH") [[ $2 =~ $orders_pattern ]] ;;
    "$FIAT_PAYMENTS_PATH") [[ $2 =~ $payments_pattern ]] ;;
    *) return 1 ;;
  esac
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TMPDIR="$WORK"
export TMPDIR
cd "$WORK"
BODY="$WORK/body.json"
HEADERS="$WORK/headers.txt"
WEIGHT_LOG="$WORK/weight.log"
HEADER_LOG="$WORK/header.log"
PART_LOG="$WORK/part.log"
JQ_ERRORS="$WORK/jq-errors.txt"
RESP_LOG="$WORK/resp.tsv"
CLOCK_LOG="$WORK/clock.tsv"
WAIT_LOG="$WORK/waits.log"
ANSWER_LOG="$WORK/answers.tsv"
ATTEMPT_LOG="$WORK/attempts.tsv"
WALK_LOG="$WORK/walk.tsv"
WALK_TIMES="$WORK/walk-times.tsv"
FIAT_LOG="$WORK/fiat.tsv"
FIAT_ROWS="$WORK/private-fiat-rows.tsv"
ORDER_ROWS="$WORK/private-order-rows.tsv"
ORDER_DISTINCT="$WORK/private-order-distinct.tsv"
TALLY_TMP="$WORK/tally.tmp"
for file in "$BODY" "$HEADERS" "$WEIGHT_LOG" "$HEADER_LOG" "$PART_LOG" "$JQ_ERRORS" "$RESP_LOG" \
  "$CLOCK_LOG" "$WAIT_LOG" "$ANSWER_LOG" "$ATTEMPT_LOG" "$WALK_LOG" "$WALK_TIMES" "$FIAT_LOG" \
  "$FIAT_ROWS" "$ORDER_ROWS" "$ORDER_DISTINCT" "$TALLY_TMP"; do
  : >"$file"
done
SECONDS=0

say() { printf '%s\n' "$*"; }
progress() { printf '%s\n' "$*" >&2; }

API_KEY=''
API_SECRET=''
CALLS=0
CURL_FAILS=0
CURL_EXIT=0
STATUS='000'
CODE='empty'
CURRENT_PART='setup'
RUN_STATE='running'
SIGNED_CALLS=0
RETRIES_TOTAL=0
RETRY_RECOVERED=0
RETRY_FAILED=0
RETRY_1021=0
RETRY_000=0
RETRY_5XX=0
CLOCK_OFFSET=0
CLOCK_START_OFFSET=0
CLOCK_START_RTT=0
ATTEMPT_START_MS=0
ATTEMPT_END_MS=0
RESP_MS=0
FIRST_BYTE_MS=0
LOCAL_START_MS=0
TS_KIND='-'
# The series, window index and page of the call in flight (tab separated), for the attempt log.
CALL_TAG=$'-\t0\t0'

ANS_SET=0
ANS_CLASS='-'
ANS_KIND='-'
ANS_MSG=''
KEY_CHECK_STATE='not run'
WALK_STATE='not started'
WALK_NOW=0
WINDOW_COUNT=0
PLAN_WALK_CALLS=0
PLAN_FIAT_CALLS=0
ERROR_STREAK=0
FIAT_STATE='not started'
FIAT_NOW=0
PLAN_PRINTED=0

# A millisecond time as UTC text; the format is a strftime format.
utc_text() { jq -rn --argjson milliseconds "$1" --arg format "$2" '$milliseconds / 1000 | floor | strftime($format)'; }

# The response `code` as digits only (with a leading minus), or a fixed word; never Binance's own
# text. Binance's wrapped answers carry the code as text ("000000").
code_of() {
  if [ ! -s "$BODY" ]; then
    echo 'empty'
    return 0
  fi
  jq -r 'if type == "object" then ((.code // "none") | tostring) as $code
    | (if ($code | length) > 0 and ($code | length) <= 8 and ($code | explode | all((. >= 48 and . <= 57) or . == 45)) then $code else "other" end)
    else "n/a" end' "$BODY" 2>>"$JQ_ERRORS" || echo 'not-json'
}

# Binance's message is read only to pick one fixed class word. "ahead" is tested first.
error_class() {
  jq -r 'if type == "object" then ((.msg // .message // "") | if type == "string" then ascii_downcase else "" end) else "" end
    | if test("ahead") then "timestamp ahead"
      elif test("signature") then "signature"
      elif test("timestamp|recvwindow") then "timestamp behind"
      elif test("permission|api-key|api key") then "permission"
      elif test("too many|rate limit|banned|request weight") then "rate limit"
      elif test("param|illegal|mandatory|invalid|size|limit") then "parameter"
      else "other" end' "$BODY" 2>>"$JQ_ERRORS" || echo 'other'
}

# The UID weight is counted per endpoint; the IP weight over all calls.
window_sums() { # <endpoint path>
  local out
  out="$(awk -v now="$(date +%s)" -v key="$1" '$1 > now - 60 { ip += $3; if ($4 == key) uid += $2 } END { print uid + 0, ip + 0 }' "$WEIGHT_LOG")"
  WIN_UID="${out% *}"
  WIN_IP="${out#* }"
}

# note_wait: one throttle wait of 2 s, booked against the part that waits.
note_wait() { printf '%s\n' "$CURRENT_PART" >>"$WAIT_LOG"; }

# The endpoint's last X-SAPI-USED-UID-WEIGHT-1M (seen within 60 s) plus this call must fit the
# limit: it catches weight spent by something else (Kiko, another script) that this script's own
# log cannot see.
header_wait() { # <endpoint path> <uid cost>
  local last
  while :; do
    last="$(awk -F'\t' -v now="$(date +%s)" -v key="$1" '$2 == key && $1 > now - 60 && $5 ~ /^[0-9]+$/ { seen = $5 } END { print seen + 0 }' "$HEADER_LOG")"
    if [ $((last + $2)) -le "$UID_LIMIT_1M" ]; then
      return 0
    fi
    note_wait
    sleep 2
  done
}

# Wait until the sliding 60 s window (this script's own log) leaves room for this call's weight.
throttle() { # <endpoint path> <uid cost> <ip cost>
  local key="$1" uid_cost="$2" ip_cost="$3"
  while :; do
    window_sums "$key"
    if [ $((WIN_UID + uid_cost)) -le "$UID_BUDGET_1M" ] && [ $((WIN_IP + ip_cost)) -le "$IP_BUDGET_1M" ]; then
      break
    fi
    if [ "$WIN_UID" -eq 0 ] && [ "$WIN_IP" -eq 0 ]; then
      break
    fi
    note_wait
    sleep 2
  done
  if [ "$uid_cost" -gt 0 ]; then
    header_wait "$key" "$uid_cost"
  fi
}

finish_partial() {
  # A second Ctrl-C must not restart the report halfway through it.
  trap - INT TERM HUP
  RUN_STATE='stopped'
  say ""
  say "STOP: interrupted during part ${CURRENT_PART} (after ${CALLS} calls). What is above was read; what is below is partial."
  report_everything
  progress "interrupted" || true
  exit "$1"
}

stop_run() {
  # A Ctrl-C during the report below must not start a second report.
  trap - INT TERM HUP
  RUN_STATE='stopped'
  say ""
  say "STOP: $1 (part ${CURRENT_PART}, after ${CALLS} calls). No further call is made."
  progress "STOP: $1"
  report_everything
  exit 3
}

# The local clock in whole milliseconds (macOS date has no %N; perl is already required for the
# HMAC). Prints nothing when perl fails, so a caller can refuse an empty answer.
local_ms() { /usr/bin/perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000' 2>/dev/null || true; }

# millis_of <seconds as curl prints them, such as 0.123456>: whole milliseconds, or 0 when the text
# is not a plain decimal.
millis_of() {
  local whole fraction
  case "$1" in
    *[!0-9.]* | *.*.* | '' | .* | *.) echo 0 ;;
    *.*)
      whole="${1%%.*}"
      fraction="${1#*.}000"
      echo $((10#$whole * 1000 + 10#${fraction:0:3}))
      ;;
    *) echo $((10#$1 * 1000)) ;;
  esac
}

# pause_rest_ms <response ms>: what is left of the PAUSE_MS gate after a response. The gate counts
# from the START of a request to the start of the next, so a response slower than the gate leaves
# nothing to wait.
pause_rest_ms() {
  local rest=$((PAUSE_MS - $1))
  if [ "$rest" -lt 0 ]; then rest=0; fi
  echo "$rest"
}

# sleep_ms <milliseconds>: sleeps that long (nothing for 0).
sleep_ms() {
  if [ "$1" -gt 0 ]; then
    sleep "$(printf '%d.%03d' $(($1 / 1000)) $(($1 % 1000)))"
  fi
}

# The value of one response header as digits only, or "-" when the header is absent or not a number.
header_value() { # <lowercase header name>
  awk -v name="$1:" '{ line = tolower($0); if (index(line, name) == 1) { value = substr($0, length(name) + 1); gsub(/[ \t\r]/, "", value); if (value ~ /^[0-9]+$/ && length(value) <= 9) found = value } } END { print (found == "" ? "-" : found) }' "$HEADERS"
}

# columns: time, path, X-MBX-USED-WEIGHT-1M, X-SAPI-USED-IP-WEIGHT-1M, X-SAPI-USED-UID-WEIGHT-1M,
# part
record_headers() { # <endpoint path>
  local mbx ip uid
  mbx="$(header_value 'x-mbx-used-weight-1m')"
  ip="$(header_value 'x-sapi-used-ip-weight-1m')"
  uid="$(header_value 'x-sapi-used-uid-weight-1m')"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%s)" "$1" "$mbx" "$ip" "$uid" "$CURRENT_PART" >>"$HEADER_LOG"
}

# fetch <curl config text> <max seconds>: sets STATUS (HTTP status), RESP_MS (curl's time_total in
# whole milliseconds), FIRST_BYTE_MS (curl's time_starttransfer) and CURL_EXIT. The config (URL and
# key header) goes to curl on stdin; printf is a builtin, so it is in no process argv. The config of
# a GET holds only a url and a header line: a request or data line is refused here as a last guard.
fetch() {
  local out code seconds first rest
  case "$1" in
    *'request ='* | *'data ='* | *'upload'* | *'form ='*)
      stop_run 'a curl config other than a plain GET was refused'
      ;;
  esac
  CURL_EXIT=0
  RESP_MS=0
  : >"$BODY"
  : >"$HEADERS"
  out="$(printf '%s\n' "$1" | curl -q -s --compressed --max-time "$2" --proto '=https' --config - -o "$BODY" -D "$HEADERS" -w '%{http_code} %{time_total} %{time_starttransfer}' 2>/dev/null)" || CURL_EXIT=$?
  code=''
  seconds=''
  first=''
  rest=''
  IFS=' ' read -r code seconds first rest <<<"$out" || true
  STATUS="$code"
  RESP_MS="$(millis_of "$seconds")"
  FIRST_BYTE_MS="$(millis_of "$first")"
}

# finish_call <path> <uid cost> <ip cost>: books ONE attempt (a retry is its own attempt), then sets
# CODE. A 429, 418 or 403 stops the whole run at once.
finish_call() {
  local path="$1" uid_cost="$2" ip_cost="$3"
  CALLS=$((CALLS + 1))
  printf '%s %s %s %s\n' "$(date +%s)" "$uid_cost" "$ip_cost" "$path" >>"$WEIGHT_LOG"
  printf '%s\n' "$CURRENT_PART" >>"$PART_LOG"
  record_headers "$path"
  if [ "$CURL_EXIT" -eq 0 ]; then
    CURL_FAILS=0
  else
    CURL_FAILS=$((CURL_FAILS + 1))
    if [ "$CURL_FAILS" -ge 3 ]; then
      stop_run 'curl failed 3 calls in a row (network down, or a timeout)'
    fi
  fi
  case "$STATUS" in
    [0-9][0-9][0-9]) ;;
    *) STATUS='000' ;;
  esac
  case "$STATUS" in
    429 | 418) stop_run "HTTP ${STATUS}, the rate limit or a block; Retry-After (seconds, - = not sent): $(header_value retry-after); wait before any rerun" ;;
    403) stop_run "HTTP ${STATUS}, the rate limit or a block; wait before any rerun" ;;
  esac
  CODE="$(code_of)"
  TS_KIND='-'
  if [ "$STATUS" = 400 ] && [ "$CODE" = -1021 ]; then TS_KIND="$(error_class)"; fi
  # columns: part, path, response ms, status, code, the -1021 kind word (- for any other answer)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$CURRENT_PART" "$path" "$RESP_MS" "$STATUS" "$CODE" "$TS_KIND" >>"$RESP_LOG"
  # columns: part, path, request start (local ms), response ms, status, series, window index, page
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$CURRENT_PART" "$path" "$ATTEMPT_START_MS" "$RESP_MS" "$STATUS" "$CALL_TAG" >>"$ATTEMPT_LOG"
  note_answer "$path"
  sleep_ms "$(pause_rest_ms "$RESP_MS")"
  if [ "$CURL_EXIT" -ne 0 ]; then STATUS='000'; fi
}

# ---- the one retry: HTTP 400 code -1021, HTTP 000 or HTTP 5xx, once per call ----
server_error() { case "$STATUS" in 5[0-9][0-9]) return 0 ;; *) return 1 ;; esac; }
retry_wanted() { [ "$STATUS" = 000 ] || server_error || { [ "$STATUS" = 400 ] && [ "$CODE" = -1021 ]; }; }
# refused_by_binance: the answer is a real Binance refusal (the request was understood and not
# served): an HTTP 4xx with a numeric Binance error code, or an HTTP 200 whose wrapper code is a
# numeric code other than 000000. NOT a refusal, so a failed read: HTTP 000, any 5xx, -1021 (the
# clock or the connection), the server and rate codes -1000, -1001, -1003, -1006, -1007, -1015, and
# any answer with no numeric code (an empty body, a page that is not JSON).
refused_by_binance() {
  case "$CODE" in
    -1000 | -1001 | -1003 | -1006 | -1007 | -1015 | -1021) return 1 ;;
  esac
  case "$STATUS" in
    4[0-9][0-9]) ;;
    200) if [ "$CODE" = 000000 ]; then return 1; fi ;;
    *) return 1 ;;
  esac
  case "$CODE" in
    -[0-9]* | [0-9]*) return 0 ;;
    *) return 1 ;;
  esac
}
retry_kind() {
  if [ "$STATUS" = 000 ]; then
    echo 000
  elif server_error; then
    echo 5xx
  else
    echo 1021
  fi
}

# check_limits: the call cap and the run time limit, checked before every attempt.
check_limits() {
  if [ "$CALLS" -ge "$CALL_CAP" ]; then
    stop_run "the safety cap of ${CALL_CAP} calls was reached"
  fi
  if [ "$SECONDS" -ge "$MAX_RUN_SECONDS" ]; then
    stop_run "the run time limit of ${MAX_RUN_SECONDS} s was reached"
  fi
}

# window_count_of <now ms>: the number of 30-day windows from HISTORY_FLOOR_MS to now (0 when now
# is not past the floor).
window_count_of() {
  if [ "$1" -le "$HISTORY_FLOOR_MS" ]; then
    echo 0
  else
    echo $((($1 - HISTORY_FLOOR_MS + WINDOW_MS - 1) / WINDOW_MS))
  fi
}

# window_bounds <index from 1> <now ms>: sets W_START and W_END the way buildWalkWindows does:
# contiguous windows of WINDOW_MS from the floor, the last one ending at now.
window_bounds() {
  W_START=$((HISTORY_FLOOR_MS + ($1 - 1) * WINDOW_MS))
  W_END=$((W_START + WINDOW_MS))
  if [ "$W_END" -gt "$2" ]; then W_END="$2"; fi
}

# size_limits <window count> <elapsed seconds>: sizes the call cap and the run time limit for the
# whole read, unless the environment set them. The calls planned are two per window (BUY, SELL) and
# the 4 fiat samples; the cap adds the extra pages (EXTRA_PAGES_ALLOWANCE) and the retries
# (RETRY_ALLOWANCE) to the calls already made. The time limit counts every planned call and the
# extra pages at SECONDS_PER_CALL, every allowed retry at SECONDS_PER_RETRY, and a slack, from the
# time already spent.
size_limits() {
  local count="$1" elapsed="$2"
  PLAN_WALK_CALLS=$((2 * count))
  PLAN_FIAT_CALLS=4
  if [ -z "$CALL_CAP_USER" ]; then
    CALL_CAP=$((CALLS + PLAN_WALK_CALLS + PLAN_FIAT_CALLS + EXTRA_PAGES_ALLOWANCE + RETRY_ALLOWANCE))
  fi
  if [ -z "$MAX_RUN_USER" ]; then
    MAX_RUN_SECONDS=$((elapsed + (PLAN_WALK_CALLS + PLAN_FIAT_CALLS + EXTRA_PAGES_ALLOWANCE) * SECONDS_PER_CALL + RETRY_ALLOWANCE * SECONDS_PER_RETRY + TIME_SLACK_SECONDS))
  fi
}

# widen_recv_window: doubles recvWindow (to RECV_WINDOW_MAX at most) after a -1021, because the
# timestamp is fixed at signing and a slow connection setup spends the window before the request
# leaves.
widen_recv_window() {
  RECV_WINDOW=$((RECV_WINDOW * 2))
  if [ "$RECV_WINDOW" -gt "$RECV_WINDOW_MAX" ]; then RECV_WINDOW="$RECV_WINDOW_MAX"; fi
}

# sync_clock: GET /api/v3/time (public, no key). CLOCK_OFFSET = serverTime minus the local clock at
# the moment the first response byte arrived (request start + curl's time_starttransfer). The server
# stamped serverTime BEFORE that moment, so this is a LOWER BOUND of the true offset: a timestamp
# built from it can only lag the server clock, never lead it (Binance accepts a timestamp up to
# recvWindow BEHIND its clock and only 1000 ms AHEAD). Returns 1 when the server time could not be
# read (the old offset stays).
sync_clock() {
  local server first_byte
  public_get "$TIME_PATH" 1
  if [ "$STATUS" != 200 ]; then return 1; fi
  server="$(jq -r '(.serverTime // 0) | if type == "number" then floor else 0 end' "$BODY" 2>>"$JQ_ERRORS")" || server=0
  case "$server" in '' | *[!0-9]*) server=0 ;; esac
  if [ "$server" -eq 0 ] || [ "$ATTEMPT_START_MS" -eq 0 ] || [ "$ATTEMPT_END_MS" -eq 0 ]; then return 1; fi
  first_byte="$FIRST_BYTE_MS"
  if [ "$first_byte" -le 0 ]; then first_byte="$RESP_MS"; fi
  if [ "$first_byte" -le 0 ]; then first_byte=$((ATTEMPT_END_MS - ATTEMPT_START_MS)); fi
  CLOCK_OFFSET=$((server - (ATTEMPT_START_MS + first_byte)))
  printf '%s\t%s\t%s\n' "$CURRENT_PART" "$CLOCK_OFFSET" "$((ATTEMPT_END_MS - ATTEMPT_START_MS))" >>"$CLOCK_LOG"
  return 0
}

# The one HMAC implementation: key and message go to perl on stdin (key on the first line, the
# message is the rest), so the secret is never in any process argv. printf is a builtin.
hmac_hex() {
  printf '%s\n%s' "$1" "$2" | /usr/bin/perl -MDigest::SHA=hmac_sha256_hex -e 'my $key = <STDIN>; chomp $key; local $/; my $message = <STDIN>; print hmac_sha256_hex($message, $key)' 2>/dev/null
}

# signed_attempt <path> <query> <uid_cost> <ip_cost>: ONE signed GET. The call cap and the weight
# throttle apply to every attempt, a retry included. The request start is the local clock read just
# before signing.
signed_attempt() {
  local path="$1" query="$2" uid_cost="$3" ip_cost="$4" full signature config stamp
  check_limits
  throttle "$path" "$uid_cost" "$ip_cost"
  stamp="$(local_ms)"
  case "$stamp" in
    '' | *[!0-9]*) stop_run 'the local clock could not be read' ;;
  esac
  ATTEMPT_START_MS="$stamp"
  full="timestamp=$((stamp + CLOCK_OFFSET))&recvWindow=${RECV_WINDOW}"
  if [ -n "$query" ]; then
    full="${query}&${full}"
  fi
  # A failed perl would end the script silently under set -e; the empty signature must reach
  # stop_run.
  signature="$(hmac_hex "$API_SECRET" "$full")" || true
  case "$signature" in
    '' | *[!0-9a-f]*) stop_run 'could not sign the request (HMAC failed)' ;;
  esac
  if [ "${#signature}" -ne 64 ]; then
    stop_run 'the signature has an unexpected length'
  fi
  printf -v config 'url = "%s%s?%s&signature=%s"\nheader = "X-MBX-APIKEY: %s"' \
    "$BASE_URL" "$path" "$full" "$signature" "$API_KEY"
  fetch "$config" 45
  config=''
  finish_call "$path" "$uid_cost" "$ip_cost"
}

# retry_book: books how a retried call ended (STATUS and CODE are those of the retry).
retry_book() { # <kind>
  case "$1" in
    1021) RETRY_1021=$((RETRY_1021 + 1)) ;;
    5xx) RETRY_5XX=$((RETRY_5XX + 1)) ;;
    *) RETRY_000=$((RETRY_000 + 1)) ;;
  esac
  if [ "$STATUS" = 200 ]; then
    RETRY_RECOVERED=$((RETRY_RECOVERED + 1))
  elif retry_wanted; then
    RETRY_FAILED=$((RETRY_FAILED + 1))
  fi
}

# signed_call <method> <path> <query> <uid_cost> <ip_cost>: one signed request, retried once on
# HTTP 400 code -1021 (recvWindow doubled and the clock read again first), HTTP 000 or HTTP 5xx
# (after a 2 s wait). Sets STATUS (HTTP status) and CODE (the response code, digits only or a fixed
# word) of the LAST attempt. A method other than GET, a path that is not on ALLOWED_SIGNED_PATHS, a
# query that is not the one listed for its path, or a query with a character outside letters,
# digits and = & _ . - stops the run before a byte is sent.
signed_call() {
  local method="$1" path="$2" query="$3" uid_cost="$4" ip_cost="$5" kind
  if ! request_allowed "$method" "$path" signed; then
    stop_run 'a request other than a GET of an allowlisted path was refused'
  fi
  case "$query" in
    *[!A-Za-z0-9=\&_.-]*) stop_run 'a query with an unexpected character was refused' ;;
  esac
  if ! query_allowed "$path" "$query"; then
    stop_run 'a query other than the one listed for its path was refused'
  fi
  SIGNED_CALLS=$((SIGNED_CALLS + 1))
  signed_attempt "$path" "$query" "$uid_cost" "$ip_cost"
  if retry_wanted; then
    kind="$(retry_kind)"
    RETRIES_TOTAL=$((RETRIES_TOTAL + 1))
    if [ "$kind" = 1021 ]; then
      widen_recv_window
      sync_clock || true
    else
      sleep 2
    fi
    signed_attempt "$path" "$query" "$uid_cost" "$ip_cost"
    retry_book "$kind"
  fi
  if [ "$SIGNED_CALLS" -eq 1 ] && [ "$STATUS" != 200 ]; then
    stop_run "the first signed call failed (HTTP ${STATUS} code ${CODE} $(error_class)); check the key, its Enable Reading permission, its IP restriction and the clock"
  fi
}

# signed_get <path> <query> <uid_cost> <ip_cost>: one signed GET.
signed_get() { signed_call GET "$1" "$2" "$3" "$4"; }

# public_attempt <path> <ip_cost> <query> <max seconds>: ONE unsigned GET (no key, no signature). It
# also notes the local clock before and after the request, for the clock sync.
public_attempt() {
  local path="$1" ip_cost="$2" query="$3" seconds="$4" config url
  check_limits
  throttle "$path" 0 "$ip_cost"
  url="${BASE_URL}${path}"
  if [ -n "$query" ]; then
    url="${url}?${query}"
  fi
  printf -v config 'url = "%s"' "$url"
  ATTEMPT_START_MS="$(local_ms)"
  : "${ATTEMPT_START_MS:=0}"
  fetch "$config" "$seconds"
  ATTEMPT_END_MS="$(local_ms)"
  : "${ATTEMPT_END_MS:=0}"
  finish_call "$path" 0 "$ip_cost"
}

# public_get <path> <ip_cost> [<query> [<max seconds>]]: one unsigned GET of an allowlisted public
# path with the one query listed for it, retried once on HTTP 000 or 5xx.
public_get() {
  local path="$1" ip_cost="$2" query="${3:-}" seconds="${4:-45}" kind
  if ! request_allowed GET "$path" public; then
    stop_run 'a public request other than a GET of an allowlisted path was refused'
  fi
  if ! query_allowed "$path" "$query"; then
    stop_run 'a query other than the one listed for its path was refused'
  fi
  public_attempt "$path" "$ip_cost" "$query" "$seconds"
  if retry_wanted; then
    kind="$(retry_kind)"
    RETRIES_TOTAL=$((RETRIES_TOTAL + 1))
    sleep 2
    public_attempt "$path" "$ip_cost" "$query" "$seconds"
    retry_book "$kind"
  fi
}

calls_of() { awk -v p="$1" '$1 == p { n++ } END { print n + 0 }' "$PART_LOG"; }

# ---- shared report helpers (awk over tab-separated files) ----
# tally <file> <column>: "value=count value=count", most first.
tally() {
  awk -F'\t' -v c="$2" '{ n[$c]++ } END { for (k in n) printf "%s\t%d\n", k, n[k] }' "$1" |
    sort -t "$(printf '\t')" -k2,2nr -k1,1 |
    awk -F'\t' '{ printf "%s%s=%s", (NR > 1 ? " " : ""), $1, $2 } END { if (NR == 0) printf "(none)"; printf "\n" }'
}

# word_tally <file> <filter column, 0 for every row> <filter value> <word column>: the tally of an
# enum word column. A word that is not letters, underscores and spaces, or is longer than 40
# characters, is shown as (other), so no free text reaches the report.
word_tally() {
  awk -F'\t' -v f="$2" -v v="$3" -v c="$4" 'f == 0 || $f == v {
      w = $c
      if (w == "(absent)" || w == "(not text)") print w
      else if (w ~ /^[A-Za-z][A-Za-z_ ]*$/ && length(w) <= 40) print w
      else print "(other)"
    }' "$1" >"$TALLY_TMP"
  tally "$TALLY_TMP" 1
}

# ---- the error answer: the Binance msg, made safe to print ----
# One line, a character outside letters, digits, space and . , : ; _ ( ) - shown as ?, a run of 20
# or more letters and digits masked (a key fragment), every digit run masked (an IP address or an
# id), cut at 160 characters. Prints ? when the body is not JSON.
error_msg() {
  jq -r 'if type == "object" then ((.msg // .message // "") | if type == "string" then . else "" end) else "" end' "$BODY" 2>>"$JQ_ERRORS" |
    sed -n '1p' |
    tr -c 'A-Za-z0-9 .,:;_()\n-' '?' |
    sed -e 's/[A-Za-z0-9]\{20,\}/#/g' -e 's/[0-9][0-9]*/#/g' |
    cut -c1-160 || echo '?'
}

# note_answer <path>: called for every attempt (finish_call), keeps the LAST attempt's class word,
# kind and masked msg (for any non-200 answer) and logs every non-200 answer.
# columns of the answer log: part, path, status, code, class, kind, msg
note_answer() {
  ANS_SET=0
  ANS_CLASS='-'
  ANS_KIND='-'
  ANS_MSG=''
  if [ "$STATUS" != 200 ]; then
    ANS_SET=1
    ANS_CLASS="$(error_class)"
    ANS_MSG="$(error_msg)"
    if refused_by_binance; then
      ANS_KIND='refused by Binance'
    else
      ANS_KIND='a failed read (clock, network or server), not a Binance refusal'
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$CURRENT_PART" "$1" "$STATUS" "$CODE" "$ANS_CLASS" "$ANS_KIND" "$ANS_MSG" >>"$ANSWER_LOG"
  fi
}

# ---- the answer shape and the rows ----
# Binance's wrapped answer: an object, the code "000000", and a data list (null or absent = empty).
OK_WRAPPED='(type == "object") and ((.code | tostring) == "000000") and (((.data // []) | type) == "array")'
# One P2P order per row, tab separated: order number (private; the dedupe key), the requested
# series, orderStatus, tradeType, advertisementRole. A value that is not text is a fixed word.
P2P_ROWS_PROGRAM='def word: if type == "string" then . elif . == null then "(absent)" else "(not text)" end;
  (.data // [])[] | objects
  | [((.orderNumber // "") | if type == "string" or type == "number" then tostring else "" end), $series, (.orderStatus | word), (.tradeType | word), (.advertisementRole | word)]
  | @tsv'
# One fiat row per line: the call label and the status word.
FIAT_ROWS_PROGRAM='def word: if type == "string" then . elif . == null then "(absent)" else "(not text)" end;
  (.data // [])[] | objects | [$label, (.status | word)] | @tsv'

body_ok() { jq -e "$OK_WRAPPED" "$BODY" >/dev/null 2>>"$JQ_ERRORS"; }

# ---- the P2P walk ----
# p2p_series_window <series> <window index> <start ms> <end ms>: one series of one window, page by
# page (rows=100) until a short page, the response total read, or P2P_PAGE_CAP pages. Books one row
# in the walk log: series, window index, pages, rows read, end word (short-page, total-reached,
# page-cap, error, refused, bad-body). An error is booked, never an ok window with too few rows. The
# order rows go to the private order file. Three errors in a row stop the run.
p2p_series_window() {
  local series="$1" index="$2" start="$3" end="$4" page=1 pages=0 rows=0 length total seen=0 word=''
  while :; do
    CALL_TAG="${series}"$'\t'"${index}"$'\t'"${page}"
    signed_get "$P2P_PATH" "tradeType=${series}&startTimestamp=${start}&endTimestamp=${end}&page=${page}&rows=${P2P_ROWS}" "$P2P_UID_COST" "$SAPI_IP_COST"
    pages=$((pages + 1))
    if [ "$STATUS" != 200 ] || ! body_ok; then
      ERROR_STREAK=$((ERROR_STREAK + 1))
      if [ "$STATUS" != 200 ] && [ "$CODE" = -5026 ]; then
        word=refused
      elif [ "$STATUS" = 200 ]; then
        word=bad-body
      else
        word=error
      fi
      if [ "$ERROR_STREAK" -ge 3 ]; then
        printf '%s\t%s\t%s\t%s\t%s\n' "$series" "$index" "$pages" "$rows" "$word" >>"$WALK_LOG"
        stop_run '3 reads in a row were answered by an error (each already retried once)'
      fi
      break
    fi
    ERROR_STREAK=0
    jq -r --arg series "$series" "$P2P_ROWS_PROGRAM" "$BODY" >>"$ORDER_ROWS" 2>>"$JQ_ERRORS" || true
    length="$(jq '(.data // []) | length' "$BODY" 2>>"$JQ_ERRORS")" || length=0
    total="$(jq '(.total // 0) | if type == "number" then floor else 0 end' "$BODY" 2>>"$JQ_ERRORS")" || total=0
    case "$length" in '' | *[!0-9]*) length=0 ;; esac
    case "$total" in '' | *[!0-9]*) total=0 ;; esac
    rows=$((rows + length))
    seen=$((seen + length))
    if [ "$length" -lt "$P2P_ROWS" ]; then
      word=short-page
      break
    fi
    if [ "$total" -gt 0 ] && [ "$seen" -ge "$total" ]; then
      word=total-reached
      break
    fi
    if [ "$page" -ge "$P2P_PAGE_CAP" ]; then
      word=page-cap
      break
    fi
    page=$((page + 1))
  done
  printf '%s\t%s\t%s\t%s\t%s\n' "$series" "$index" "$pages" "$rows" "$word" >>"$WALK_LOG"
}

# run_p2p_walk: every window from HISTORY_FLOOR_MS to the moment the walk began, BUY then SELL.
run_p2p_walk() {
  local index series start_ms end_ms
  CURRENT_PART='p2p'
  WALK_STATE='running'
  WALK_NOW=$(($(local_ms) + CLOCK_OFFSET))
  WINDOW_COUNT="$(window_count_of "$WALK_NOW")"
  start_ms="$(local_ms)"
  progress "[$(date +%H:%M:%S)] p2p: ${WINDOW_COUNT} windows of 30 days x 2 series"
  index=1
  while [ "$index" -le "$WINDOW_COUNT" ]; do
    window_bounds "$index" "$WALK_NOW"
    for series in BUY SELL; do
      p2p_series_window "$series" "$index" "$W_START" "$W_END"
    done
    if [ $((index % 10)) -eq 0 ]; then
      progress "[$(date +%H:%M:%S)] p2p: ${index} of ${WINDOW_COUNT} windows read"
    fi
    index=$((index + 1))
  done
  end_ms="$(local_ms)"
  printf '%s\t%s\n' "$start_ms" "$end_ms" >>"$WALK_TIMES"
  WALK_STATE='complete'
}

# ---- the fiat samples: one page each ----
# keys_of: the key names of the first record of the data list, schema words only, comma separated.
KEYS_PROGRAM='[(.data // [])[0]? | objects | keys[]? | select(test("^[a-z][A-Za-z]{0,39}$"))] | join(",")'

# fiat_call <label> <path> <uid cost> <transactionType> <rows>: one page over the newest 2-year
# window. Books one row in the fiat log: label, HTTP status, code, class, kind, masked msg, rows,
# total, shape ok (1/0), first-record key names. A failure is booked and the run goes on.
fiat_call() {
  local label="$1" path="$2" uid_cost="$3" type="$4" rows="$5" length=0 total=0 shape=0 keys='-'
  CURRENT_PART='fiat'
  CALL_TAG="${label}"$'\t'0$'\t'1
  progress "[$(date +%H:%M:%S)] fiat sample ${label}: GET ${path}"
  signed_get "$path" "transactionType=${type}&beginTime=$((FIAT_NOW - FIAT_SPAN_MS))&endTime=${FIAT_NOW}&page=1&rows=${rows}" "$uid_cost" "$SAPI_IP_COST"
  if [ "$STATUS" = 200 ] && body_ok; then
    shape=1
    length="$(jq '(.data // []) | length' "$BODY" 2>>"$JQ_ERRORS")" || length=0
    total="$(jq '(.total // 0) | if type == "number" then floor else 0 end' "$BODY" 2>>"$JQ_ERRORS")" || total=0
    case "$length" in '' | *[!0-9]*) length=0 ;; esac
    case "$total" in '' | *[!0-9]*) total=0 ;; esac
    jq -r --arg label "$label" "$FIAT_ROWS_PROGRAM" "$BODY" >>"$FIAT_ROWS" 2>>"$JQ_ERRORS" || true
    keys="$(jq -r "$KEYS_PROGRAM" "$BODY" 2>>"$JQ_ERRORS")" || keys=''
    if [ -z "$keys" ]; then keys='-'; fi
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$STATUS" "$CODE" "$ANS_CLASS" "$ANS_KIND" "$ANS_MSG" "$length" "$total" "$shape" "$keys" >>"$FIAT_LOG"
}

run_fiat_samples() {
  FIAT_STATE='running'
  FIAT_NOW=$(($(local_ms) + CLOCK_OFFSET))
  fiat_call orders-0 "$FIAT_ORDERS_PATH" "$FIAT_ORDERS_UID_COST" 0 "$FIAT_ORDERS_ROWS"
  fiat_call orders-1 "$FIAT_ORDERS_PATH" "$FIAT_ORDERS_UID_COST" 1 "$FIAT_ORDERS_ROWS"
  fiat_call payments-0 "$FIAT_PAYMENTS_PATH" "$FIAT_PAYMENTS_UID_COST" 0 "$FIAT_PAYMENTS_ROWS"
  fiat_call payments-1 "$FIAT_PAYMENTS_PATH" "$FIAT_PAYMENTS_UID_COST" 1 "$FIAT_PAYMENTS_ROWS"
  FIAT_STATE='complete'
}

# ---- the lane caps: arithmetic over the measured calls of the walk ----
# caps_line <cap> <oldest window index or -> <newest window index or ->: the app runs a lane of
# <cap> calls would need for the calls this walk made. A run starts a window only when room for both
# series (2 calls) is left, as readSeriesSpan requires, then spends every attempt the window took.
# Per run, the attempts' measured start times give the most calls started inside any 60 s, and with
# the UID cost of one call the largest UID weight the run holds in a minute. Prints: runs, the run
# of the oldest window, the run of the newest, the peak UID weight in a minute, the longest run's
# wall time in ms (first start to last response) and the average run wall time in ms.
caps_line() {
  awk -F'\t' -v cap="$1" -v oldest="$2" -v newest="$3" -v uid="$P2P_UID_COST" '
    $1 == "p2p" {
      n++
      w = $7 + 0
      count[w]++
      start[n] = $3 + 0
      finish[n] = $3 + $4
      win[n] = w
      if (!(w in seen)) { seen[w] = 1; m++; order[m] = w }
    }
    END {
      used = 0
      run = 1
      for (i = 1; i <= m; i++) {
        w = order[i]
        if (used > 0 && used + 2 > cap) { run++; used = 0 }
        used += count[w]
        runof[w] = run
      }
      for (k = 1; k <= n; k++) {
        r = runof[win[k]]
        c[r]++
        at[r, c[r]] = start[k]
        if (!(r in first) || start[k] < first[r]) first[r] = start[k]
        if (finish[k] > last[r]) last[r] = finish[k]
      }
      for (r = 1; r <= run; r++) {
        j = 1
        for (i = 1; i <= c[r]; i++) {
          while (at[r, i] - at[r, j] >= 60000) j++
          if (i - j + 1 > peak) peak = i - j + 1
        }
        wall = last[r] - first[r]
        if (wall > longest) longest = wall
        sum += wall
      }
      if (n == 0) { print "no call made"; exit }
      printf "runs %d; run of the oldest order window %s; run of the newest order window %s; largest UID weight in any 60 s of a run %d; longest run %d ms; average run %d ms\n", run, (oldest == "-" ? "-" : runof[oldest]), (newest == "-" ? "-" : runof[newest]), peak * uid, longest, sum / run
    }' "$ATTEMPT_LOG"
}

# ---- reports ----
report_walk() {
  local series_windows rows distinct no_number pages extra max_pages with_rows empty bad oldest newest
  local start_ms end_ms wall gate peak_uid peak_ip waits calls cap
  say ""
  say "== P2P FIRST WALK: ${P2P_PATH} (BUY then SELL in every 30-day window from HISTORY_FLOOR_MS ${HISTORY_FLOOR_MS}; rows=${P2P_ROWS}; no lane cap) =="
  if [ "$WALK_STATE" = 'not started' ]; then
    say "not started"
    return 0
  fi
  calls="$(calls_of p2p)"
  series_windows="$(wc -l <"$WALK_LOG" | tr -d ' ')"
  rows="$(awk -F'\t' '{ n += $4 } END { print n + 0 }' "$WALK_LOG")"
  pages="$(awk -F'\t' '{ n += $3 } END { print n + 0 }' "$WALK_LOG")"
  extra="$(awk -F'\t' '$3 > 1 { n += $3 - 1 } END { print n + 0 }' "$WALK_LOG")"
  max_pages="$(awk -F'\t' '$3 + 0 > m { m = $3 + 0 } END { print m + 0 }' "$WALK_LOG")"
  awk -F'\t' '$1 == "" || !seen[$1]++' "$ORDER_ROWS" >"$ORDER_DISTINCT"
  distinct="$(wc -l <"$ORDER_DISTINCT" | tr -d ' ')"
  no_number="$(awk -F'\t' '$1 == "" { n++ } END { print n + 0 }' "$ORDER_ROWS")"
  with_rows="$(awk -F'\t' '$4 + 0 > 0 { w[$2] = 1 } END { for (k in w) n++; print n + 0 }' "$WALK_LOG")"
  bad="$(awk -F'\t' '$5 != "short-page" && $5 != "total-reached" { w[$2] = 1 } END { for (k in w) n++; print n + 0 }' "$WALK_LOG")"
  empty=$((WINDOW_COUNT - with_rows - bad))
  if [ "$empty" -lt 0 ]; then empty=0; fi
  start_ms="$(awk -F'\t' 'END { print $1 + 0 }' "$WALK_TIMES")"
  end_ms="$(awk -F'\t' 'END { print $2 + 0 }' "$WALK_TIMES")"
  if [ "$WALK_STATE" = complete ] && [ "$start_ms" -gt 0 ] && [ "$end_ms" -ge "$start_ms" ]; then
    wall="$((end_ms - start_ms)) ms"
  else
    wall='not measured (the walk did not finish)'
  fi
  gate="$(awk -F'\t' -v path="$P2P_PATH" '$1 == "p2p" && $2 == path { ms = $4 + 0; sum += (ms > 350 ? ms : 350) } END { print sum + 0 }' "$ATTEMPT_LOG")"
  peak_uid="$(awk -F'\t' '$6 == "p2p" && $5 ~ /^[0-9]+$/ && $5 + 0 > m { m = $5 + 0; seen = 1 } END { print (seen ? m : "-") }' "$HEADER_LOG")"
  peak_ip="$(awk -F'\t' '$6 == "p2p" && $4 ~ /^[0-9]+$/ && $4 + 0 > m { m = $4 + 0; seen = 1 } END { print (seen ? m : "-") }' "$HEADER_LOG")"
  waits="$(awk -v p=p2p '$1 == p { n++ } END { print n + 0 }' "$WAIT_LOG")"
  if [ "$WALK_STATE" != complete ]; then
    say "state: ${WALK_STATE} (the walk stopped before the end; the numbers cover only what was read)"
  else
    say "state: complete"
  fi
  say "windows: ${WINDOW_COUNT} (series reads made: ${series_windows} of $((2 * WINDOW_COUNT))); windows with rows: ${with_rows}; empty windows (every series ended ok with 0 rows): ${empty}; windows with a failed or cut series read: ${bad}"
  say "calls (attempts, retries included): ${calls}; pages (one per answer): ${pages}; extra pages (a series read with more than one page): ${extra}; most pages in one series read: ${max_pages}"
  say "how each series read ended (word=reads): $(tally "$WALK_LOG" 5)"
  say "rows read: ${rows}; distinct orders: ${distinct} (an order number repeats where two windows share a boundary millisecond); rows with no order number (kept apart, never merged): ${no_number}"
  say "rows per window (rows=windows): $(awk -F'\t' '{ s[$2] += $4 } END { for (k in s) print s[k] }' "$WALK_LOG" >"$TALLY_TMP.rows" && tally "$TALLY_TMP.rows" 1)"
  oldest="$(awk -F'\t' '$4 + 0 > 0 && (min == "" || $2 + 0 < min) { min = $2 + 0 } END { print (min == "" ? "-" : min) }' "$WALK_LOG")"
  newest="$(awk -F'\t' '$4 + 0 > 0 && $2 + 0 > max { max = $2 + 0 } END { print (max == 0 ? "-" : max) }' "$WALK_LOG")"
  say "oldest window index with an order (window 1 starts at the floor, window ${WINDOW_COUNT} ends at the walk start): ${oldest}; newest: ${newest}"
  for series in BUY SELL; do
    say "series ${series}: reads $(awk -F'\t' -v s="$series" '$1 == s { n++ } END { print n + 0 }' "$WALK_LOG"); rows $(awk -F'\t' -v s="$series" '$1 == s { n += $4 } END { print n + 0 }' "$WALK_LOG"); oldest window with rows $(awk -F'\t' -v s="$series" '$1 == s && $4 + 0 > 0 && (min == "" || $2 + 0 < min) { min = $2 + 0 } END { print (min == "" ? "-" : min) }' "$WALK_LOG"); newest $(awk -F'\t' -v s="$series" '$1 == s && $4 + 0 > 0 && $2 + 0 > max { max = $2 + 0 } END { print (max == 0 ? "-" : max) }' "$WALK_LOG")"
  done
  say "orderStatus words, distinct orders (word=orders): $(word_tally "$ORDER_DISTINCT" 0 '' 3)"
  for series in BUY SELL; do
    say "  asked as ${series}: $(word_tally "$ORDER_DISTINCT" 2 "$series" 3)"
  done
  say "tradeType words of the records (word=orders): $(word_tally "$ORDER_DISTINCT" 0 '' 4); a record whose tradeType differs from the series asked: $(awk -F'\t' '$2 != $4 { n++ } END { print n + 0 }' "$ORDER_DISTINCT")"
  say "advertisementRole words (word=orders): $(word_tally "$ORDER_DISTINCT" 0 '' 5)"
  say "wall time: ${wall} (gate: 350 ms from request start to request start); gate estimate (the sum over the calls of max(350, response ms)): ${gate} ms"
  say "X-SAPI-USED-UID-WEIGHT-1M largest value seen after any call of the walk (- = never sent): ${peak_uid}; X-SAPI-USED-IP-WEIGHT-1M: ${peak_ip}; throttle waits (2 s each): ${waits}"
  say "error answers in the walk (answer=attempts): $(awk -F'\t' '$1 == "p2p" { print "HTTP " $3 " code " $4 }' "$ANSWER_LOG" >"$TALLY_TMP.answers" && tally "$TALLY_TMP.answers" 1)"
  say ""
  say "== LANE CAPS (arithmetic over the ${calls} measured calls above; the app lane today is 10) =="
  say "rule: a window starts in a run only when 2 calls (BUY and SELL) of room are left; every attempt of a window counts against the run; the app's real page rule may differ by a page"
  for cap in $LANE_CAPS; do
    say "cap ${cap}: $(caps_line "$cap" "$oldest" "$newest")"
  done
}

report_fiat() {
  local label
  say ""
  say "== FIAT SAMPLES: one page each over the newest 2-year window (${FIAT_SPAN_MS} ms), counts, key names and status words only =="
  if [ "$FIAT_STATE" = 'not started' ]; then
    say "not started"
    return 0
  fi
  while IFS= read -r label; do
    say "${label}: HTTP $(awk -F'\t' -v l="$label" '$1 == l { v = $2 } END { print v }' "$FIAT_LOG"); code $(awk -F'\t' -v l="$label" '$1 == l { v = $3 } END { print v }' "$FIAT_LOG"); rows $(awk -F'\t' -v l="$label" '$1 == l { v = $7 } END { print v }' "$FIAT_LOG"); response total $(awk -F'\t' -v l="$label" '$1 == l { v = $8 } END { print v }' "$FIAT_LOG"); answer shape ok (1 = wrapped list) $(awk -F'\t' -v l="$label" '$1 == l { v = $9 } END { print v }' "$FIAT_LOG")"
    say "  first record key names: $(awk -F'\t' -v l="$label" '$1 == l { v = $10 } END { print v }' "$FIAT_LOG"); status words (word=rows): $(word_tally "$FIAT_ROWS" 1 "$label" 2)"
    if [ "$(awk -F'\t' -v l="$label" '$1 == l { v = $2 } END { print v }' "$FIAT_LOG")" != 200 ]; then
      say "  answer: $(awk -F'\t' -v l="$label" '$1 == l { v = $4 "; " $5 } END { print v }' "$FIAT_LOG"); error msg (digits masked, cut at 160): $(awk -F'\t' -v l="$label" '$1 == l { v = $6 } END { print v }' "$FIAT_LOG")"
    fi
  done < <(awk -F'\t' '{ print $1 }' "$FIAT_LOG")
}

# report_answers: every distinct error answer once, with its attempt count and masked msg.
report_answers() {
  say ""
  say "== ERROR ANSWERS (every distinct non-200 answer once; msg digits masked, a character outside letters, digits, space and . , : ; _ ( ) - shown as ?, cut at 160) =="
  if [ ! -s "$ANSWER_LOG" ]; then
    say "none"
    return 0
  fi
  awk -F'\t' '{ k = $1 "\t" $2 "\t" $3 "\t" $4 "\t" $5 "\t" $6; n[k]++; if (!(k in m)) m[k] = $7 }
    END { for (k in n) printf "%s\t%d\t%s\n", k, n[k], m[k] }' "$ANSWER_LOG" |
    sort |
    awk -F'\t' '{ printf "  part %s %s: HTTP %s code %s class %s; %s; attempts %d; msg: %s\n", $1, $2, $3, $4, $5, $6, $7, ($8 == "" ? "(none)" : $8) }'
}

report_headers() {
  say ""
  say "== RATE-LIMIT HEADERS (the largest value seen after any call of the endpoint; - = the header was never sent) =="
  awk -F'\t' '
    { k = $2; calls[k]++
      for (i = 3; i <= 5; i++) if ($i ~ /^[0-9]+$/) { if (!((k, i) in m) || $i + 0 > m[k, i]) m[k, i] = $i + 0 } }
    END {
      for (k in calls) {
        line = sprintf("  %s (%d calls):", k, calls[k])
        for (i = 3; i <= 5; i++) {
          name = (i == 3 ? "X-MBX-USED-WEIGHT-1M" : (i == 4 ? "X-SAPI-USED-IP-WEIGHT-1M" : "X-SAPI-USED-UID-WEIGHT-1M"))
          line = line sprintf(" %s=%s", name, ((k, i) in m) ? sprintf("%d", m[k, i]) : "-")
        }
        print line
      }
    }' "$HEADER_LOG" | sort
}

# Numbers about the clock and the network only: offsets and response times in ms, counts, HTTP
# status words. Nothing here comes from a response body.
report_clock() {
  say ""
  say "== CLOCK, RETRIES AND RESPONSE TIMES (numbers about the clock and the network only; no account data) =="
  say "clock: at the start, Binance serverTime minus the local clock = ${CLOCK_START_OFFSET} ms (round trip of that request ${CLOCK_START_RTT} ms); the offset is a LOWER BOUND, so a signed timestamp (local + offset) can lag the server clock but not lead it; recvWindow ${RECV_WINDOW_START} ms at the start, ${RECV_WINDOW} ms at the end (doubled after each retried -1021, 60000 at most)"
  say "clock reads: $(wc -l <"$CLOCK_LOG" | tr -d ' ') (the start, then one after each -1021 that was retried); offsets in order (ms): $(awk -F'\t' '{ printf "%s%s", (NR > 1 ? " " : ""), $2 } END { if (NR == 0) printf "(none)"; printf "\n" }' "$CLOCK_LOG")"
  awk -F'\t' '
    { n++; ms = $3 + 0; sum += ms; if (ms > max) { max = ms; maxpath = $2 }
      if ($4 == "400" && $5 == "-1021") { c1021++; kind[$6]++ }
      else if ($4 == "000") c000++
      else if ($4 ~ /^5[0-9][0-9]$/) c5xx++ }
    END {
      printf "response time: attempts %d; average %d ms; the largest %d ms (%s)\n", n, (n == 0 ? 0 : sum / n), max, (maxpath == "" ? "-" : maxpath)
      printf "attempts answered -1021: %d (timestamp ahead %d, timestamp behind %d, other %d); HTTP 000 attempts: %d; HTTP 5xx attempts: %d\n", c1021, kind["timestamp ahead"], kind["timestamp behind"], c1021 - kind["timestamp ahead"] - kind["timestamp behind"], c000, c5xx
    }' "$RESP_LOG"
  say "retries: total ${RETRIES_TOTAL} (first failure -1021 ${RETRY_1021}, HTTP 000 ${RETRY_000}, HTTP 5xx ${RETRY_5XX}); recovered by the retry ${RETRY_RECOVERED}; still failed after the retry ${RETRY_FAILED}"
}

jq_error_summary() {
  local count
  count="$(wc -l <"$JQ_ERRORS" | tr -d ' ')"
  say ""
  say "jq error lines in the analysis (messages withheld, they can quote data): ${count}"
}

# report_verdict: the short honest verdict block, decided only by the counts above. A run that did
# not finish, an error answer or a cut read says so, because the numbers then cover less.
report_verdict() {
  local cut failed
  say ""
  say "== VERDICT (decided only by the counts above) =="
  say "KEY CHECK (GET ${ACCOUNT_PATH}): ${KEY_CHECK_STATE}"
  say "P2P WALK: ${WALK_STATE}; windows ${WINDOW_COUNT}; reads $(wc -l <"$WALK_LOG" | tr -d ' '); rows $(awk -F'\t' '{ n += $4 } END { print n + 0 }' "$WALK_LOG")"
  say "FIAT SAMPLES: ${FIAT_STATE}; calls $(wc -l <"$FIAT_LOG" | tr -d ' '); answered 200: $(awk -F'\t' '$2 == 200 { n++ } END { print n + 0 }' "$FIAT_LOG")"
  if [ "$RUN_STATE" != complete ]; then
    say "READ INCOMPLETE: this run stopped before the end (${RUN_STATE}); the counts cover only what was read"
  fi
  failed="$(awk -F'\t' '$5 == "error" || $5 == "refused" || $5 == "bad-body" { n++ } END { print n + 0 }' "$WALK_LOG")"
  if [ "$failed" -gt 0 ]; then
    say "READ INCOMPLETE: ${failed} series read(s) of the walk failed (see the ends above); their rows are missing from every number"
  fi
  cut="$(awk -F'\t' '$5 == "page-cap" { n++ } END { print n + 0 }' "$WALK_LOG")"
  if [ "$cut" -gt 0 ]; then
    say "READ INCOMPLETE: ${cut} series read(s) stopped at the ${P2P_PAGE_CAP}-page cap"
  fi
  if [ "$FIAT_STATE" = complete ] && [ "$(awk -F'\t' '$2 != 200 { n++ } END { print n + 0 }' "$FIAT_LOG")" -gt 0 ]; then
    say "FIAT NOTE: at least one fiat sample was not answered 200 (see the fiat section and the error answers)"
  fi
}

report_plan() {
  PLAN_PRINTED=1
  say ""
  say "== PLAN =="
  say "windows: ${WINDOW_COUNT} of 30 days from HISTORY_FLOOR_MS ${HISTORY_FLOOR_MS}; plan: ${PLAN_WALK_CALLS} P2P calls (BUY and SELL per window) plus extra pages, ${PLAN_FIAT_CALLS} fiat sample calls, gated at ${PAUSE_MS} ms from request start to request start"
  say "limits: call cap ${CALL_CAP} (calls so far ${CALLS}; room for ${EXTRA_PAGES_ALLOWANCE} extra pages and ${RETRY_ALLOWANCE} retries), run time limit ${MAX_RUN_SECONDS} s from the key prompt; the run stops cleanly (exit 3) at either"
}

report_everything() {
  if [ "$PLAN_PRINTED" -eq 0 ] && [ "$WINDOW_COUNT" -gt 0 ]; then
    report_plan
  fi
  report_fiat
  report_walk
  report_answers
  report_clock
  report_headers
  jq_error_summary
  say ""
  say "total calls: ${CALLS}; retries: ${RETRIES_TOTAL}; elapsed: ${SECONDS} s"
  report_verdict
}

# ================= selftest: paging, caps, words, report, allowlist ===========================
ST_CHECKS=0
ST_FAILS=0
st_expect() { # <label> <expected> <actual>
  ST_CHECKS=$((ST_CHECKS + 1))
  if [ "$2" = "$3" ]; then
    say "  ok   $1"
  else
    ST_FAILS=$((ST_FAILS + 1))
    say "  FAIL $1"
    say "    expected: $2"
    say "    actual:   $3"
  fi
}
st_contains() { # <label> <text> <needle>
  ST_CHECKS=$((ST_CHECKS + 1))
  case "$2" in
    *"$3"*) say "  ok   $1" ;;
    *)
      ST_FAILS=$((ST_FAILS + 1))
      say "  FAIL $1"
      say "    wanted to contain: $3"
      say "    actual:            $2"
      ;;
  esac
}
st_absent() { # <label> <text> <needle>
  ST_CHECKS=$((ST_CHECKS + 1))
  case "$2" in
    *"$3"*)
      ST_FAILS=$((ST_FAILS + 1))
      say "  FAIL $1"
      say "    must not contain: $3"
      ;;
    *) say "  ok   $1" ;;
  esac
}
# st_order <order number> <status> <tradeType> <role>: one P2P record the way Binance lists it, with
# the amount, asset, fiat and nickname a leak check can look for.
st_order() {
  printf '{"orderNumber":"%s","advNo":"11111","tradeType":"%s","asset":"USDTX","fiat":"UAHX","fiatSymbol":"X","amount":"123.456","totalPrice":"5555.5","unitPrice":"41.5","orderStatus":"%s","createTime":1767268800000,"counterPartNickName":"Nickname Secret","payMethodName":"Bank","takerCommission":"0.1","takerAmount":"123.356","advertisementRole":"%s"}' "$1" "$3" "$2" "$4"
}
# st_wrap <total> <record>...: Binance's wrapped answer.
st_wrap() {
  local total="$1" joined='' item
  shift
  for item in "$@"; do joined="${joined:+${joined},}${item}"; done
  printf '{"code":"000000","message":"success","data":[%s],"total":%s,"success":true}' "$joined" "$total"
}
# st_reset: a fresh state for one case (the files and the counters a report reads).
st_reset() {
  local file
  for file in "$ATTEMPT_LOG" "$WALK_LOG" "$WALK_TIMES" "$FIAT_LOG" "$FIAT_ROWS" "$ORDER_ROWS" \
    "$ORDER_DISTINCT" "$ANSWER_LOG" "$RESP_LOG" "$HEADER_LOG" "$WAIT_LOG" "$PART_LOG" "$WEIGHT_LOG" \
    "$JQ_ERRORS"; do
    : >"$file"
  done
  ERROR_STREAK=0
  CALLS=0
  RUN_STATE=running
  WALK_STATE='not started'
  FIAT_STATE='not started'
  WINDOW_COUNT=0
}

# The test double of the walk: signed_get serves the next queued answer and records the query.
ST_STATUSES=()
ST_BODIES=()
ST_QUERIES=()
ST_NEXT=0
st_queue() { # <status> <body>
  ST_STATUSES+=("$1")
  ST_BODIES+=("$2")
}
st_queue_reset() {
  ST_STATUSES=()
  ST_BODIES=()
  ST_QUERIES=()
  ST_NEXT=0
}
st_signed_get() { # <path> <query> <uid cost> <ip cost>
  ST_QUERIES+=("$2")
  printf '%s' "${ST_BODIES[$ST_NEXT]}" >"$BODY"
  STATUS="${ST_STATUSES[$ST_NEXT]}"
  ST_NEXT=$((ST_NEXT + 1))
  CODE="$(code_of)"
  CALLS=$((CALLS + 1))
  printf '%s\n' "$CURRENT_PART" >>"$PART_LOG"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$CURRENT_PART" "$1" 400 "$STATUS" "$CODE" '-' >>"$RESP_LOG"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' 1000 "$1" 60 0 0 "$CURRENT_PART" >>"$HEADER_LOG"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$CURRENT_PART" "$1" "$((1000 * ST_NEXT))" 400 "$STATUS" "$CALL_TAG" >>"$ATTEMPT_LOG"
  note_answer "$1"
}

# st_sample_verdicts: whether each query the double saw passes the allowlist of its path (the
# fiat orders take rows=500, the payments rows=100).
st_sample_verdicts() {
  local query path verdicts=''
  for query in "${ST_QUERIES[@]}"; do
    if [[ $query == *rows=500 ]]; then path="$FIAT_ORDERS_PATH"; else path="$FIAT_PAYMENTS_PATH"; fi
    if query_allowed "$path" "$query"; then verdicts="${verdicts:+${verdicts} }allowed"; else verdicts="${verdicts:+${verdicts} }refused"; fi
  done
  printf '%s' "$verdicts"
}

run_selftest() {
  local report out rc real_signed_get body floor_ms now_ms
  say "selftest: offline (no key prompt, no network); the fixtures are hand-made bodies"
  real_signed_get="$(declare -f signed_get)"

  say "the windows (buildWalkWindows over the floor):"
  st_expect "no window at or before the floor" "0 0" "$(window_count_of "$HISTORY_FLOOR_MS") $(window_count_of 5)"
  st_expect "one millisecond past the floor is one window" "1" "$(window_count_of $((HISTORY_FLOOR_MS + 1)))"
  st_expect "exactly 30 days is one window; one millisecond more is two" "1 2" "$(window_count_of $((HISTORY_FLOOR_MS + WINDOW_MS))) $(window_count_of $((HISTORY_FLOOR_MS + WINDOW_MS + 1)))"
  now_ms=$((HISTORY_FLOOR_MS + 2 * WINDOW_MS + 5000))
  st_expect "three windows for 60 days and 5 s" "3" "$(window_count_of "$now_ms")"
  window_bounds 1 "$now_ms"
  st_expect "window 1 starts at the floor and ends 30 days on" "$HISTORY_FLOOR_MS $((HISTORY_FLOOR_MS + WINDOW_MS))" "$W_START $W_END"
  window_bounds 2 "$now_ms"
  st_expect "window 2 starts where window 1 ends" "$((HISTORY_FLOOR_MS + WINDOW_MS)) $((HISTORY_FLOOR_MS + 2 * WINDOW_MS))" "$W_START $W_END"
  window_bounds 3 "$now_ms"
  st_expect "the last window ends at now" "$((HISTORY_FLOOR_MS + 2 * WINDOW_MS)) ${now_ms}" "$W_START $W_END"
  floor_ms="$(window_count_of 1499990400000)"
  st_expect "the floor is Date.UTC(2017, 6, 14)" "2017-07-14 00:00" "$(utc_text "$HISTORY_FLOOR_MS" '%Y-%m-%d %H:%M')"
  st_expect "the window span is 30 days and the fiat span 730 days" "2592000000 63072000000" "${WINDOW_MS} ${FIAT_SPAN_MS}"
  st_expect "$floor_ms windows at the floor (a placeholder read, kept so the variable is used)" "0" "$floor_ms"

  say "the gate (start to start, not after the response):"
  st_expect "a 100 ms response leaves 250 ms of the 350" "250" "$(pause_rest_ms 100)"
  st_expect "a response slower than the gate leaves nothing" "0" "$(pause_rest_ms 800)"
  st_expect "a response of exactly 350 ms leaves nothing" "0" "$(pause_rest_ms 350)"

  say "the paging of one series in one window, on a test double of signed_get (page size 3):"
  signed_get() { st_signed_get "$@"; }
  P2P_ROWS=3
  P2P_PAGE_CAP=4
  CURRENT_PART=p2p
  st_reset
  st_queue_reset
  st_queue 200 "$(st_wrap 5 "$(st_order 9100000001 COMPLETED BUY TAKER)" "$(st_order 9100000002 COMPLETED BUY TAKER)" "$(st_order 9100000003 CANCELLED BUY TAKER)")"
  st_queue 200 "$(st_wrap 5 "$(st_order 9100000004 COMPLETED BUY MAKER)" "$(st_order 9100000005 PENDING BUY TAKER)")"
  p2p_series_window BUY 7 1500000000000 1502592000000
  st_expect "(a) two pages, the second short: one row of the walk log" "BUY|7|2|5|short-page" "$(tr '\t' '|' <"$WALK_LOG")"
  st_expect "(a) the queries: page 1 then page 2, rows as set, the window bounds as given" \
    "tradeType=BUY&startTimestamp=1500000000000&endTimestamp=1502592000000&page=1&rows=3 tradeType=BUY&startTimestamp=1500000000000&endTimestamp=1502592000000&page=2&rows=3" "${ST_QUERIES[*]}"
  st_expect "(a) five order rows with the series and the three words" "5" "$(wc -l <"$ORDER_ROWS" | tr -d ' ')"
  st_expect "(a) the second row" "9100000002	BUY	COMPLETED	BUY	TAKER" "$(sed -n '2p' "$ORDER_ROWS")"
  st_expect "(a) the attempt log carries the series, window and page" "BUY|7|1 BUY|7|2" "$(awk -F'\t' '{ printf "%s%s|%s|%s", (NR > 1 ? " " : ""), $6, $7, $8 } END { print "" }' "$ATTEMPT_LOG")"
  st_queue_reset
  st_reset
  st_queue 200 "$(st_wrap 3 "$(st_order 9100000001 COMPLETED BUY TAKER)" "$(st_order 9100000002 COMPLETED BUY TAKER)" "$(st_order 9100000003 COMPLETED BUY TAKER)")"
  p2p_series_window BUY 1 1 2
  st_expect "(b) a full page that reaches the response total ends there (no empty next page)" "BUY|1|1|3|total-reached" "$(tr '\t' '|' <"$WALK_LOG")"
  st_queue_reset
  st_reset
  st_queue 200 "$(st_wrap 99 "$(st_order 9100000001 COMPLETED BUY TAKER)" "$(st_order 9100000002 COMPLETED BUY TAKER)" "$(st_order 9100000003 COMPLETED BUY TAKER)")"
  st_queue 200 "$(st_wrap 99 "$(st_order 9100000004 COMPLETED BUY TAKER)" "$(st_order 9100000005 COMPLETED BUY TAKER)" "$(st_order 9100000006 COMPLETED BUY TAKER)")"
  st_queue 200 "$(st_wrap 99 "$(st_order 9100000007 COMPLETED BUY TAKER)" "$(st_order 9100000008 COMPLETED BUY TAKER)" "$(st_order 9100000009 COMPLETED BUY TAKER)")"
  st_queue 200 "$(st_wrap 99 "$(st_order 9100000010 COMPLETED BUY TAKER)" "$(st_order 9100000011 COMPLETED BUY TAKER)" "$(st_order 9100000012 COMPLETED BUY TAKER)")"
  p2p_series_window SELL 2 1 2
  st_expect "(c) the page cap stops a series that has more" "SELL|2|4|12|page-cap" "$(tr '\t' '|' <"$WALK_LOG")"
  st_queue_reset
  st_reset
  st_queue 200 '{"code":"000000","message":"success","data":null,"total":0,"success":true}'
  p2p_series_window BUY 3 1 2
  st_expect "(d) data null is an empty window, ended ok" "BUY|3|1|0|short-page" "$(tr '\t' '|' <"$WALK_LOG")"
  st_queue_reset
  st_reset
  st_queue 400 '{"code":-5026,"msg":"Start time is too old."}'
  p2p_series_window BUY 4 1 2
  st_expect "(e) a -5026 answer is booked as refused, not as an empty window" "BUY|4|1|0|refused" "$(tr '\t' '|' <"$WALK_LOG")"
  st_expect "(e) the error streak counts it" "1" "$ERROR_STREAK"
  st_queue_reset
  st_reset
  st_queue 200 '{"code":"100001","message":"nope","data":[],"total":0}'
  p2p_series_window SELL 5 1 2
  st_expect "(f) HTTP 200 with a wrapper code other than 000000 is bad-body" "SELL|5|1|0|bad-body" "$(tr '\t' '|' <"$WALK_LOG")"
  st_queue_reset
  st_reset
  st_queue 200 "$(st_wrap 1 '{"orderNumber":7,"orderStatus":null,"tradeType":5}' '{"advNo":"x","orderStatus":"Weird Status With Spaces And More Words Than Fits In Forty","tradeType":"BUY","advertisementRole":"TAKER"}')"
  p2p_series_window BUY 6 1 2
  st_expect "(g) a number order number is text, a null or missing word is a fixed word" "7	BUY	(absent)	(not text)	(absent)"$'\n'"	BUY	Weird Status With Spaces And More Words Than Fits In Forty	BUY	TAKER" "$(cat "$ORDER_ROWS")"
  st_reset
  st_queue_reset
  st_queue 400 '{"code":-1121,"msg":"Invalid."}'
  st_queue 400 '{"code":-1121,"msg":"Invalid."}'
  st_queue 400 '{"code":-1121,"msg":"Invalid."}'
  rc=0
  out="$( (
    p2p_series_window BUY 1 1 2
    p2p_series_window SELL 1 1 2
    p2p_series_window BUY 2 1 2
  ) 2>&1)" || rc=$?
  st_expect "(h) 3 error reads in a row stop the run: exit code 3" "3" "$rc"
  st_contains "(h) the stop reason" "$out" "STOP: 3 reads in a row were answered by an error (each already retried once)"
  st_contains "(h) the stop prints the report" "$out" "== VERDICT (decided only by the counts above) =="
  st_contains "(h) the verdict flags the run incomplete" "$out" "READ INCOMPLETE: this run stopped before the end (stopped)"
  st_reset
  st_queue_reset
  st_queue 400 '{"code":-1121,"msg":"Invalid."}'
  st_queue 200 "$(st_wrap 0)"
  st_queue 400 '{"code":-1121,"msg":"Invalid."}'
  st_queue 400 '{"code":-1121,"msg":"Invalid."}'
  p2p_series_window BUY 1 1 2
  p2p_series_window SELL 1 1 2
  p2p_series_window BUY 2 1 2
  p2p_series_window SELL 2 1 2
  st_expect "(h) an ok read between errors resets the streak: no stop" "4" "$(wc -l <"$WALK_LOG" | tr -d ' ')"
  P2P_ROWS=100
  P2P_PAGE_CAP=20

  say "the words and the report, on a full fixture walk (no order number, amount, asset, fiat or nickname in the text):"
  st_reset
  st_queue_reset
  CURRENT_PART=p2p
  P2P_ROWS=3
  st_queue 200 "$(st_wrap 2 "$(st_order 9100000001 COMPLETED BUY TAKER)" "$(st_order 9100000002 CANCELLED BUY TAKER)")"
  st_queue 200 "$(st_wrap 1 "$(st_order 9100000003 COMPLETED SELL TAKER)")"
  st_queue 200 "$(st_wrap 0)"
  st_queue 200 "$(st_wrap 0)"
  st_queue 200 "$(st_wrap 1 "$(st_order 9100000002 CANCELLED BUY TAKER)")"
  st_queue 200 "$(st_wrap 1 "$(st_order 9100000004 PENDING SELL MAKER)")"
  p2p_series_window BUY 1 1 2
  p2p_series_window SELL 1 1 2
  p2p_series_window BUY 2 1 2
  p2p_series_window SELL 2 1 2
  p2p_series_window BUY 3 1 2
  p2p_series_window SELL 3 1 2
  WINDOW_COUNT=3
  WALK_STATE=complete
  printf '%s\t%s\n' 1000 61000 >"$WALK_TIMES"
  RUN_STATE=complete
  report="$(report_walk)"
  say "$report"
  st_contains "(i) the windows line" "$report" "windows: 3 (series reads made: 6 of 6); windows with rows: 2; empty windows (every series ended ok with 0 rows): 1; windows with a failed or cut series read: 0"
  st_contains "(i) the end words" "$report" "how each series read ended (word=reads): short-page=6"
  st_contains "(i) rows and the distinct orders (order 9100000002 repeats across a shared boundary)" "$report" "rows read: 5; distinct orders: 4"
  st_contains "(i) the oldest and the newest window with an order" "$report" "oldest window index with an order (window 1 starts at the floor, window 3 ends at the walk start): 1; newest: 3"
  st_contains "(i) the status words of the distinct orders" "$report" "orderStatus words, distinct orders (word=orders): COMPLETED=2 CANCELLED=1 PENDING=1"
  st_contains "(i) the status words asked as SELL" "$report" "asked as SELL: COMPLETED=1 PENDING=1"
  st_contains "(i) the tradeType words and no mismatch" "$report" "tradeType words of the records (word=orders): BUY=2 SELL=2; a record whose tradeType differs from the series asked: 0"
  st_contains "(i) the role words" "$report" "advertisementRole words (word=orders): TAKER=3 MAKER=1"
  st_contains "(i) rows per window" "$report" "rows per window (rows=windows): 0=1 2=1 3=1"
  st_contains "(i) the wall time" "$report" "wall time: 60000 ms"
  st_absent "(i) no order number leaks" "$report" "91000000"
  st_absent "(i) no amount leaks" "$report" "123.456"
  st_absent "(i) no total price leaks" "$report" "5555.5"
  st_absent "(i) no asset leaks" "$report" "USDTX"
  st_absent "(i) no fiat leaks" "$report" "UAHX"
  st_absent "(i) no nickname leaks" "$report" "Secret"
  st_absent "(i) no time leaks" "$report" "1767268800000"
  P2P_ROWS=100
  st_reset
  st_queue_reset
  st_queue 200 "$(st_wrap 1 '{"orderNumber":"1","orderStatus":"<script>x</script>","tradeType":"BUY","advertisementRole":"TAKER"}')"
  P2P_ROWS=3
  p2p_series_window BUY 1 1 2
  P2P_ROWS=100
  WALK_STATE=complete
  WINDOW_COUNT=1
  report="$(report_walk)"
  st_contains "(j) a word that is not letters is shown as (other)" "$report" "orderStatus words, distinct orders (word=orders): (other)=1"
  st_absent "(j) the markup does not reach the report" "$report" "script"

  say "the lane caps (the measured calls of a walk of 6 windows, 2 calls each, 400 ms apart):"
  st_reset
  local win=1 start=100000
  while [ "$win" -le 6 ]; do
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' p2p "$P2P_PATH" "$start" 300 200 BUY "$win" 1 >>"$ATTEMPT_LOG"
    start=$((start + 400))
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' p2p "$P2P_PATH" "$start" 300 200 SELL "$win" 1 >>"$ATTEMPT_LOG"
    start=$((start + 400))
    win=$((win + 1))
  done
  st_expect "(k) cap 10: 5 windows a run, so 2 runs; window 1 in run 1, window 6 in run 2; 10 calls started inside 4 s hold 9000" \
    "runs 2; run of the oldest order window 1; run of the newest order window 2; largest UID weight in any 60 s of a run 9000; longest run 3900 ms; average run 2300 ms" "$(caps_line 10 1 6)"
  st_expect "(k) cap 4: 2 windows a run, so 3 runs; 4 calls hold 3600" \
    "runs 3; run of the oldest order window 1; run of the newest order window 3; largest UID weight in any 60 s of a run 3600; longest run 1500 ms; average run 1500 ms" "$(caps_line 4 1 6)"
  st_expect "(k) cap 40: one run, 12 calls hold 10800; no order window gives -" \
    "runs 1; run of the oldest order window -; run of the newest order window -; largest UID weight in any 60 s of a run 10800; longest run 4700 ms; average run 4700 ms" "$(caps_line 40 - -)"
  st_expect "(k) cap 3: a window needs 2 calls of room, so 1 window a run and 6 runs" \
    "runs 6; run of the oldest order window 1; run of the newest order window 6; largest UID weight in any 60 s of a run 1800; longest run 700 ms; average run 700 ms" "$(caps_line 3 1 6)"
  st_reset
  st_expect "(k) no call made" "no call made" "$(caps_line 10 - -)"
  start=0
  for win in 1 1 2 2 3; do
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' p2p "$P2P_PATH" "$start" 100 200 BUY "$win" 1 >>"$ATTEMPT_LOG"
    start=$((start + 40000))
  done
  st_expect "(l) calls 40 s apart: at most 2 start inside any 60 s, so 1800 (5 calls, 3 windows, cap 10, one run)" \
    "runs 1; run of the oldest order window 1; run of the newest order window 1; largest UID weight in any 60 s of a run 1800; longest run 160100 ms; average run 160100 ms" "$(caps_line 10 1 3)"

  say "the fiat samples, on a test double:"
  st_reset
  st_queue_reset
  FIAT_NOW=1790000000000
  st_queue 200 "$(st_wrap 2 '{"orderNo":"AAA111","fiatCurrency":"EURX","indicatedAmount":"100.00","amount":"99.00","totalFee":"1.00","method":"card","status":"Successful","createTime":1,"updateTime":2}' '{"orderNo":"AAA112","status":"Order Partial Credit Stopped"}')"
  st_queue 200 '{"code":"000000","message":"success","data":null,"total":0,"success":true}'
  st_queue 400 '{"code":-2015,"msg":"Invalid API-key, IP 203.0.113.9, or permissions for action"}'
  st_queue 200 "$(st_wrap 1 '{"orderNo":"PPP","sourceAmount":"10","status":"Completed"}')"
  run_fiat_samples
  st_expect "(m) the four queries: type 0 and 1, the newest 2-year window, rows 500 and 100" \
    "transactionType=0&beginTime=$((FIAT_NOW - FIAT_SPAN_MS))&endTime=${FIAT_NOW}&page=1&rows=500 transactionType=1&beginTime=$((FIAT_NOW - FIAT_SPAN_MS))&endTime=${FIAT_NOW}&page=1&rows=500 transactionType=0&beginTime=$((FIAT_NOW - FIAT_SPAN_MS))&endTime=${FIAT_NOW}&page=1&rows=100 transactionType=1&beginTime=$((FIAT_NOW - FIAT_SPAN_MS))&endTime=${FIAT_NOW}&page=1&rows=100" "${ST_QUERIES[*]}"
  st_expect "(m) every sample query passes the allowlist" "allowed allowed allowed allowed" "$(st_sample_verdicts)"
  report="$(report_fiat)"
  say "$report"
  st_contains "(m) orders-0: 200, 2 rows, total 2, the key names" "$report" "orders-0: HTTP 200; code 000000; rows 2; response total 2; answer shape ok (1 = wrapped list) 1"
  st_contains "(m) orders-0 key names are schema words only" "$report" "first record key names: amount,createTime,fiatCurrency,indicatedAmount,method,orderNo,status,totalFee,updateTime; status words (word=rows): Order Partial Credit Stopped=1 Successful=1"
  st_contains "(m) orders-1: an empty data null is 200 with 0 rows" "$report" "orders-1: HTTP 200; code 000000; rows 0; response total 0"
  st_contains "(m) payments-0: the error answer is shown with the digits masked" "$report" "error msg (digits masked, cut at 160): Invalid API-key, IP #.#.#.#, or permissions for action"
  st_contains "(m) payments-1: the status word" "$report" "status words (word=rows): Completed=1"
  st_absent "(m) no order number leaks" "$report" "AAA111"
  st_absent "(m) no amount leaks" "$report" "99.00"
  st_absent "(m) no currency leaks" "$report" "EURX"
  st_absent "(m) no address leaks" "$report" "203.0.113.9"

  say "sizing the call cap and the run time limit:"
  CALLS=2
  CALL_CAP_USER=''
  MAX_RUN_USER=''
  size_limits 114 30
  st_expect "(n) 114 windows: cap = 2 calls made + 228 + 4 + 40 + 20" "294" "$CALL_CAP"
  st_expect "(n) 114 windows: time = 30 + (228 + 4 + 40) x 2 + 20 x 5 + 180" "854" "$MAX_RUN_SECONDS"
  CALL_CAP_USER=500
  MAX_RUN_USER=900
  CALL_CAP=500
  MAX_RUN_SECONDS=900
  size_limits 114 30
  st_expect "(n) a cap and a time limit set in the environment are kept" "500 900" "${CALL_CAP} ${MAX_RUN_SECONDS}"
  CALL_CAP_USER=''
  MAX_RUN_USER=''
  CALL_CAP=30
  MAX_RUN_SECONDS=900

  say "the call cap and the run time limit stop cleanly:"
  eval "$real_signed_get"
  st_reset
  rc=0
  out="$( (
    CALLS=7
    CALL_CAP=7
    CURRENT_PART=p2p
    check_limits
  ) 2>&1)" || rc=$?
  st_expect "(o) the call cap: exit code 3" "3" "$rc"
  st_contains "(o) the call cap: the stop reason" "$out" "STOP: the safety cap of 7 calls was reached (part p2p, after 7 calls). No further call is made."
  rc=0
  out="$( (
    MAX_RUN_SECONDS=0
    check_limits
  ) 2>&1)" || rc=$?
  st_expect "(o) the run time limit: exit code 3" "3" "$rc"
  rc=0
  out="$( (
    STATUS=403
    CURRENT_PART=p2p
    finish_call "$P2P_PATH" 900 1
  ) 2>&1)" || rc=$?
  st_expect "(o) a 403 stops the run at once: exit code 3" "3" "$rc"

  say "the allowlist:"
  st_expect "the allowlist refuses a POST of the P2P history" "refused" "$(request_allowed POST "$P2P_PATH" signed && echo allowed || echo refused)"
  st_expect "the allowlist refuses a DELETE" "refused" "$(request_allowed DELETE "$FIAT_ORDERS_PATH" signed && echo allowed || echo refused)"
  st_expect "the allowlist refuses the fiat deposit endpoint" "refused" "$(request_allowed GET /sapi/v1/fiat/deposit signed && echo allowed || echo refused)"
  st_expect "the allowlist refuses the fiat withdraw endpoint" "refused" "$(request_allowed GET /sapi/v2/fiat/withdraw signed && echo allowed || echo refused)"
  st_expect "the allowlist refuses myTrades (probe 9)" "refused" "$(request_allowed GET /api/v3/myTrades signed && echo allowed || echo refused)"
  st_expect "the allowlist refuses exchangeInfo (probe 9)" "refused" "$(request_allowed GET /api/v3/exchangeInfo public && echo allowed || echo refused)"
  st_expect "the allowlist refuses a signed path on the public side" "refused" "$(request_allowed GET "$P2P_PATH" public && echo allowed || echo refused)"
  st_expect "the allowlist refuses the time as a signed path" "refused" "$(request_allowed GET "$TIME_PATH" signed && echo allowed || echo refused)"
  st_expect "the allowlist accepts a GET of the P2P history" "allowed" "$(request_allowed GET "$P2P_PATH" signed && echo allowed || echo refused)"
  st_expect "the allowlist accepts a GET of fiat orders" "allowed" "$(request_allowed GET "$FIAT_ORDERS_PATH" signed && echo allowed || echo refused)"
  st_expect "the allowlist accepts a GET of fiat payments" "allowed" "$(request_allowed GET "$FIAT_PAYMENTS_PATH" signed && echo allowed || echo refused)"
  st_expect "the allowlist accepts a GET of the account" "allowed" "$(request_allowed GET "$ACCOUNT_PATH" signed && echo allowed || echo refused)"
  st_expect "the allowlist accepts a GET of the public time" "allowed" "$(request_allowed GET "$TIME_PATH" public && echo allowed || echo refused)"
  st_expect "a query: the time takes none" "refused" "$(query_allowed "$TIME_PATH" 'a=1' && echo allowed || echo refused)"
  st_expect "a query: the account with omitZeroBalances=true" "allowed" "$(query_allowed "$ACCOUNT_PATH" 'omitZeroBalances=true' && echo allowed || echo refused)"
  st_expect "a query: the account with another query is refused" "refused" "$(query_allowed "$ACCOUNT_PATH" 'omitZeroBalances=false' && echo allowed || echo refused)"
  st_expect "a query: P2P BUY" "allowed" "$(query_allowed "$P2P_PATH" 'tradeType=BUY&startTimestamp=1&endTimestamp=2&page=1&rows=100' && echo allowed || echo refused)"
  st_expect "a query: P2P SELL page 12" "allowed" "$(query_allowed "$P2P_PATH" 'tradeType=SELL&startTimestamp=1&endTimestamp=2&page=12&rows=100' && echo allowed || echo refused)"
  st_expect "a query: P2P with another side is refused" "refused" "$(query_allowed "$P2P_PATH" 'tradeType=HOLD&startTimestamp=1&endTimestamp=2&page=1&rows=100' && echo allowed || echo refused)"
  st_expect "a query: P2P with rows other than 100 is refused" "refused" "$(query_allowed "$P2P_PATH" 'tradeType=BUY&startTimestamp=1&endTimestamp=2&page=1&rows=500' && echo allowed || echo refused)"
  st_expect "a query: P2P with an extra parameter is refused" "refused" "$(query_allowed "$P2P_PATH" 'tradeType=BUY&startTimestamp=1&endTimestamp=2&page=1&rows=100&x=1' && echo allowed || echo refused)"
  st_expect "a query: P2P with a non-digit start is refused" "refused" "$(query_allowed "$P2P_PATH" 'tradeType=BUY&startTimestamp=1a&endTimestamp=2&page=1&rows=100' && echo allowed || echo refused)"
  st_expect "a query: fiat orders type 1" "allowed" "$(query_allowed "$FIAT_ORDERS_PATH" 'transactionType=1&beginTime=1&endTime=2&page=1&rows=500' && echo allowed || echo refused)"
  st_expect "a query: fiat orders with rows 100 is refused" "refused" "$(query_allowed "$FIAT_ORDERS_PATH" 'transactionType=1&beginTime=1&endTime=2&page=1&rows=100' && echo allowed || echo refused)"
  st_expect "a query: fiat orders with page 2 is refused" "refused" "$(query_allowed "$FIAT_ORDERS_PATH" 'transactionType=1&beginTime=1&endTime=2&page=2&rows=500' && echo allowed || echo refused)"
  st_expect "a query: fiat orders with type 2 is refused" "refused" "$(query_allowed "$FIAT_ORDERS_PATH" 'transactionType=2&beginTime=1&endTime=2&page=1&rows=500' && echo allowed || echo refused)"
  st_expect "a query: fiat payments type 0" "allowed" "$(query_allowed "$FIAT_PAYMENTS_PATH" 'transactionType=0&beginTime=1&endTime=2&page=1&rows=100' && echo allowed || echo refused)"
  st_expect "a query: fiat payments with rows 500 is refused" "refused" "$(query_allowed "$FIAT_PAYMENTS_PATH" 'transactionType=0&beginTime=1&endTime=2&page=1&rows=500' && echo allowed || echo refused)"
  st_expect "a query: a path off the list has no query" "refused" "$(query_allowed /sapi/v1/asset/dribblet '' && echo allowed || echo refused)"
  rc=0
  out="$( (signed_call POST "$P2P_PATH" 'tradeType=BUY&startTimestamp=1&endTimestamp=2&page=1&rows=100' 900 1) 2>&1)" || rc=$?
  st_expect "a POST is refused before a byte is sent: exit code 3" "3" "$rc"
  st_contains "a POST is refused before a byte is sent: the reason" "$out" "STOP: a request other than a GET of an allowlisted path was refused"
  rc=0
  out="$( (signed_call GET "$P2P_PATH" 'tradeType=BUY&startTimestamp=1&endTimestamp=2&page=1&rows=100&x=1' 900 1) 2>&1)" || rc=$?
  st_expect "an unlisted query is refused before a byte is sent: exit code 3" "3" "$rc"
  st_contains "an unlisted query is refused: the reason" "$out" "STOP: a query other than the one listed for its path was refused"
  rc=0
  out="$( (public_get "$TIME_PATH" 1 'a=1') 2>&1)" || rc=$?
  st_expect "a public query other than the listed one is refused: exit code 3" "3" "$rc"
  rc=0
  out="$( (fetch 'url = "x"
request = "POST"') 2>&1)" || rc=$?
  st_expect "a curl config with a request line is refused: exit code 3" "3" "$rc"
  st_contains "a curl config with a request line is refused: the reason" "$out" "STOP: a curl config other than a plain GET was refused"

  body="$(st_wrap 0)"
  st_expect "the offline fixtures are wrapped answers" "000000" "$(printf '%s' "$body" | jq -r '.code')"

  say "selftest: ${ST_CHECKS} checks, ${ST_FAILS} failed"
  if [ "$ST_FAILS" -ne 0 ]; then
    say "SELFTEST FAIL"
    exit 1
  fi
  say "SELFTEST PASS"
  exit 0
}

if [ "$PART" = selftest ]; then
  run_selftest
fi

# RFC 4231 test case 2 (a public dummy key and message): a wrong or missing Digest::SHA stops here.
if [ "$(hmac_hex 'Jefe' 'what do ya want for nothing?')" != '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843' ]; then
  echo "HMAC self-test failed (perl with Digest::SHA is required at /usr/bin/perl). Stop." >&2
  exit 1
fi

# ---- credentials: hidden prompt, never echoed, checked without printing them ----
printf 'Binance API key (hidden): ' >&2
IFS= read -rs API_KEY || true
printf '\n' >&2
printf 'Binance API secret (hidden): ' >&2
IFS= read -rs API_SECRET || true
printf '\n' >&2
case "$API_KEY" in
  '' | *[!A-Za-z0-9]*)
    echo "The key is empty or holds a character other than A-Z a-z 0-9 (a space or a line break from pasting?). Nothing was sent. Stop." >&2
    exit 1
    ;;
esac
case "$API_SECRET" in
  '' | *[!A-Za-z0-9]*)
    echo "The secret is empty or holds a character other than A-Z a-z 0-9 (a space or a line break from pasting?). Nothing was sent. Stop." >&2
    exit 1
    ;;
esac

trap 'finish_partial 130' INT TERM
trap 'finish_partial 129' HUP
# The time limit counts from here.
SECONDS=0

LOCAL_START_MS="$(local_ms)"
case "$LOCAL_START_MS" in
  '' | *[!0-9]*)
    echo "The local clock could not be read. Nothing was sent. Stop." >&2
    exit 1
    ;;
esac
say "binance-p2p-probe-10.sh, part: ${PART}"
say "run date (UTC): $(utc_text "$LOCAL_START_MS" '%Y-%m-%d %H:%M')"
say "read-only: every request is a GET of an allowlisted path with its one listed query (${TIME_PATH} public; ${ACCOUNT_PATH}, ${P2P_PATH}, ${FIAT_ORDERS_PATH} and ${FIAT_PAYMENTS_PATH} signed); budgets per 60 s: UID ${UID_BUDGET_1M} per endpoint, IP ${IP_BUDGET_1M}; gate ${PAUSE_MS} ms from request start to request start; one retry per call on HTTP 400 code -1021, HTTP 000 or HTTP 5xx; until the window count is known the setup holds at ${SETUP_CALL_CAP} calls and ${SETUP_MAX_RUN_SECONDS} s"
say "the output holds counts, window indexes, enum words (orderStatus, tradeType, advertisementRole, fiat status), key names of a schema, wall times in ms, weight peaks, HTTP status / response codes, the clock offset in ms and response times in ms only; never an order number, amount, price, asset, fiat code, nickname, time, user id or key; an error answer also prints Binance's msg with every digit run masked"
progress "Do not open or refresh Kiko during the run (it shares the Binance weight budget)."

CURRENT_PART='setup'
progress "[$(date +%H:%M:%S)] clock: GET ${TIME_PATH}"
if ! sync_clock; then
  stop_run "GET ${TIME_PATH} failed after its retry; no signed call was sent"
fi
CLOCK_START_OFFSET="$CLOCK_OFFSET"
CLOCK_START_RTT=$((ATTEMPT_END_MS - ATTEMPT_START_MS))
say ""
say "== CLOCK at the start =="
say "Binance serverTime minus the local clock: ${CLOCK_START_OFFSET} ms (round trip of that request ${CLOCK_START_RTT} ms)"

# ---- the key check: a read-only account read; only its HTTP status is looked at ----
CURRENT_PART='keycheck'
progress "[$(date +%H:%M:%S)] key check: GET ${ACCOUNT_PATH} (signed)"
signed_get "$ACCOUNT_PATH" "$ACCOUNT_QUERY" 0 "$ACCOUNT_IP_COST"
KEY_CHECK_STATE="HTTP ${STATUS}"

# ---- size the limits from the window count, then the fiat samples and the walk ----
WALK_NOW=$(($(local_ms) + CLOCK_OFFSET))
WINDOW_COUNT="$(window_count_of "$WALK_NOW")"
size_limits "$WINDOW_COUNT" "$SECONDS"
report_plan

run_fiat_samples
run_p2p_walk
RUN_STATE='complete'

report_everything
say "== done =="
