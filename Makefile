.PHONY: dev build-kayros build-nomen kayros publish-kayros nomen publish-nomen

dev:
	./scripts/dev.sh

build-kayros:
	cd kayros && npm run pack

build-nomen:
	cd nomen && npm run pack

kayros:
	@echo "Use 'make publish-kayros' to release Kayros."

publish-kayros:
	./scripts/release-kayros.sh

nomen:
	@echo "Use 'make publish-nomen' to release Nomen."

publish-nomen:
	./scripts/release-nomen.sh
