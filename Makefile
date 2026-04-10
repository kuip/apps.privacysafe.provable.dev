.PHONY: dev kayros publish-kayros nomen publish-nomen

dev:
	./scripts/dev.sh

kayros:
	@echo "Use 'make publish-kayros' to release Kayros."

publish-kayros:
	./scripts/release-kayros.sh

nomen:
	@echo "Use 'make publish-nomen' to release Nomen."

publish-nomen:
	./scripts/release-nomen.sh
