.PHONY: images load up up-force up-full down logs ps

# Build all OCI images in parallel via Bazel
images:
	bazel build //:all_images

# Load built images into Docker daemon
load: images
	bazel run //reverse-proxy:image_tar
	bazel run //backend:image_tar
	bazel run //agent:image_tar
	bazel run //auth-proxy:image_tar

# Build + load images, then start compose
up: load
	docker compose up -d

# Build + load, force-recreate all containers
up-force: load
	docker compose up -d --force-recreate

# Full profile (PostgreSQL + hot-reload api-full)
up-full: load
	docker compose --profile full up -d

# Stop all services
down:
	docker compose down

# Tail logs
logs:
	docker compose logs -f

# Show service status
ps:
	docker compose ps
