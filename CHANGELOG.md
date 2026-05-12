# [1.25.0](https://github.com/jzallen/dashboard-chat/compare/v1.24.0...v1.25.0) (2026-05-12)


### Features

* **backend:** extend ReportIbisCompiler for multi-dim multi-measure composition ([f1f3ffa](https://github.com/jzallen/dashboard-chat/commit/f1f3ffa21459aa6c0652b8608665519aa9d0c642))
* **backend:** introduce ReportIbisCompiler for structured report SQL (MR-3) ([6c81978](https://github.com/jzallen/dashboard-chat/commit/6c8197863a531bd2a8f8414a82d9496e37c98645))
* **backend:** reject reports with measures but no dimensions (MR-3) ([ddddca7](https://github.com/jzallen/dashboard-chat/commit/ddddca7ce2bfa58b2bd1c1804f95790273341708))

# [1.24.0](https://github.com/jzallen/dashboard-chat/compare/v1.23.1...v1.24.0) (2026-05-12)


### Features

* **flow-state,backend:** slice 1 error paths + /api/auth/reissue endpoint ([4762079](https://github.com/jzallen/dashboard-chat/commit/4762079ca1c020bbbcf6259eb3ee58716490b137))
* **flow-state:** slice 1 scope-resolver endpoint + acceptance steps ([1dacc38](https://github.com/jzallen/dashboard-chat/commit/1dacc38548e6f7400253ccb3ab3c5e4141c025fd))
* **flow-state:** walking skeleton end-to-end sign-in to authenticated_no_org ([b523cd1](https://github.com/jzallen/dashboard-chat/commit/b523cd16d5350456d4eb51e2a9c12c2d1f7182e0))

## [1.23.1](https://github.com/jzallen/dashboard-chat/compare/v1.23.0...v1.23.1) (2026-05-11)


### Bug Fixes

* **frontend)+docs(ssot:** route chat agent through nginx proxy; bootstrap SSOT for user-flow-state-machines ([4f2cbfc](https://github.com/jzallen/dashboard-chat/commit/4f2cbfc87b8b9284de1b2a86258636a955a15b13))

# [1.23.0](https://github.com/jzallen/dashboard-chat/compare/v1.22.0...v1.23.0) (2026-05-11)


### Features

* **backend/models:** ViewFilter as Pydantic discriminated union (ADR-026 MR-1) ([fdc8e1e](https://github.com/jzallen/dashboard-chat/commit/fdc8e1e0f696a47c327e7b17a3eb1aa23d5320f8))
* **backend/use_cases/view:** ViewIbisCompiler replaces ViewSQLGenerator (ADR-026 MR-1) ([21fda79](https://github.com/jzallen/dashboard-chat/commit/21fda79a23c6c4d3547fa5d937d476b594048f1c))
* **distill:** milestone-2 report-ibis-compiler scenarios + roadmap.json ([0ef1c21](https://github.com/jzallen/dashboard-chat/commit/0ef1c2110f3ddf64f4e6fec91b64304e8ba9ec04))
* **distill:** unpend walking-skeleton + milestone-1 scenarios (ADR-026 MR-1) ([49981a2](https://github.com/jzallen/dashboard-chat/commit/49981a2dc9cede19056a891d819bd1d448435012))
* **distill:** walking-skeleton + milestone-1 view-ibis-compiler scenarios ([bd1056a](https://github.com/jzallen/dashboard-chat/commit/bd1056a12e64b9067bcf669610f429f1027fc1c3))
* **tests/acceptance/ibis-as-only-sql-compiler:** scaffold suite + step glue for milestone-1 (ADR-026 MR-1) ([b0e9567](https://github.com/jzallen/dashboard-chat/commit/b0e9567ed45c593ac9141ba884ba63b5c0750900))
* **tests/integration/chat_protocol:** port M4 protocol invariants out of dbt-test-validation (ADR-024 Phase 2) ([607198e](https://github.com/jzallen/dashboard-chat/commit/607198e7bb7c15fb1e845989d347c1f8e85d2598))
* **tests/unit:** port retry semantics out of dbt-test-validation (ADR-024 Phase 3) ([1fa2950](https://github.com/jzallen/dashboard-chat/commit/1fa295079683e8d4155530d097a1a17f6f0b0d20))

# [1.22.0](https://github.com/jzallen/dashboard-chat/compare/v1.21.0...v1.22.0) (2026-05-11)


### Features

* **tests/acceptance/dbt-test-validation-v2:** customer fidelity + M5.1 env-var rejection ([f099fcb](https://github.com/jzallen/dashboard-chat/commit/f099fcb17d2e955331be1cfea263d25e57e618c5))
* **tests/acceptance/dbt-test-validation-v2:** M1.1 happy path + M1.2 drift detector ([bad5e77](https://github.com/jzallen/dashboard-chat/commit/bad5e7741f5861858c54aaa1319a854f2bc6ef30))
* **tests/acceptance/dbt-test-validation-v2:** scaffold suite + walking skeleton ([b2a44ea](https://github.com/jzallen/dashboard-chat/commit/b2a44ea74307746ad70a91485b31b366625c0613))

# [1.21.0](https://github.com/jzallen/dashboard-chat/compare/v1.20.0...v1.21.0) (2026-05-11)


### Features

* **backend/_dbt:** emit s3_use_ssl env_var in exported profiles.yml ([ad0861b](https://github.com/jzallen/dashboard-chat/commit/ad0861bc995f0aaa8b5ce731f174695dc1ac4cfc))
* **repositories/metadata:** introduce ProjectsWithDatasetsQuery (ADR-025) ([591617f](https://github.com/jzallen/dashboard-chat/commit/591617f7e3a2c3ee42109aa17a6892791756d716))

# [1.20.0](https://github.com/jzallen/dashboard-chat/compare/v1.19.0...v1.20.0) (2026-05-11)


### Features

* **backend:** introduce UploadPluginDispatcher and relax MultiProcessingResult validator ([95e09b5](https://github.com/jzallen/dashboard-chat/commit/95e09b5ee339672df3f9d3988771ac9236a1016e))
* **test/dataset-layer:** chat_turn raises StructuredRetryExhaustion on retry-budget exhaustion ([5f931f1](https://github.com/jzallen/dashboard-chat/commit/5f931f1abd00e3864a531df6049aff995c3d8117))
* **test/eject:** seeder rejects unknown env_var refs in exported profiles.yml ([5f8d02a](https://github.com/jzallen/dashboard-chat/commit/5f8d02a9dbfbacc604ead04ae65fd1cd778d3aa5))

# [1.19.0](https://github.com/jzallen/dashboard-chat/compare/v1.18.0...v1.19.0) (2026-05-10)


### Bug Fixes

* **backend/eject:** parser ignores test/hook records inside dbt build phase ([c8ae682](https://github.com/jzallen/dashboard-chat/commit/c8ae682b3c3b0e1253e391d319feeaf20b886c1d))
* **eject:** also filter dbt hooks out of test phase + align acceptance loop scope ([215101e](https://github.com/jzallen/dashboard-chat/commit/215101e2c9ec1862b2f089b1ffa59e4d253156a7))
* **test/dbt-test-validation:** sort imports per ruff I001 ([54fa4f1](https://github.com/jzallen/dashboard-chat/commit/54fa4f16d55a4388c76e61b348830dc89d4ceba5))


### Features

* **backend/dbt-export:** emit constraint-driven dbt tests + packages.yml ([858a33e](https://github.com/jzallen/dashboard-chat/commit/858a33e9017f6db37db7765ab01c8822381f07c7))
* **backend/eject:** name failing dbt test in EjectTestReport for drift detector ([f497b69](https://github.com/jzallen/dashboard-chat/commit/f497b69aaf30147a561245ee7de2b03dde0f2a6e))
* **backend/eject:** seeded profile mirrors backend MinIO config ([ce6c0cf](https://github.com/jzallen/dashboard-chat/commit/ce6c0cf8a65b9d728279bed1a6f5794840c988fa))
* **test/dataset-layer:** chat_turn validate_with hook engages AC1.5 rephrase on Pandera failure ([623dc81](https://github.com/jzallen/dashboard-chat/commit/623dc8165337bc179f7807636f0e09c492675ec8))
* **test/dbt-test-validation:** unpend M2 validate-after scenarios with stateful Pandera fixture ([01900dd](https://github.com/jzallen/dashboard-chat/commit/01900dd3c694abf0dd7615044c594f8ce9c7e2b9))
* **test/dbt-test-validation:** unpend M4 protocol invariant scenarios ([3c5bbd6](https://github.com/jzallen/dashboard-chat/commit/3c5bbd68c4012a1a61c2b599db7c8a346a1db78c))
* **test/validation:** add timing-budget guard + tighten OrdersStaging quantity range ([ea84b60](https://github.com/jzallen/dashboard-chat/commit/ea84b60672df4e9c7a83d781eabc2b7701260378))
* **tools:** include ruff check + format in --backend gate ([a6e4bd0](https://github.com/jzallen/dashboard-chat/commit/a6e4bd077b965da1fd4d98f585ac51f7721cda53))

# [1.18.0](https://github.com/jzallen/dashboard-chat/compare/v1.17.1...v1.18.0) (2026-05-10)


### Features

* **tools:** add tools/test dispatcher script ([946d538](https://github.com/jzallen/dashboard-chat/commit/946d53874e4194408e03fa16842f0755f248e961))
* **tools:** expose //:test alias for tools/test ([b91d3f6](https://github.com/jzallen/dashboard-chat/commit/b91d3f6c1a943be7c2a9938a4dc94801e8d20852))

## [1.17.1](https://github.com/jzallen/dashboard-chat/compare/v1.17.0...v1.17.1) (2026-05-10)


### Bug Fixes

* **backend/tests:** align _FakeConnection with copy_from_query path ([72d8350](https://github.com/jzallen/dashboard-chat/commit/72d8350771de5a13c6127c88bf678292e310ee28))
* **backend:** pin pyarrow-hotfix for ibis-duckdb backend ([f1489ae](https://github.com/jzallen/dashboard-chat/commit/f1489ae2509c7c3934986e8a995616c44557c2e7))

# [1.17.0](https://github.com/jzallen/dashboard-chat/compare/v1.16.0...v1.17.0) (2026-05-09)


### Features

* **test/dbt-test-validation:** add behavioral CI gold-test for Earned-Trust contract ([f4018c7](https://github.com/jzallen/dashboard-chat/commit/f4018c729fcab9719b36d38f17fbb446e9360fc2)), closes [#2](https://github.com/jzallen/dashboard-chat/issues/2)
* **test/dbt-test-validation:** unpend M3 probe-1 scenario with named-skip glue ([93f025a](https://github.com/jzallen/dashboard-chat/commit/93f025a408fb0dec8870ce99664b4db8d0a138d2))
* **test/dbt-test-validation:** unpend M3 probe-2 scenario via dbt-duckdb monkeypatch ([906249a](https://github.com/jzallen/dashboard-chat/commit/906249aa93a0408603c8ddd088370e810ab5e04c))
* **test/dbt-test-validation:** unpend M3 probe-3 scenario via unreachable base URL ([89119c8](https://github.com/jzallen/dashboard-chat/commit/89119c8503679f3c2748ffb37d533f7f2c41138d))
* **test/dbt-test-validation:** unpend M3 probe-4 scenario via invalid MinIO creds ([2e1c077](https://github.com/jzallen/dashboard-chat/commit/2e1c07704b12acd51dc62dbaf9512f7d936661c5))
* **test/dbt-test-validation:** unpend M3 probe-5 scenario via dbtRunner shape drift ([41cf915](https://github.com/jzallen/dashboard-chat/commit/41cf915500b57c21b5da9200aa4188a757268f78))

# [1.16.0](https://github.com/jzallen/dashboard-chat/compare/v1.15.0...v1.16.0) (2026-05-09)


### Bug Fixes

* **test/eject:** nest dbt-duckdb s3 settings under profile settings block ([5f84c2d](https://github.com/jzallen/dashboard-chat/commit/5f84c2d42027a53336fd36f9128712652036cf1e))
* **test/eject:** separate substrate exceptions from test-failure outcomes in runner ([37bdd8c](https://github.com/jzallen/dashboard-chat/commit/37bdd8c1f5147244d59e15f6b83cd8505f255cf4))


### Features

* **backend:** export staging models with at least one runnable dbt test ([50e55be](https://github.com/jzallen/dashboard-chat/commit/50e55be29140abdd749e1af161ba8b103b87ab3d))

# [1.15.0](https://github.com/jzallen/dashboard-chat/compare/v1.14.0...v1.15.0) (2026-05-09)


### Bug Fixes

* **backend:** map DomainException to structured HTTP response globally ([155f697](https://github.com/jzallen/dashboard-chat/commit/155f697cc72598f39d57613e44d0f7b62ce82e28))
* **dataset-layer:** apply transforms to preview + stable compose ports ([4dd9ee2](https://github.com/jzallen/dashboard-chat/commit/4dd9ee20f0ade018589d5cf81dae6aff493a2576))
* **test/dbt-test-validation:** wire acceptance venv to backend test deps ([62529be](https://github.com/jzallen/dashboard-chat/commit/62529be7c6327e7b58688b464b5410d0752cde2f))
* **test/eject:** export S3_* env vars before dbtRunner.invoke ([dac4c1a](https://github.com/jzallen/dashboard-chat/commit/dac4c1a7e989a1ea49ff1c98663ec1f6298c8995))
* **test/eject:** pass exported dbt profile name through to seeder ([b227a98](https://github.com/jzallen/dashboard-chat/commit/b227a986fb64b445c092597ba31359001f58c18e))
* **test/eject:** probe_export_endpoint_reachable accepts 200 OR 404 ([b348c59](https://github.com/jzallen/dashboard-chat/commit/b348c5900b45dde5558dc54d70ef0a740bddc4be))
* **test/eject:** wire dev JWT auth and MinIO bootstrap into probes ([961dd0a](https://github.com/jzallen/dashboard-chat/commit/961dd0a7b6adbdc2b5a383f06cb032f75152fd81))


### Features

* **test/dataset-layer:** wire harness eject_and_test and validate_after ([81ef97a](https://github.com/jzallen/dashboard-chat/commit/81ef97a47f07a5ad05bf0f09b63a372d1e65d2a4))
* **test/dbt-test-validation:** implement walking-skeleton step bindings ([c896830](https://github.com/jzallen/dashboard-chat/commit/c89683077ae88fb11a49b523e47ece0bbcd676df))
* **test/eject:** implement DbtRunner via dbt.cli.main.dbtRunner Python API ([b71b690](https://github.com/jzallen/dashboard-chat/commit/b71b690ee4a9ec1cadfd59140a4a3f532db48ce5))
* **test/eject:** implement DuckDBProfileSeeder writing concrete profiles.yml ([25c71ed](https://github.com/jzallen/dashboard-chat/commit/25c71ed2a2df0487268720c39e33e9580e86d593))
* **test/eject:** implement EjectAndTestOrchestrator composing all probes ([de36d37](https://github.com/jzallen/dashboard-chat/commit/de36d374e0ac86da298e9dffb84a9c470bab5ee1))
* **test/eject:** implement five probe happy paths for dbt-test-validation ([7454572](https://github.com/jzallen/dashboard-chat/commit/7454572d8378e00f57c8bc547715f3a9ef839bea))
* **test/eject:** implement RunResultsParser translating dbtRunnerResult ([eff07f7](https://github.com/jzallen/dashboard-chat/commit/eff07f7e5b702e035b7d2b1169962523ab323a97))
* **test/validation:** implement PanderaValidator and OrdersStaging schema ([01dd6a2](https://github.com/jzallen/dashboard-chat/commit/01dd6a21f0bd42bf7d3f2105bcf2d20a6b2227da))
* **test:** add dbt + pandera test extras for dbt-test-validation Phase 0 ([ab6b6ac](https://github.com/jzallen/dashboard-chat/commit/ab6b6acbe8ef83f0dc2d72886b871a2e13ff30ae))

# [1.14.0](https://github.com/jzallen/dashboard-chat/compare/v1.13.0...v1.14.0) (2026-05-07)


### Bug Fixes

* **compose:** hardcode container-internal URLs (dc-u43) ([d196383](https://github.com/jzallen/dashboard-chat/commit/d1963836d991735bd25ece5dcffb5af19c9c5b68))


### Features

* **backend:** expose dataset row_count on GET response (dc-v5u) ([4e3f785](https://github.com/jzallen/dashboard-chat/commit/4e3f785b4ca0d1e3cfe8deceff9a416c27874e0a))

# [1.13.0](https://github.com/jzallen/dashboard-chat/compare/v1.12.0...v1.13.0) (2026-05-07)


### Bug Fixes

* **agent:** wire AUTH_PROXY_URL through to chat tool dispatchers (dc-88k) ([ac1b885](https://github.com/jzallen/dashboard-chat/commit/ac1b88574e087639243273799c6008e7c966d443))
* auto-save uncommitted implementation work (dc-1k8.1, gt-pvx safety net) ([cf5556b](https://github.com/jzallen/dashboard-chat/commit/cf5556bdf89d6e8a095642810ec9830ecbee5ef4))
* auto-save uncommitted implementation work (dc-dh1, gt-pvx safety net) ([25ea441](https://github.com/jzallen/dashboard-chat/commit/25ea4412913b914a6bff53ad469725cea548d38e))
* auto-save uncommitted implementation work (dc-qj9.1.1, gt-pvx safety net) ([2ab725a](https://github.com/jzallen/dashboard-chat/commit/2ab725aa189438d15550cc931df789903af69cd6))
* **bazel:** share conftest via py_library to avoid duplicate-action precompile ([8c29b67](https://github.com/jzallen/dashboard-chat/commit/8c29b67c09d479abfbacad5487753518ef28695d))


### Features

* **agent:** emit OpenAPI 3.1 spec via zod-openapi (dc-qj9.3.7) ([a5d98bd](https://github.com/jzallen/dashboard-chat/commit/a5d98bddfc67cb5d7d3fad6c9f092fe5ebc3aee0))
* **agent:** GROQ_TEMPERATURE env override, default 0.3 (dc-e8i) ([3e024c5](https://github.com/jzallen/dashboard-chat/commit/3e024c55dff2bb4c39a422c166e809b8d3a1aaaf))
* **agent:** Redis-backed PresentationStateLog for multi-replica deployments (dc-qj9.1.3) ([a0f90d8](https://github.com/jzallen/dashboard-chat/commit/a0f90d8301f8123d35a30d84d9f274fb8afca626)), closes [#5](https://github.com/jzallen/dashboard-chat/issues/5)
* **auth-proxy:** emit OpenAPI 3.x spec via zod-to-openapi (dc-qj9.3.6) ([a011a28](https://github.com/jzallen/dashboard-chat/commit/a011a2857d67da0b1622d3534cd7ecfa09ee9935))
* **auth-proxy:** persist RS256 keypair across restarts (dc-0r0) ([f7fa379](https://github.com/jzallen/dashboard-chat/commit/f7fa3791bc149454a257fc30063ca90216b407ed))
* **auth-proxy:** pluggable SecretsProvider for keypair persistence (dc-qj9.1.1) ([423f97d](https://github.com/jzallen/dashboard-chat/commit/423f97d7cd199337d9697b1735c5b6b01c2f464b))
* **backend:** warn once when SessionEventReader noop default is in use (dc-c7l) ([9431747](https://github.com/jzallen/dashboard-chat/commit/9431747f5ae30654813cc8501bad8464e11febf1))
* **chat:** codegen DOMAIN_EVENT_TYPES from Zod schema (dc-qj9.3.1) ([f97dd6c](https://github.com/jzallen/dashboard-chat/commit/f97dd6c6027d58a77e6569a352bd2b7a6cb5911d)), closes [#3](https://github.com/jzallen/dashboard-chat/issues/3) [#1](https://github.com/jzallen/dashboard-chat/issues/1)
* **chat:** migrate agent SSE pipeline from AI SDK v4 to v6 (dc-p1z) ([a1d8c07](https://github.com/jzallen/dashboard-chat/commit/a1d8c07f6ff6155d550ac06e1892cf579350f316))
* **replay:** Redis-default + Stream.io-optional SessionEventReader (dc-qj9.1.2) ([0a7fa91](https://github.com/jzallen/dashboard-chat/commit/0a7fa912b1337b14828930d3bba3e2b6fcc97bfa))
* **sdk:** Client wrapper, smoke test, unit tests for FastAPI surface (dc-qj9.3.2) ([4175aca](https://github.com/jzallen/dashboard-chat/commit/4175aca2f50562cf2db6adf4d40f622a36cdc0a8))
* **sdk:** scaffold dashboard_chat_sdk + FastAPI codegen pipeline (dc-qj9.3.2) ([6584e5e](https://github.com/jzallen/dashboard-chat/commit/6584e5e2613c1e1dccca8d1a0bb5094466f33f5d))
* **test:** enable dc-1k8 milestone-1 identity acceptance scenarios (dc-1k8.2) ([39611d5](https://github.com/jzallen/dashboard-chat/commit/39611d548c1083e227b7d32bf06acf7551959545))
* **test:** full DatasetLayerHarness + demo workload (dc-qj9.2.1) ([147e3ce](https://github.com/jzallen/dashboard-chat/commit/147e3ceb170ae18a6ec3792ed7d5ebbb3a1ac7d8))
* **test:** replay + idempotency end-to-end test (dc-qj9.2.2) ([fece695](https://github.com/jzallen/dashboard-chat/commit/fece695e5c69a1dc3f9e55d35b5d30714425893c))

# [1.12.0](https://github.com/jzallen/dashboard-chat/compare/v1.11.0...v1.12.0) (2026-04-29)


### Features

* **auth-proxy:** dev-mode parity for PAT issuer + partner how-to (dc-d97.1.2) ([f9b0f3d](https://github.com/jzallen/dashboard-chat/commit/f9b0f3dc78113644e17fc013b2af01fd44555d1a))
* **auth-proxy:** user-bound PAT issuance with immediate revocation (dc-d97.1.1) ([ebc168c](https://github.com/jzallen/dashboard-chat/commit/ebc168cbecc00aeae7578253cb272f0ed59b6d16))

# [1.11.0](https://github.com/jzallen/dashboard-chat/compare/v1.10.0...v1.11.0) (2026-04-29)


### Features

* **agent:** reflect-only presentation-state directive log + GET endpoint (dc-x3y.2.2) ([a1c9073](https://github.com/jzallen/dashboard-chat/commit/a1c9073e6dc81a552a0b14074506a7c1bb609d94))
* **auth-proxy:** dev-mode M2M parity with built-in synthetic client (dc-x3y.1.2) ([f9aec20](https://github.com/jzallen/dashboard-chat/commit/f9aec2074ffe8e70395a4ccfe3653fc57e0a911e))
* **backend:** GET /api/sessions/{id}/events replay endpoint (dc-x3y.3.2) ([9534189](https://github.com/jzallen/dashboard-chat/commit/95341891c93c3214ea6ef2a3f227b67909242d32))

# [1.10.0](https://github.com/jzallen/dashboard-chat/compare/v1.9.0...v1.10.0) (2026-04-29)


### Bug Fixes

* **agent:** skip turn_done emission when finishReason='request' (resolve_dataset pause) ([01d967d](https://github.com/jzallen/dashboard-chat/commit/01d967df92cb6fadf18703c08eaaac9a38cdf439))
* auto-save uncommitted implementation work (dc-99b, gt-pvx safety net) ([fc8ec6b](https://github.com/jzallen/dashboard-chat/commit/fc8ec6bcbb19bf426d6cad86f8fe827280cf6cd6))


### Features

* **agent:** persist domain events to Stream.io thread before turn_done (dc-x3y.3.1) ([807b71f](https://github.com/jzallen/dashboard-chat/commit/807b71f686646b205b5f74c95a5a09f72c41cb1f))
* **auth-proxy:** M2M client_credentials issuer (dc-x3y.1.1) ([3a81b01](https://github.com/jzallen/dashboard-chat/commit/3a81b01ef4d6ede7932bb1e5778aa9efed48cecc))
* **backend:** idempotency-key support on transforms mutation endpoints (dc-x3y.3.3) ([d8cdad6](https://github.com/jzallen/dashboard-chat/commit/d8cdad63ba418db2b1038b7e403c99876e991fd5))

# [1.9.0](https://github.com/jzallen/dashboard-chat/compare/v1.8.0...v1.9.0) (2026-04-29)


### Bug Fixes

* **ci:** unblock Bazel hermetic test failures (dc-bj2.1) ([4f128c1](https://github.com/jzallen/dashboard-chat/commit/4f128c1c2300c5db38caf6662c9122a4ceeabe85))


### Features

* **chat:** PR 0 scaffolding for worker-tool-dispatch-refactor (dc-8v9) ([074627a](https://github.com/jzallen/dashboard-chat/commit/074627adde96f6c5784978b06231500314ca0b3c))
* **chat:** PR 1 — migrate cleaning tools to worker dispatch (dc-67t) ([0510f52](https://github.com/jzallen/dashboard-chat/commit/0510f52695b6ed83bf9631925acc6633425de0da))
* **chat:** PR 2 — migrate row + column mutations to worker dispatch (dc-xrt) ([c9c40fd](https://github.com/jzallen/dashboard-chat/commit/c9c40fde66a4313b42eb1b7b186d53acc22d030e))
* **chat:** PR 3 — UI directives migrated; legacy executor deleted (dc-dab) ([0a19079](https://github.com/jzallen/dashboard-chat/commit/0a1907952d9fb63b3e53523cefcd78c27029096c))

# [1.8.0](https://github.com/jzallen/dashboard-chat/compare/v1.7.2...v1.8.0) (2026-04-26)


### Bug Fixes

* auto-save uncommitted implementation work (gt-pvx safety net) ([3f342fc](https://github.com/jzallen/dashboard-chat/commit/3f342fc642df43d82493fb0fe055948ce190303d))
* **backend:** disable asyncpg statement cache on query-engine pool (dc-dex) ([330c73c](https://github.com/jzallen/dashboard-chat/commit/330c73cac4df2361424668031cbd3705016e1c5f))
* **backend:** wrap pg_duckdb multi-column reads in to_json for asyncpg (dc-f8m) ([1f2addb](https://github.com/jzallen/dashboard-chat/commit/1f2addb5fde9770e07a48ec16a9fce13c0d8bc78))
* **bazel:** include app/version.py in core py_library (dc-1k8 follow-up) ([d03c39c](https://github.com/jzallen/dashboard-chat/commit/d03c39cf2e3bdcd11fab6870a29aad4f32eb5be7))


### Features

* **bazel:** log image identity on container startup (dc-1k8) ([4abaa93](https://github.com/jzallen/dashboard-chat/commit/4abaa93391f83cf3a4b640701f1630338da60dda))

## [1.7.2](https://github.com/jzallen/dashboard-chat/compare/v1.7.1...v1.7.2) (2026-04-26)


### Bug Fixes

* **backend:** install MinIO persistent secret on query-engine pool init (dc-6gg) ([7ec9fa5](https://github.com/jzallen/dashboard-chat/commit/7ec9fa51b113a4cc02dfde355dab6aab4965449e))
* **bazel:** include app/infra in core py_library (dc-6gg follow-up) ([cc04712](https://github.com/jzallen/dashboard-chat/commit/cc04712c3d91fd27198dd78f845e02e278ecbb2e))

## [1.7.1](https://github.com/jzallen/dashboard-chat/compare/v1.7.0...v1.7.1) (2026-04-25)


### Bug Fixes

* **backend:** clean up ruff violations blocking pre-commit ([41de3ca](https://github.com/jzallen/dashboard-chat/commit/41de3cac4d5429122f70c983fc9909b192705c20))

# [1.7.0](https://github.com/jzallen/dashboard-chat/compare/v1.6.1...v1.7.0) (2026-04-22)


### Features

* **agent:** add report context tools, prompt, and routing ([e494fd8](https://github.com/jzallen/dashboard-chat/commit/e494fd888e52d97a93f5a008de0cebfd15b7a2fe))
* **frontend:** add report tool executor and widen context union ([059fba3](https://github.com/jzallen/dashboard-chat/commit/059fba3cd99ac1b8555c083ec2e2a045d340993d))
* **frontend:** add ReportDetailView and wire /report/:reportId route ([312c8aa](https://github.com/jzallen/dashboard-chat/commit/312c8aaab08fd0bf9bd2974f3cea3dd007e75780))

## [1.6.1](https://github.com/jzallen/dashboard-chat/compare/v1.6.0...v1.6.1) (2026-04-08)


### Bug Fixes

* **devcontainer:** pull latest from origin main in postcreate setup ([96de72a](https://github.com/jzallen/dashboard-chat/commit/96de72ad50a0c03d5eddbe164698e49bf9d72da0))

# [1.6.0](https://github.com/jzallen/dashboard-chat/compare/v1.5.0...v1.6.0) (2026-04-02)


### Features

* **sql-access:** replace per-project containers with shared query engine ([47d491e](https://github.com/jzallen/dashboard-chat/commit/47d491e87140a8e09553490273e7129054917c5b))

# [1.5.0](https://github.com/jzallen/dashboard-chat/compare/v1.4.2...v1.5.0) (2026-04-02)


### Bug Fixes

* resolve test failures in agent and frontend suites ([55d7ac8](https://github.com/jzallen/dashboard-chat/commit/55d7ac87f10daa35a7391fcbe219d6c38b0450cf))


### Features

* add sessions-as-threads with project memory and SSE dataset resolution ([2bb1b9a](https://github.com/jzallen/dashboard-chat/commit/2bb1b9a4cb12be8f91ed3d8fd1820a2481f2890b))

## [1.4.2](https://github.com/jzallen/dashboard-chat/compare/v1.4.1...v1.4.2) (2026-04-02)


### Bug Fixes

* **backend:** swap decorator order to [@handle](https://github.com/handle)_returns outer, [@with](https://github.com/with)_repositories inner ([58ca275](https://github.com/jzallen/dashboard-chat/commit/58ca275225b993d1de3f57ea379b360562196992))

## [1.4.1](https://github.com/jzallen/dashboard-chat/compare/v1.4.0...v1.4.1) (2026-04-01)


### Bug Fixes

* pin axios to 1.13.6 to mitigate supply-chain attack ([35a5be4](https://github.com/jzallen/dashboard-chat/commit/35a5be43b07d12222293c3ebf2a0c8a8f395b2fe))

# [1.4.0](https://github.com/jzallen/dashboard-chat/compare/v1.3.1...v1.4.0) (2026-03-31)


### Features

* **openspec:** add query-engine change proposal ([9ead1f1](https://github.com/jzallen/dashboard-chat/commit/9ead1f195342a20462ad1d437520ffc6b1cd36d6))

## [1.3.1](https://github.com/jzallen/dashboard-chat/compare/v1.3.0...v1.3.1) (2026-03-30)


### Bug Fixes

* resolve auth loop, agent 502, upload flow, and dataset preview ([61b7333](https://github.com/jzallen/dashboard-chat/commit/61b733307a21d8f96a3c32df088adcba540a10ff))

# [1.3.0](https://github.com/jzallen/dashboard-chat/compare/v1.2.0...v1.3.0) (2026-03-21)


### Features

* **planner:** add ui-layout-planner service with multi-agent pipeline ([07e5e3e](https://github.com/jzallen/dashboard-chat/commit/07e5e3e6ca4da218ec4297be4b10ffb27048b318))

# [1.2.0](https://github.com/jzallen/dashboard-chat/compare/v1.1.0...v1.2.0) (2026-03-20)


### Features

* **agent:** rename worker service to agent, adopt Vercel AI SDK ([9298e9b](https://github.com/jzallen/dashboard-chat/commit/9298e9bc832f0a43265d7f28efbd50e4299b2eeb))
* **view:** view-layer chat-first UI with structured view columns ([6301e65](https://github.com/jzallen/dashboard-chat/commit/6301e65bde1c138e12331f250a359f1f5bd753ab))

# [1.1.0](https://github.com/jzallen/dashboard-chat/compare/v1.0.0...v1.1.0) (2026-03-18)


### Features

* **backend:** add SQL injection guardrails across DuckDB query paths ([c085ab7](https://github.com/jzallen/dashboard-chat/commit/c085ab743a5061d96db3ab6332e93bd7ef9b0787))

# [1.0.0](https://github.com/jzallen/dashboard-chat/compare/v0.0.1...v1.0.0) (2026-03-18)


### Bug Fixes

* address code review findings — auth hardening, authz checks, dead code removal, and org support ([2896d27](https://github.com/jzallen/dashboard-chat/commit/2896d278b11d9a6527b7c96548d6988cf98c39fa))
* align Bazel targets with Stream.io integration changes ([1efccd0](https://github.com/jzallen/dashboard-chat/commit/1efccd0525bfcbb48bb152a6f53096e0ccb55e41))
* **backend:** extract cursor helpers to utils, fix polymorphic return and add validation ([f18b76c](https://github.com/jzallen/dashboard-chat/commit/f18b76c408020ba10888a99ce53835f0ddeca278))
* **backend:** make AccessRecordView and AccessRecordWithHash explicit re-exports ([c66a53d](https://github.com/jzallen/dashboard-chat/commit/c66a53d1c27cab3f8e2e692b0be88d2f89c74575))
* **backend:** resolve lint warnings in View entity code ([d07ed6a](https://github.com/jzallen/dashboard-chat/commit/d07ed6a26363b3fbcf306a25b76be9f865017477))
* **backend:** resolve ruff lint warnings in http controller and tests ([1ec906e](https://github.com/jzallen/dashboard-chat/commit/1ec906eaa70d0f3374a204fd306d85ee9d60d4e0))
* **backend:** resolve ruff lint warnings in plugin code ([69be708](https://github.com/jzallen/dashboard-chat/commit/69be7086d2c29c39476261e71a4478b53fa51748))
* **backend:** resolve ruff lint warnings in plugin code and tests ([fb6fd14](https://github.com/jzallen/dashboard-chat/commit/fb6fd143b68b9d9e0df27ef20937414a1824c0e2))
* **backend:** resolve ruff lint warnings in report code ([e4aa363](https://github.com/jzallen/dashboard-chat/commit/e4aa363f9279ab9931695ad4dd90d877a4ea00c4))
* **backend:** resolve ruff SIM108 lint warning in jsonapi pagination links ([5af449c](https://github.com/jzallen/dashboard-chat/commit/5af449cf4edc060b35adb32b8273a2308da907b2))
* **frontend:** fix Bazel test resolution for stream-chat module ([2c37fa4](https://github.com/jzallen/dashboard-chat/commit/2c37fa4876be1676fd8a4162251e3b0709a396c4))
* **frontend:** use compact hash-based channel IDs to stay under Stream Chat 64-char limit ([a339b62](https://github.com/jzallen/dashboard-chat/commit/a339b6262fcdc98a7c43cd6b4460dbb99c002895))
* ignore Bazel symlinks and update lockfile for stream-chat deps ([e678126](https://github.com/jzallen/dashboard-chat/commit/e678126de7c2d28074fb4820d8a1c9d77ad91c53))
* login loop was caused by a wrong JWT issuer URL in both the backend and worker JWT verification ([66b6942](https://github.com/jzallen/dashboard-chat/commit/66b6942c77fba7c485111108fe5d6cefc3ffce35))
* migrate to Bazel OCI images and fix e2e infrastructure ([88ef2e7](https://github.com/jzallen/dashboard-chat/commit/88ef2e7f6d84ae6f00e47e78276e93cb6077f44d))
* resolve all lint failures across Python and TypeScript codebases ([eeed1dc](https://github.com/jzallen/dashboard-chat/commit/eeed1dc04918ec819386a1d2be5560f889e96082))
* resolve auth provisioning, data loading, and transform application issues ([2ddb86f](https://github.com/jzallen/dashboard-chat/commit/2ddb86f32edb1c00be8ecccd214e1dee6e90cb31))
* **sql-access:** resolve 5 ODBC/Excel data-path bugs in pg_duckdb provisioning ([d2f1341](https://github.com/jzallen/dashboard-chat/commit/d2f1341be849d93ee5a493155e48fec3bdff627f))
* **sql-access:** use Status.RUNNING constant instead of string literal ([6ac31dc](https://github.com/jzallen/dashboard-chat/commit/6ac31dcba2b98b7503b5968f9fbb6ef975c2928c))


### Code Refactoring

* rename to Transform terminology and convert to CSS modules ([aed1b3d](https://github.com/jzallen/dashboard-chat/commit/aed1b3d27c0964bf8252813a2dbe8610172a9565))


### Features

* add chat session audit log with turn-by-turn replay viewer ([5ce70d7](https://github.com/jzallen/dashboard-chat/commit/5ce70d7c99702f61b9cb4cc5cab548ea031d0c56))
* add CSV dataset creation via chat panel upload workflow ([9c4e34e](https://github.com/jzallen/dashboard-chat/commit/9c4e34eb2faa333c843f9c417f61335fad063551))
* add data cleaning transforms with chat-driven preview and apply workflow ([ee2f723](https://github.com/jzallen/dashboard-chat/commit/ee2f723c3fb0f313df737c1d112f69190864f750))
* add dbt model layers (Views + Reports) with 4-layer export ([64e65c1](https://github.com/jzallen/dashboard-chat/commit/64e65c11579860633f1023a0505dc6835e340934))
* add dbt project export with SQL escaping, auth retry, and error UX ([7b94d86](https://github.com/jzallen/dashboard-chat/commit/7b94d8654803cde66f3179be85717b8bd9a16e65))
* add dedicated bulk transform endpoints with outbox audit trail ([3c231d1](https://github.com/jzallen/dashboard-chat/commit/3c231d12cab7fae356d96b6fb8ce584ab38e9712))
* add Excel/HL7v2/FHIR plugins, dbt macro integration, format context, and frontend updates ([464b6cf](https://github.com/jzallen/dashboard-chat/commit/464b6cfb57f3d882a1d03b1edbd8f8f92ee9ba8c))
* add external SQL access provisioning with pg_duckdb schema management ([1d0c646](https://github.com/jzallen/dashboard-chat/commit/1d0c64611d019216e29a7e0d54bab51d7acec17c))
* add file format plugin system with CSV, Excel, HL7v2, and FHIR support ([20e1d26](https://github.com/jzallen/dashboard-chat/commit/20e1d260e1a35fce4f993383d05674341ed46a40))
* add filter pipeline persistence with TanStack-to-RAQB translation ([effad6c](https://github.com/jzallen/dashboard-chat/commit/effad6cf5202255bed19fa874d12a454d2a06eff))
* add filter settings UI and server-side pipeline filtering ([5fc2a84](https://github.com/jzallen/dashboard-chat/commit/5fc2a84d4e072286f903257db2076be70d564716))
* add pg_duckdb infrastructure and bootstrap SQL for external SQL access ([b7e1f14](https://github.com/jzallen/dashboard-chat/commit/b7e1f14b759122868d18dcba62b3c67f3d894702))
* add project-based routing, fix upload double-select and rename flicker ([9ed1085](https://github.com/jzallen/dashboard-chat/commit/9ed1085f8be9dbdb29e8423f8f382fbec0a61f1d))
* add project/dataset breadcrumb navigation and nest transform CRUD in dataset updates ([4979d12](https://github.com/jzallen/dashboard-chat/commit/4979d12278923c9c32ab9a340973416fca93eb2d))
* add ProjectView with React Router navigation ([2867371](https://github.com/jzallen/dashboard-chat/commit/2867371928a667e047f9273d2742038dfdeb3421))
* add Report entity and extend dbt export to 4-layer model ([45425be](https://github.com/jzallen/dashboard-chat/commit/45425bedca1935c3d6db48025a9f81cea1bc23bb))
* add snake_case and kebab-case modes, fix title case correctness ([6a284d1](https://github.com/jzallen/dashboard-chat/commit/6a284d19ec94fc4096f7b358eb48b3193a891208))
* add SQL preview tab to transform settings ([1f6714f](https://github.com/jzallen/dashboard-chat/commit/1f6714f80920cca50ffd505cf35be9988f6d950b))
* add token refresh flow with proactive timer, 401 interceptor, and activity check ([148d251](https://github.com/jzallen/dashboard-chat/commit/148d251bd9887a679ae6599fe28bf30f87a0f9ff))
* add WorkOS auth integration with project redirect and login flow ([6d0fdd8](https://github.com/jzallen/dashboard-chat/commit/6d0fdd8cd12738b2d5bc876065453064ae43087a))
* **auth:** harden WorkOS auth with JWT verification, CSRF state, and session revocation ([26b5fe3](https://github.com/jzallen/dashboard-chat/commit/26b5fe3e4d06c7b8ee06552c6f6ecefe835e3d34))
* **backend:** add file format plugin system with registry and CSV plugin ([a6c1c90](https://github.com/jzallen/dashboard-chat/commit/a6c1c90bef560930ec586d28801a6e89e5e24331))
* **backend:** add timeout wrapping for plugin calls and dbt export tests ([a9d575c](https://github.com/jzallen/dashboard-chat/commit/a9d575caacb1624c026bec639292cade3c0d595d))
* **backend:** add two-phase upload validation, formats endpoint test, and integration tests ([aacdde5](https://github.com/jzallen/dashboard-chat/commit/aacdde52ca4abc84e4e9e942b5a3061f64ea6a63))
* **backend:** add View entity for dbt intermediate layer ([3781211](https://github.com/jzallen/dashboard-chat/commit/37812112b5fb89e80f675ee5291d666f23de0cda))
* **backend:** FHIR/HL7v2 plugin cleanup with multi-dataset support ([4932837](https://github.com/jzallen/dashboard-chat/commit/4932837162fbe4a110b2f6a4fc4f022804c241cb))
* decouple token refresh from logout and add debounced activity detection ([0c83ba5](https://github.com/jzallen/dashboard-chat/commit/0c83ba561b95b24f3953d4d77cee41bb1ce55651))
* **e2e:** modernize e2e test suite for v2 multi-route architecture ([7b31c80](https://github.com/jzallen/dashboard-chat/commit/7b31c80dcbf431fd9c7217dccdf18536edd6d7b3))
* fix transform persistence, compound same-column filters, and error handling ([e1383f8](https://github.com/jzallen/dashboard-chat/commit/e1383f8d83ae4ed355c7a50e559931b0f420118b))
* **frontend:** chat-first UI redesign with Stream-backed sessions ([782a6b7](https://github.com/jzallen/dashboard-chat/commit/782a6b7e689ea35d0874f23f98ea4e5be47907bc))
* implement outbox pattern for upload events (event sourcing) ([8862256](https://github.com/jzallen/dashboard-chat/commit/8862256a8befcd0533b07d4bbebe93da6647fedd))
* implement two-step upload flow with hive-style partitioning ([e30e298](https://github.com/jzallen/dashboard-chat/commit/e30e29854153579b9a5072ad456e7bf0e19843cd))
* integrate Agent Teams into opsx apply and verify commands ([bf711e6](https://github.com/jzallen/dashboard-chat/commit/bf711e6396702df8f60c2a39aaaf3fd3dc6d76dd))
* integrate Stream.io for chat persistence, replacing custom session layer ([da6ad02](https://github.com/jzallen/dashboard-chat/commit/da6ad02874548015a41abeb12a70f26991f0ac6f))
* keyset cursor pagination with JSON:API response envelopes ([111de05](https://github.com/jzallen/dashboard-chat/commit/111de05d0e69c1c8e2f6339b36dae96cde4a7e9a))
* launch postgres ephemeral environment from frontend toggle ([a76cc8b](https://github.com/jzallen/dashboard-chat/commit/a76cc8b7b3ed39462d511fed773727d1baab419e))
* link filter badge removal to transform deactivation ([e4e53ed](https://github.com/jzallen/dashboard-chat/commit/e4e53ed254e6d767ade023ab4113e366cf028af2))
* **sql-access:** add PgBouncer proxy, environment lifecycle, and stable credentials ([149d89b](https://github.com/jzallen/dashboard-chat/commit/149d89b7e51ccd5c9d5384c8e76b1d7098590fdd))


### Performance Improvements

* add S3 fast-fail settings and moto mock for tests ([f1848a1](https://github.com/jzallen/dashboard-chat/commit/f1848a1337032aff446b81b7cee3f9564d24028a))


### BREAKING CHANGES

* Renamed all Pipeline and Filter terminology to Transform
  across the entire codebase for better semantic clarity. Transforms describe
  what happens to data, while pipelines imply orchestration.

  ## Backend Changes

  - Rename model: FilterPipeline → Transform, table: filter_pipelines → transforms
  - Add database migration: 002_rename_to_transforms.py
  - Rename service: pipeline_service.py → transform_service.py
  - Rename router: pipelines.py → transforms.py
  - Update all API endpoints: /api/pipelines → /api/transforms
  - Update all schemas: Pipeline* → Transform*
  - Remove unused endpoints (execute, runs, deactivate)
  - Update model relationships and tests

  ## Frontend Changes

  - Rename components: FilterSettings → TransformSettings,
    PipelineList → TransformList, PipelineCard → TransformCard
  - Decompose TransformCard into focused subcomponents:
    TransformHeader, TransformMetadata, SQLPreview, TransformToggle
  - Rename API client: pipelines.ts → transforms.ts
  - Rename hook: usePipelines → useTransforms
  - Update all function names and interfaces

  ## CSS Module Migration

  - Convert all inline Tailwind to CSS modules with semantic class names
  - Add semantic design tokens to tailwind.config.js (primary, surface,
    accent, semantic)
  - Create common.module.css with reusable UI patterns
  - Apply domain language naming (classes describe purpose, not appearance)
  - Add CSS modules to: App, SkeletonLoader, TablePanel, ActiveFilters,
    TransformSettings, TransformList, TransformCard

  ## Documentation

  - Add CSS_MODULES_GUIDE.md with naming conventions and patterns
  - Update all code comments and docstrings
  - Mark PipelineRun infrastructure as tech debt (currently unused)
