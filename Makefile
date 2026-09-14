# Kiko dev Makefile — run the common tasks yourself (for example when an agent
# is rate-limited). Each target wraps the real package.json script or recipe, so
# the exact commands live in one place. Run `make` (or `make help`) to list them.
#
# Device deploy: `make deploy` auto-detects the connected iPhone. To target a
# specific device: `make deploy DEVICE=<udid>` (or set DEVICE_ID in the env).

.DEFAULT_GOAL := help

.PHONY: help deploy pods gate jest deep typecheck lint dup knip deps \
        security secrets rules plist overrides start clean-ios

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# --- Build & deploy (physical iPhone) ---

deploy: ## Build Release-AdHoc + install on the connected iPhone (pod install auto-runs on build failure)
	npm run deploy:device $(DEVICE)

pods: ## Install CocoaPods in ios/
	cd ios && pod install

clean-ios: ## Remove the iOS build output (forces a clean rebuild + pod install next deploy)
	rm -rf ios/build

# --- Quality gates ---

gate: ## Full fast+medium gate: lint, dup, knip, deps, security, rules, plist, secrets, overrides, typecheck
	npm run check:all

jest: ## Run the full Jest suite
	npx jest

deep: ## Deep gate: mutation testing + osv-scanner (slow, 10-20+ min). It prints a `tail -f` line to watch progress.
	npm run check:deep

typecheck: ## tsc --noEmit
	npm run check:typecheck

lint: ## Biome lint/format check
	npm run check:lint

# --- Individual checks (rarely needed alone) ---

dup: ## jscpd duplicate-code check
	npm run check:dup
knip: ## Knip unused files/exports/deps
	npm run check:knip
deps: ## depcheck + lockfile check
	npm run check:deps
security: ## Semgrep security scan
	npm run check:security
rules: ## Semgrep project-rule fixtures
	npm run check:rules
plist: ## Info.plist security invariants
	npm run check:plist
secrets: ## gitleaks secret scan
	npm run check:secrets
overrides: ## biome-ignore override guard
	npm run check:overrides

# --- Dev server ---

start: ## Start the Metro bundler
	npm start
