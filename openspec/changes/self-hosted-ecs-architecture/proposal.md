## Why

The current architecture assumes a shared multi-tenant deployment. A self-hosted, single-tenant ECS model gives enterprise customers full data isolation (each org runs in its own AWS account), reduces compliance surface area, and opens a new distribution channel where customers deploy into their own infrastructure. The existing Docker Compose stack maps naturally to ECS Fargate task definitions.

## What Changes

- Define a tiered CDK deployment model: Starter (Fargate + EBS Postgres + S3), Pro (Aurora Serverless v2), Enterprise (Aurora Multi-AZ + autoscaling)
- Implement the Starter tier stack as the first deliverable: two-container Fargate task (`api` + `agent`), EBS gp3 Postgres, S3 Standard storage, API Gateway + VPC Link, Container Insights observability
- Add a control plane concept: web portal handling auth (WorkOS), org/account lifecycle, instance orchestration via ECS desired-count management
- Ship a self-hostable CDK template for single-account deployments (no control plane required)
- Document cold-start strategy: TTL-based warm instances, scale-to-zero via Lambda/Step Function watching last-active timestamps

## Capabilities

### New Capabilities
- `ecs-starter-stack`: CDK stack definition for single-tenant Fargate deployment with EBS Postgres and S3
- `ecs-control-plane`: Lightweight orchestration service for multi-org account lifecycle and instance warm/cold management
- `cdk-tier-strategy`: Pattern for tier-based stack composition (Starter/Pro/Enterprise) with no conditional logic within shared stacks

### Modified Capabilities

None — this is additive infrastructure; existing Docker Compose dev path is unchanged.

## Impact

- New `infra/` directory with CDK app and stack definitions
- `docker-compose.yml` — unchanged (dev path stays as-is)
- S3 replaces MinIO in production (app already reads `settings.storage_type`; no application code changes needed)
- `DATABASE_URL` env var already abstracts the database backend
