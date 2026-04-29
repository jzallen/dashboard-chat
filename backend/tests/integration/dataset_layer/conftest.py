"""Conftest for dataset-layer api-driven-user-flow-tests.

Per `docs/feature/api-driven-user-flow-tests/design/design.md` §4 Reuse Analysis,
this subtree explicitly does NOT use the moto-based ``auto_mock_s3`` autouse;
the Guiding Principle requires real MinIO from compose. The parent
``backend/tests/conftest.py`` does not declare ``mock_s3`` as autouse, so
nothing needs to be opted out here today — this file exists to (a) anchor the
package for pytest collection and (b) hold any future per-suite fixtures
(``DatasetLayerHarness``, ``dataset_layer_project``) that DELIVER will add.
"""
