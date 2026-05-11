.PHONY: build-apps build-kayros build-nomen build-wallet build-wallet-test-external kayros publish-kayros nomen publish-nomen wallet wallet-test-external

build-kayros:
	cd kayros && npm run pack

build-nomen:
	cd nomen && npm run pack

build-wallet:
	node scripts/build-apps.mjs wallet

build-wallet-test-external:
	node scripts/build-apps.mjs wallet-test-external

build-apps:
	node scripts/build-apps.mjs

kayros:
	@echo "Use 'make publish-kayros' to release Kayros."

publish-kayros:
	./scripts/release-kayros.sh

nomen:
	@echo "Use 'make publish-nomen' to release Nomen."

publish-nomen:
	./scripts/release-nomen.sh

wallet:
	@echo "Use 'make build-wallet' while wallet release flow is still manual."

wallet-test-external:
	@echo "Use 'make build-wallet-test-external' for the wallet external test app."
