Feature: An org's Iceberg catalog carries chat-authored datasets as real tables
  As an internal operator (and the data engineer who consumes the result)
  I want each org's catalog, project representation, table schema, and data history carried by a standard Iceberg REST catalog that materializes tables from our Ibis-compiled SQL
  So that I can hand a data engineer real, evolvable Iceberg tables without hand-rolling schema_config JSON and without the catalog ever becoming a render-time authority

  # Scenarios follow the operator/data-engineer loop in
  # journey-lakekeeper-catalog-backend.yaml, in ascending journey-step order:
  # auth (1) -> represent project (2) -> materialize (3) -> PROVE the ADR-026
  # corollary (4) -> hand off / read back (5). The Step-4 determinism scenarios are
  # load-bearing: they encode the one hard invariant the whole scoped BUY rests on.

  Background:
    Given one org's LakeKeeper Server is already provisioned for the tenant
    And the operations of a chat-authored dataset are settled and are the only source of truth

  # --- Step 1: the catalog trusts the same WorkOS IdP the app uses (US-1, SJ-1) ---

  Scenario: A WorkOS token authenticates the catalog and auto-provisions the user
    Given the org's LakeKeeper Server is pointed at the WorkOS AuthKit issuer
    When a valid WorkOS user token is presented to the catalog
    Then the request authenticates successfully
    And a catalog user is auto-provisioned without any user-sync job running

  Scenario: A token from the wrong issuer or audience is rejected without provisioning
    Given the catalog is configured with the WorkOS issuer and expected audience
    When a token whose issuer or audience does not match is presented
    Then the catalog rejects the request with an authentication error
    And no user is provisioned from the unverified token

  # --- Step 2: a dc project is a LakeKeeper Project, behind the existing port (US-2, SJ-2) ---

  Scenario: Creating a dc project represents it as a LakeKeeper Project with a default Warehouse
    When a dc project is created through the existing project repository port
    Then a LakeKeeper Project exists that maps to the dc project
    And it has a default Warehouse located at the project's S3 prefix
    And the routing, controllers, and project use-case logic are unchanged

  # --- Step 3: materialize via DuckDB directly, no dbt (US-3, SJ-3) ---

  Scenario: A dataset is materialized as an Iceberg table with no dbt runtime
    Given the dataset's Ibis-compiled SQL is derived from its persisted operations
    When DuckDB runs "INSERT INTO <iceberg_table> SELECT <ibis-compiled-sql>" against the Warehouse
    Then an Iceberg snapshot commits and a snapshot id is returned
    And no dbt process is invoked at any point in the write path

  # --- Step 4: PROVE the materialized table is a derived cache (US-4, SJ-4) ---
  # These scenarios are the ADR-026 materialization corollary made executable.

  Scenario: Re-deriving from operations reproduces the materialized table
    Given a dataset has been materialized to an Iceberg table
    When the table is re-derived by recompiling the persisted operations and re-running the write
    Then the re-derived table is equivalent to the materialized table
    And the materialized table was never hand-edited or read back as authority

  Scenario: Compilation succeeds and stays deterministic with the catalog offline
    Given a dataset with persisted operations that were materialized to an Iceberg table
    When LakeKeeper is offline and the operations are compiled and then loaded and recompiled
    Then compilation succeeds without contacting the catalog
    And the first compiled SQL equals the recompiled SQL
    And the determinism probe passes with the catalog disconnected

  Scenario: The render path never resolves schema from the live catalog
    When a dataset's SQL is rendered
    Then no column, type, or partition is resolved by querying LakeKeeper
    And any exported Iceberg View is treated as an export sink, never a source read back

  # --- Step 5: hand off — a reader queries the materialized table from the catalog (US-5, SJ-5) ---

  Scenario: A server-side reader queries the materialized Iceberg table
    Given a materialized Iceberg table exists in the catalog
    When a server-side DuckDB Iceberg scan queries the table through the catalog
    Then rows are returned that match the committed snapshot
    And the reader reads the materialized derived cache, not stored SQL

  @stretch
  Scenario: A browser reader queries the materialized table over catalog OAuth
    Given a materialized Iceberg table exists in the catalog
    When DuckDB-WASM in the browser attaches the catalog over OAuth and reads the table via httpfs
    Then the browser returns the same rows as the server-side scan

  # --- Boundary: the authority model is surfaced, not silently chosen (traceability to DESIGN) ---

  Scenario: A failed project-create leaves no silent orphan state
    Given LakeKeeper is an external HTTP service outside the local transaction
    When a dc project create call to LakeKeeper fails or times out
    Then the project use case surfaces a clear failure
    And no orphaned half-created state is silently left behind
    And the exact atomicity and compensation are deferred to the DESIGN authority-model decision
