.PHONY: dev build-kayros build-nomen build-wallet kayros publish-kayros nomen publish-nomen wallet

dev:
	./scripts/dev.sh

build-kayros:
	cd kayros && npm run pack

build-nomen:
	cd nomen && npm run pack

build-wallet:
	cd wallet && npm run pack

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
