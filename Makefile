TAG ?= latest
MONGO_TEST_IMAGE ?= mongo:8.2

.PHONY: db-up db-down test check deploy og-image
db-up:
	docker run -d --rm --name deps-mongo-test -p 27017:27017 $(MONGO_TEST_IMAGE)
db-down:
	docker stop deps-mongo-test
test:
	MONGO_URL=mongodb://localhost:27017 npx vitest run
check:
	npm run lint && npm run typecheck && $(MAKE) test
deploy:
	ssh app-1 'cd /srv/deps && TAG=$(TAG) docker compose pull web && TAG=$(TAG) docker compose up -d'
	./scripts/smoke.sh https://deps.noticely.dev
og-image:
	google-chrome --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --window-size=1200,630 \
	  --user-data-dir=$$(mktemp -d) --screenshot=public/og.png file://$(CURDIR)/design/og-image.html
