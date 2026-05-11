-- Custom test: every row in the staging model must have a non-null region.
-- Demonstrates "drop your own SQL tests into tests/ and run dbt test" —
-- this IS the customer's actual workflow when they eject the project.
-- A `dbt test` returns failed rows; zero rows == green, ≥1 row == red.
SELECT *
FROM {{ ref('stg_new_dataset') }}
WHERE region IS NULL
