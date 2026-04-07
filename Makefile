.PHONY: kayros publish:kayros

kayros:
	@echo "Use 'make publish:kayros' to release Kayros."

publish:kayros:
	./scripts/release-kayros.sh
