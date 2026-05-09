"""Eject-and-test orchestration package — RED scaffold (created by DISTILL).

ADR-018, Option β. Components:
    EjectAndTestOrchestrator   (orchestrator.py)
    DbtRunner                  (runner.py)
    DuckDBProfileSeeder        (seeder.py)
    RunResultsParser           (parser.py)
    EjectOrchestratorProtocol  (protocols.py)
    Probe functions            (probe.py)

Per the nw-distill skill's Mandate 7, every public surface raises
AssertionError with the scaffold message — NOT NotImplementedError or
ImportError — so the Red Gate Snapshot classifies tests as RED and
DELIVER's TDD cycle proceeds.
"""

__SCAFFOLD__ = True
