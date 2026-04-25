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
