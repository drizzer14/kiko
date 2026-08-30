#!/usr/bin/env bash
# Shared helper for harness check wrappers. Prints the structured failure
# block to stderr so a Claude Code hook (exit 2) feeds it back to the agent.

print_block() {
  # $1 name  $2 what  $3 details  $4 why  $5 howto  $6 donot
  {
    printf '────────────────────────────────────────────────────────\n'
    printf '✖ CHECK FAILED: %s\n' "$1"
    printf '────────────────────────────────────────────────────────\n'
    printf 'WHAT FAILED:    %s\n' "$2"
    printf 'DETAILS:        %s\n' "$3"
    printf 'WHY IT MATTERS: %s\n' "$4"
    printf 'HOW TO FIX:     %s\n' "$5"
    printf 'DO NOT:         %s\n' "$6"
    printf '────────────────────────────────────────────────────────\n'
  } >&2
}
