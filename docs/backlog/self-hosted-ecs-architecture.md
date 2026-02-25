# Self-Hosted ECS Architecture

## Concept

Shift from multi-tenant SaaS to single-tenant isolated instances. Each customer org gets its own AWS account (via Control Tower) running a full stack as an ECS Fargate task. Users log into a web portal (control plane), select a project, and the backend initializes from cold or hits a warm instance.

## Architecture Overview

- **Control plane**: Web portal handling auth (WorkOS), org/account lifecycle, instance orchestration, billing
- **Data plane**: One ECS Fargate task per project, running the full stack in isolation
- **Account mapping**: WorkOS Org -> AWS Account (via Control Tower landing zone)
- **Routing**: API Gateway + VPC Link per org account (replaces container-based proxy)
- **Auth at edge**: Lambda authorizer validates WorkOS session before traffic hits the instance

## Starter Stack (First Priority)

ECS Fargate task with 2 containers:

| Container | Role |
|-----------|------|
| `api` | FastAPI backend |
| `worker` | Hono transform worker |

Infrastructure:
- **Database**: Containerized Postgres + EBS gp3 volume (2-10x cheaper than Aurora at small scale)
- **Object storage**: S3 Standard (not MinIO -- cheaper, zero-ops, 11-nines durability)
- **Proxy**: API Gateway + VPC Link (no container needed)
- **Observability**: Container Insights Enhanced + OAM cross-account link + PGCM Lambda

Estimated cost per org:
- Idle: ~$2/mo (EBS volume + S3)
- Light usage (2h/day): ~$35/mo (compute + storage + observability)

## CDK Strategy Pattern

Use tier to select the entire stack class, not conditional logic within a shared stack. Changes to one tier cannot impact another.

```
bin/app.ts -> StarterStack | ProStack | EnterpriseStack
```

Shared tier-agnostic constructs (NetworkConstruct, ObservabilityConstruct, ComputeConstruct) are composed differently per stack. Tier-specific constructs (EbsPostgresConstruct, AuroraConstruct) are only referenced by their respective stack.

## Tier Roadmap

| | Starter | Pro | Enterprise |
|---|---------|-----|------------|
| Database | Postgres container + EBS | Aurora Serverless v2 | Aurora Multi-AZ + readers |
| Storage | S3 Standard | S3 Standard | S3 + CloudFront |
| Compute | Single Fargate task | Single Fargate task | ECS Service w/ autoscaling |
| Promotion | -- | pg_dump -> S3 -> Aurora restore | Aurora scaling configs |

Promotion between tiers is a deploy (`cdk deploy` with different stack class), not an application code change. The app uses `DATABASE_URL` env var regardless of backing implementation.

## Key Decisions from Research

- **S3 over MinIO**: MinIO on EBS costs 8-12x more, adds operational burden, weaker durability. Latency difference (~20-30ms TTFB) is irrelevant for batch parquet workloads.
- **EBS over EFS for Postgres**: EFS has high latency for fsync-heavy workloads. EBS gp3 gives 3,000 baseline IOPS free.
- **Aurora scale-to-zero**: As of Nov 2024, Aurora Serverless v2 supports 0 ACU with ~15s cold start. Narrows the idle cost gap but compute is still 2.7x more expensive per hour.
- **Containerized Postgres operational risks**: Single-AZ (EBS), no automatic PITR, must manage backups (pg_dump + EBS snapshots), signal handling (SIGTERM forwarding), image pinning (collation breakage). Manageable at <50 stacks, reconsider at scale.
- **Observability**: ~$25-35/mo per org for full stack monitoring via Container Insights + OAM + PGCM Lambda. All automated via CDK constructs.
- **NAT Gateway warning**: $33/mo always-on. Mitigate with VPC endpoints for AWS services.

## Cold Start Strategy

Hybrid approach: recently active instances stay warm for a TTL (e.g., 30 min), then scale to zero. Control plane tracks last-active timestamps. ECS desired count managed by Lambda/Step Function watching activity.

## Self-Hosting Story

Ship a CDK template. User deploys into their own AWS account:
1. CloudFormation/CDK creates: ECS cluster, EBS volume, API Gateway, task definition
2. Single-instance mode -- no control plane needed
3. All data stays in their account

For multi-project self-hosting, ship a lightweight control plane container.
