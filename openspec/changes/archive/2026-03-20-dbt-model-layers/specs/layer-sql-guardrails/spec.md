## ADDED Requirements

### Requirement: Layer-Specific SQL Operation Allowlists

The chat AI system prompt SHALL include operation allowlists specific to the current layer context, constraining what SQL the AI generates.

- When operating on a **Dataset** (staging), the AI prompt SHALL prohibit: JOINs, GROUP BY, aggregate functions, window functions (beyond dedup), and subqueries.
- When operating on a **View** (intermediate), the AI prompt SHALL allow: JOINs, GROUP BY, aggregations, window functions, CTEs, UNION/UNION ALL, subqueries, CASE WHEN, column aliasing, and row filtering. The prompt SHALL prohibit MetricFlow semantic annotations.
- When operating on a **Report** (mart), the AI prompt SHALL allow all View operations plus: final denormalization joins, metric calculations, and lite aggregations.
- The allowlist SHALL be injected into the system prompt based on the current model context.

#### Scenario: AI generates JOIN for a View

- **WHEN** the user asks "join orders with customers" while operating on a View
- **THEN** the AI SHALL generate SQL containing a JOIN clause

#### Scenario: AI rejects JOIN for a Dataset

- **WHEN** the user asks "join orders with customers" while operating on a Dataset
- **THEN** the AI SHALL explain that JOINs belong in a View or Report
- **THEN** the AI SHALL offer to create a View for the join operation

#### Scenario: AI rejects aggregation for a Dataset

- **WHEN** the user asks "sum revenue by region" while operating on a Dataset
- **THEN** the AI SHALL explain that aggregations belong in a View or Report
- **THEN** the AI SHALL offer to create the appropriate model type

---

### Requirement: Layer Context in Chat

The chat system SHALL track which model and layer the user is currently operating on, and include this context in the AI system prompt.

- The system prompt SHALL include the current model name, layer (Dataset/View/Report), and its source schema information.
- When the user switches between models (e.g., navigates from a Dataset to a View), the context SHALL update accordingly.
- The AI SHALL announce context switches explicitly when making changes across models.

#### Scenario: Chat context includes current View

- **WHEN** the user is viewing a View named "Orders Enriched"
- **THEN** the AI system prompt SHALL include the View name, its layer ("intermediate"), its SQL definition, and the schemas of its source Datasets/Views

#### Scenario: AI announces context switch

- **WHEN** the AI suggests creating a new View from a Dataset context
- **THEN** the AI SHALL explicitly state it is switching from Dataset to View context before describing the operation
