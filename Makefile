.PHONY: dev dev-frontend dev-api dev-relay dev-billing dev-landing install test-build test-backend test-e2e test-all

# Run Vite dev server
dev-frontend:
	cd frontend && npm run dev

# Run API with uvicorn (auto-reload)
dev-api:
	cd backend/api && uvicorn main:app --reload --port 8080

# Run relay with uvicorn (auto-reload)
dev-relay:
	cd backend/relay && uvicorn main:app --reload --port 8081

# Run landing site dev server
dev-landing:
	cd landing && npm run dev

# Run billing service with uvicorn (auto-reload)
dev-billing:
	cd backend/billing && uvicorn main:app --reload --port 8082

# Run all four services (requires terminal multiplexing)
dev:
	@echo "Starting all services..."
	@make dev-api & make dev-relay & make dev-billing & make dev-frontend

# Install all dependencies
install:
	cd frontend && npm install
	cd backend/api && pip install -r requirements.txt
	cd backend/relay && pip install -r requirements.txt
	cd backend/billing && pip install -r requirements.txt

# Verify all services compile/build without errors
test-build:
	@echo "=== Frontend TypeScript check ==="
	cd frontend && npx tsc --noEmit
	@echo "=== Frontend Vite build ==="
	cd frontend && npm run build
	@echo "=== Backend API import check ==="
	cd backend/api && python -c "from main import app; print(f'{len(app.routes)} routes OK')"
	@echo "=== Backend Relay import check ==="
	cd backend/relay && python -c "from main import app; print('Relay OK')"
	@echo "All builds passed."

# Run backend pytest suite
test-backend:
	cd backend/api && python -m pytest ../../tests/backend/ -v --tb=short

# Run Playwright E2E tests (requires services running)
test-e2e:
	cd frontend && npx playwright test --reporter=list

# Run all tests
test-all: test-build test-backend test-e2e
