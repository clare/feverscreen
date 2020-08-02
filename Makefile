.PHONY: build-arm
build-arm: install-packr
	./build-frontend.sh
	GOOS=linux GOARCH=arm GOARM=7 packr build -ldflags="-s -w" ./cmd/feverscreen

.PHONY: install-packr
install-packr:
  ifeq (, $(shell which packr))
		go get github.com/gobuffalo/packr/packr
  endif

.PHONY: build
build: install-packr
	./build-frontend.sh
	packr build -v -ldflags="-s -w" ./cmd/feverscreen

.PHONY: release
release: install-packr
	curl -sL https://git.io/goreleaser | bash

.PHONY: clean
clean:
	packr clean
	rm feverscreen

.PHONY: install-typescript
install-typescript:
	npm install -g typescript
	npm install -g rollup

.PHONY: build-web
build-web:
	./build-frontend.sh
