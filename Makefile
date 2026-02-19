.PHONY: dev dev-frontend dev-api dev-relay install

# Run Vite dev server
dev-frontend:
	cd frontend && npm run dev

# Run API with uvicorn (auto-reload)
dev-api:
	cd backend/api && uvicorn main:app --reload --port 8080

# Run relay with uvicorn (auto-reload)
dev-relay:
	cd backend/relay && uvicorn main:app --reload --port 8081

# Run all three services (requires terminal multiplexing)
dev:
	@echo "Starting all services..."
	@make dev-api & make dev-relay & make dev-frontend

# Install all dependencies
install:
	cd frontend && npm install
	cd backend/api && pip install -r requirements.txt
	cd backend/relay && pip install -r requirements.txt
