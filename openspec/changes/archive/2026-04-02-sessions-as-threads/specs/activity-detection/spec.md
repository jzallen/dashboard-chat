## REMOVED Requirements

### Requirement: Session Freezing and Inactivity Detection

**Reason**: Sessions now persist indefinitely with no freezing or inactivity timeout. The sessions-as-threads model supports multiple active sessions within a project that can be revisited at any time.

**Migration**: Remove all session freezing UI, inactivity timers, and related logic. Session `last_active_at` is tracked for sort ordering only, not for lifecycle management.
