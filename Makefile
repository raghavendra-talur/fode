PORT ?= 9100
DB   ?= .fode/fode.db
GO   := go
NPM  := npm

.PHONY: help dev dev-api dev-ui build build-api build-ui test test-api test-ui \
        fmt clean install-deps analyze schema

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'

install-deps: ## fetch go modules and npm packages
	$(GO) mod download
	cd ui && $(NPM) install

dev: ## run API + Vite with HMR (parallel)
	$(MAKE) -j2 dev-api dev-ui

dev-api: ## run the API server on $(PORT)
	$(GO) run . serve --port $(PORT) --db $(DB)

dev-ui: ## vite dev server, proxies /api to :$(PORT)
	cd ui && $(NPM) run dev

analyze: ## run analyzer once against $(REPO), write to DB
	$(GO) run . analyze $(REPO)

schema: ## print current sqlite schema
	@sqlite3 $(DB) .schema 2>/dev/null || echo "no DB at $(DB) yet"

build: ## build all artifacts
	$(MAKE) build-api build-ui

build-api: ## compile fode binary to ./bin
	$(GO) build -o bin/fode .

build-ui: ## bundle SPA to ui/dist
	cd ui && $(NPM) run build

test: ## run all tests
	$(MAKE) test-api test-ui

test-api: ## go test
	$(GO) test ./...

test-ui: ## vitest
	cd ui && $(NPM) test

fmt: ## format Go + TS
	gofmt -w .
	cd ui && $(NPM) run format

clean: ## remove build artifacts and local DB
	rm -rf bin ui/dist ui/node_modules .fode
