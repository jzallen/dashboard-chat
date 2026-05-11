# <!-- DES-ENFORCEMENT : exempt -->
# Walking-skeleton acceptance for ibis-as-only-sql-compiler (ADR-026).
#
# Contract: this skeleton ratifies the end-to-end customer-visible promise
# of MR-1 — "the SQL the analyst's view produces, and the SQL the customer
# sees in their dbt export, are both compiled by ibis from the same
# structured definition." It is the simplest journey through the new
# compilation surface that an analyst can demo to a stakeholder: one
# view, one filter, one customer-visible artifact.
#
# This file unpends in Phase 01 (MR-1 lands). It does NOT carry @pending
# — it is the running outer-loop assertion that gates MR-1's GREEN.
#
# Driving port: the view-creation use-case facade
# (`app.use_cases.view.create_view`) and the project-eject use-case
# facade (`app.use_cases.project._dbt.intermediate`). Both are Python
# use-case entry points sitting above the SQL-compilation layer per
# CLAUDE.md decorator-stack discipline.
#
# This is a CONTRACT not a mechanism: assertions speak to what the
# analyst and the customer observe (filter present in compiled SQL,
# filter present in ejected dbt model), not to which ibis operations
# the compiler internally chooses.

@walking_skeleton @driving_adapter
Feature: An analyst's view filter renders correctly in the compiled SQL and in the customer's dbt eject
  As an analyst building intermediate views and exporting them for the customer's dbt project,
  I want the filter I attach to a view to appear in both the system's compiled SQL
  and the customer's exported dbt model
  So that the SQL the agent produces is the SQL the customer ships.

  Scenario: An analyst creates a "west_orders" view filtering region = 'west' and the customer's dbt eject contains the same filter
    Given the analyst has a project containing an "orders" dataset with a "region" column
    When the analyst creates a view named "west_orders" that selects "region" and "order_id" from "orders" and filters where "region" equals "west"
    Then the compiled view SQL contains a WHERE clause restricting region to "west"
    And the customer's dbt export contains an intermediate model "int_west_orders" whose SQL also restricts region to "west"
    And evaluating the compiled view against orders with regions "west", "east", and "central" returns only the "west" rows
