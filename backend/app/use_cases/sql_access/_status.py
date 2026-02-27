"""Environment status constants for SQL access.

Plain class (not Enum) because values are stored in DB/JSON as strings.
"""


class EnvironmentStatusValue:
    RUNNING = "running"
    STOPPED = "stopped"
    DEGRADED = "degraded"
    PROVISIONING = "provisioning"
    ERROR = "error"
