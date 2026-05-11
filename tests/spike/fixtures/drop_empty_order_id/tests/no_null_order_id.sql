-- Custom test: every row in the staging model must have a non-null order_id.
-- The orders.csv fixture has 2 of 15 rows with an empty order_id; this test
-- is expected to FAIL (drift-detector parity with M1 milestone scenario).
SELECT *
FROM {{ ref('stg_new_dataset') }}
WHERE order_id IS NULL
