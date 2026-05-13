# <!-- DES-ENFORCEMENT : exempt -->
# Loader fanout to auth-proxy stays bounded — frontend-coexistence (Slice 4 / MR-3).
#
# Encodes Praxis review-by-system-designer.md F-2 + §5 fan-out scenario.
# Every SSR'd route causes web-ssr to call auth-proxy once per server
# request via `uiStateClient(request)`. If half the application's routes
# migrate to framework mode, auth-proxy fan-out grows. The application
# architecture does not estimate the growth; Praxis flagged the gap.
# DI-5 encodes the contract: under a 50% framework-mode migration profile
# auth-proxy QPS MUST stay within ≤ 10% above the pre-MR-0 baseline.
#
# DESIGN did not specify a baseline number; DELIVER measures it during
# Slice-4 execution. DISTILL fixes the 10% ceiling.
#
# Strategy: C (real local) per DI-1. The representative request mix is
# DELIVER's choice (e.g., a synthetic workload generator hitting the
# user-visible routes for ~60s and counting auth-proxy log entries).
#
# Driving port: `reverse-proxy` HTTP ingress. The auth-proxy access log
# (or a test-only counter endpoint) is the observation point.

@slice-4 @adr-034 @praxis-F-2 @fan-out-bound @real-io
Feature: Auth-proxy request volume stays within 10% of the pre-MR-0 baseline under a 50% framework-mode migration profile
  As the engineering team validating that SSR'd routes do not drown auth-proxy,
  We want the post-migration auth-proxy QPS to remain within a documented bound,
  So that adding framework-mode routes does not silently create an unintended SPOF
  on shared upstream capacity.

  Background:
    Given the post-MR-3 compose topology is up

  @ten-percent-ceiling
  Scenario: Replaying a representative request mix produces ≤ 10% auth-proxy QPS increase
    Given a baseline `auth-proxy` request rate is measured for the pre-MR-0 topology serving a representative request mix
    And the post-MR-3 topology has 50% of routes migrated to framework mode (each with a `loader` that calls `auth-proxy` once per server request)
    When the same representative request mix is replayed against the post-MR-3 topology
    Then the `auth-proxy` request rate is at most 10% above the pre-MR-0 baseline
    # DESIGN did not specify an exact baseline number; DELIVER measures it during Slice-4
    # execution. The 10% ceiling is the binding contract per Praxis F-2 + DISTILL DI-5.

  @baseline-recorded
  Scenario: The pre-MR-0 baseline auth-proxy QPS is recorded as a Slice-4 artifact
    Given the post-MR-3 topology is up
    When Slice-4's auth-proxy QPS baseline measurement runs
    Then the measured baseline is recorded in `docs/feature/frontend-coexistence/deliver/baseline-metrics.md` or equivalent location
    And the recorded baseline is the reference for future migration-profile-change regression checks
