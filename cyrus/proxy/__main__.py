"""Entrypoint: ``python -m proxy`` runs the webhook pump.

Reads settings from the environment (see ``proxy.config``), assembles the feed +
forwarder, and drives the execution loop until SIGINT/SIGTERM. All the real work
lives in :meth:`ProxyExecutionLoop.run`; this module is just the ``-m`` hook.
"""

from proxy.execution_loop import ProxyExecutionLoop

if __name__ == "__main__":
    ProxyExecutionLoop.run()
