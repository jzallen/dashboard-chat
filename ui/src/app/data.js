/* ============================================================
 Mock catalog — faithful to the real data model:
 Dataset (staging) -> View (intermediate) -> Report (mart)
 Field shapes mirror frontend/src/core/dataCatalog/*.ts
 ============================================================ */
const PROJECT = { id: "019e7997", name: "Demo Project", description: "Data-layer demo" };

const PROJECTS = [
  { id: "019e7997", name: "Demo Project", desc: "Customer + ecommerce pipeline", datasets: 2, models: 5 },
  { id: "p_mktg", name: "Marketing Analytics", desc: "Campaigns, attribution, spend", datasets: 4, models: 9 },
  { id: "p_fin", name: "Finance Warehouse", desc: "Ledger, AR/AP, revenue", datasets: 6, models: 14 },
  { id: "p_telem", name: "Product Telemetry", desc: "Events, sessions, funnels", datasets: 3, models: 7 },
  { id: "p_ops", name: "Ops & Logistics", desc: "Inventory, fulfilment, SLA", datasets: 5, models: 11 },
];

/* ---------- STAGING: datasets (uploaded CSVs + cleaning transforms) ---------- */
const customers = {
  kind: "dataset", layer: "staging", node: "stg.customers",
  id: "ds_customers", name: "Customers", model: "stg_customers", rows: 250,
  fields: [
    { name: "cust_id", type: "number" }, { name: "full_name", type: "text" },
    { name: "email", type: "text" }, { name: "city", type: "text" },
    { name: "status", type: "text" }, { name: "signup_source", type: "text" },
    { name: "revenue", type: "number" }, { name: "notes", type: "text" },
  ],
  preview: [
    { cust_id: 1, full_name: "Alice Johnson", email: "alice@example.com", city: "new york", status: "active", signup_source: "WEB", revenue: 1200.5 },
    { cust_id: 2, full_name: "bob smith", email: "BOB.SMITH@EXAMPLE.COM", city: "Los Angeles", status: "ACTIVE", signup_source: "mobile", revenue: 850 },
    { cust_id: 3, full_name: "Charlie Brown", email: "charlie@example.com", city: "chicago", status: "inactive", signup_source: "Web", revenue: null },
    { cust_id: 4, full_name: "diana prince", email: "diana@example.com", city: "NEW YORK", status: "Active", signup_source: "MOBILE", revenue: 2300.75 },
    { cust_id: 5, full_name: "Edward Norton", email: "edward@example.com", city: "chicago", status: "active", signup_source: "web", revenue: 0 },
  ],
  transforms: [
    { id: "t1", name: "Lowercase email", op: "case", column: "email", status: "enabled", detail: "lower(email)", sample: { before: "BOB.SMITH@EXAMPLE.COM", after: "bob.smith@example.com" } },
    { id: "t2", name: "Title-case city", op: "case", column: "city", status: "enabled", detail: "initcap(city)", sample: { before: "new york", after: "New York" } },
    { id: "t3", name: "Normalize status", op: "map_values", column: "status", status: "enabled", detail: "lower(trim(status))", sample: { before: "ACTIVE", after: "active" } },
    { id: "t4", name: "Trim notes", op: "trim", column: "notes", status: "enabled", detail: "trim(notes)", sample: { before: "  vip  ", after: "vip" } },
    { id: "t5", name: "Fill null revenue", op: "fill_null", column: "revenue", status: "enabled", detail: "coalesce(revenue, 0)", sample: { before: "NULL", after: "0" } },
  ],
  sql: `SELECT
cust_id,
lower(email)              AS email,
initcap(city)            AS city,
lower(trim(status))      AS status,
upper(signup_source)     AS signup_source,
coalesce(revenue, 0)     AS revenue,
trim(notes)              AS notes
FROM "Customers" AS c`,
};

const ecommerce = {
  kind: "dataset", layer: "staging", node: "stg.ecommerce",
  id: "ds_ecommerce", name: "Ecommerce", model: "stg_orders", rows: 1840,
  fields: [
    { name: "order_id", type: "number" }, { name: "cust_id", type: "number" },
    { name: "product", type: "text" }, { name: "category", type: "text" },
    { name: "qty", type: "number" }, { name: "unit_price", type: "number" },
    { name: "order_date", type: "text" }, { name: "channel", type: "text" },
    { name: "discount", type: "number" }, { name: "status", type: "text" }, { name: "region", type: "text" },
  ],
  preview: [
    { order_id: 5001, cust_id: 1, product: "Widget A", category: "tools", qty: 2, unit_price: 19.99, order_date: "2025/01/04", region: "East" },
    { order_id: 5002, cust_id: 4, product: "Gadget X", category: "Tools", qty: 1, unit_price: 129.0, order_date: "01-05-2025", region: "west" },
    { order_id: 5003, cust_id: 2, product: "Widget A", category: "TOOLS", qty: 5, unit_price: 19.99, order_date: "2025/01/06", region: "East" },
  ],
  transforms: [
    { id: "e1", name: "Parse order_date", op: "cast", column: "order_date", status: "enabled", detail: "cast(order_date AS date)", sample: { before: "2025/01/04", after: "2025-01-04" } },
    { id: "e2", name: "Lowercase category", op: "case", column: "category", status: "enabled", detail: "lower(category)", sample: { before: "TOOLS", after: "tools" } },
    { id: "e3", name: "Title-case region", op: "case", column: "region", status: "enabled", detail: "initcap(region)", sample: { before: "west", after: "West" } },
  ],
  sql: `SELECT
order_id, cust_id, product,
lower(category)               AS category,
qty, unit_price,
cast(order_date AS date)      AS order_date,
channel, discount, status,
initcap(region)               AS region
FROM "Ecommerce" AS e`,
};

/* ---------- INTERMEDIATE: view joining two staging datasets ---------- */
const customerOrders = {
  kind: "view", layer: "intermediate", node: "int.customer_orders",
  id: "vw_customer_orders", name: "Customer Orders", model: "int_customer_orders",
  materialization: "view", rows: 1840,
  source_refs: [{ id: "ds_customers", type: "dataset" }, { id: "ds_ecommerce", type: "dataset" }],
  columns: [
    { name: "cust_id", source_ref: "stg_customers", source_column: "cust_id", display_type: "id", grain_role: "Entity" },
    { name: "full_name", source_ref: "stg_customers", source_column: "full_name", display_type: "text", grain_role: "Dimension" },
    { name: "city", source_ref: "stg_customers", source_column: "city", display_type: "category", grain_role: "Dimension" },
    { name: "order_id", source_ref: "stg_orders", source_column: "order_id", display_type: "id", grain_role: "Entity" },
    { name: "product", source_ref: "stg_orders", source_column: "product", display_type: "text", grain_role: "Dimension" },
    { name: "region", source_ref: "stg_orders", source_column: "region", display_type: "category", grain_role: "Dimension" },
    { name: "qty", source_ref: "stg_orders", source_column: "qty", display_type: "integer", grain_role: "Metric" },
    { name: "unit_price", source_ref: "stg_orders", source_column: "unit_price", display_type: "decimal", grain_role: "Metric" },
    { name: "order_date", source_ref: "stg_orders", source_column: "order_date", display_type: "date", grain_role: "Time" },
  ],
  joins: [{ left_ref: "stg_customers", left_column: "cust_id", right_ref: "stg_orders", right_column: "cust_id", join_type: "INNER" }],
  filters: [{ source_ref: "stg_orders", column: "status", operator: "!=", value: "cancelled" }],
  grain: { time_column: "order_date", dimensions: ["region", "city"] },
  preview: [
    { cust_id: 1, full_name: "Alice Johnson", city: "New York", order_id: 5001, product: "Widget A", region: "East", qty: 2, unit_price: 19.99, order_date: "2025-01-04" },
    { cust_id: 4, full_name: "Diana Prince", city: "New York", order_id: 5002, product: "Gadget X", region: "West", qty: 1, unit_price: 129.0, order_date: "2025-01-05" },
    { cust_id: 2, full_name: "Bob Smith", city: "Los Angeles", order_id: 5003, product: "Widget A", region: "East", qty: 5, unit_price: 19.99, order_date: "2025-01-06" },
    { cust_id: 1, full_name: "Alice Johnson", city: "New York", order_id: 5009, product: "Bolt Kit", region: "East", qty: 3, unit_price: 8.5, order_date: "2025-01-09" },
  ],
  sql: `SELECT
c.cust_id, c.full_name, c.city,
o.order_id, o.product, o.region,
o.qty, o.unit_price, o.order_date
FROM {{ ref('stg_customers') }} AS c
INNER JOIN {{ ref('stg_orders') }} AS o
ON c.cust_id = o.cust_id
WHERE o.status != 'cancelled'`,
};

/* ---------- MARTS: reports (aggregations) ---------- */
const fctOrders = {
  kind: "report", layer: "mart", node: "mart.fct_orders",
  id: "rp_fct_orders", name: "Orders Fact", model: "fct_orders",
  report_type: "fact", materialization: "table", domain: "sales", rows: 1840,
  source_refs: [{ id: "vw_customer_orders", type: "view" }],
  preview: [
    { order_id: 5001, cust_id: 1, region: "East", order_date: "2025-01-04", gross_revenue: 39.98, units_sold: 2 },
    { order_id: 5002, cust_id: 4, region: "West", order_date: "2025-01-05", gross_revenue: 129.0, units_sold: 1 },
    { order_id: 5003, cust_id: 2, region: "East", order_date: "2025-01-06", gross_revenue: 99.95, units_sold: 5 },
    { order_id: 5009, cust_id: 1, region: "East", order_date: "2025-01-09", gross_revenue: 25.5, units_sold: 3 },
  ],
  columns_metadata: [
    { name: "order_id", semantic_role: "entity", semantic_type: "id" },
    { name: "cust_id", semantic_role: "entity", semantic_type: "id" },
    { name: "region", semantic_role: "dimension", semantic_type: "category" },
    { name: "order_date", semantic_role: "dimension", semantic_type: "date", time_granularity: "day" },
    { name: "gross_revenue", semantic_role: "measure", semantic_type: "currency", expr: "sum(qty * unit_price)" },
    { name: "units_sold", semantic_role: "measure", semantic_type: "number", expr: "sum(qty)" },
  ],
  sql: `SELECT
order_id, cust_id, region,
order_date,
sum(qty * unit_price)  AS gross_revenue,
sum(qty)               AS units_sold
FROM {{ ref('int_customer_orders') }}
GROUP BY order_id, cust_id, region, order_date`,
};

const dimCustomers = {
  kind: "report", layer: "mart", node: "mart.dim_customers",
  id: "rp_dim_customers", name: "Customers Dimension", model: "dim_customers",
  report_type: "dimension", materialization: "table", domain: "customer", rows: 250,
  source_refs: [{ id: "ds_customers", type: "dataset" }],
  preview: [
    { cust_id: 1, full_name: "Alice Johnson", city: "New York", status: "active", signup_source: "WEB", lifetime_revenue: 1200.5 },
    { cust_id: 2, full_name: "Bob Smith", city: "Los Angeles", status: "active", signup_source: "MOBILE", lifetime_revenue: 850.0 },
    { cust_id: 3, full_name: "Charlie Brown", city: "Chicago", status: "inactive", signup_source: "WEB", lifetime_revenue: 0.0 },
    { cust_id: 4, full_name: "Diana Prince", city: "New York", status: "active", signup_source: "MOBILE", lifetime_revenue: 2300.75 },
  ],
  columns_metadata: [
    { name: "cust_id", semantic_role: "entity", semantic_type: "id" },
    { name: "full_name", semantic_role: "dimension", semantic_type: "text" },
    { name: "city", semantic_role: "dimension", semantic_type: "category" },
    { name: "status", semantic_role: "dimension", semantic_type: "category" },
    { name: "signup_source", semantic_role: "dimension", semantic_type: "category" },
    { name: "lifetime_revenue", semantic_role: "measure", semantic_type: "currency", expr: "sum(revenue)" },
  ],
  sql: `SELECT
cust_id, full_name, city, status, signup_source,
sum(revenue) AS lifetime_revenue
FROM {{ ref('stg_customers') }}
GROUP BY cust_id, full_name, city, status, signup_source`,
};

/* ---------- Audit trails: what the assistant did, per model ---------- */
const AUDIT = {
  "stg.customers": [
    { tool: "addTransform", say: 'Lowercased "email" so joins and dedupe are case-insensitive', tag: "clean" },
    { tool: "addTransform", say: 'Title-cased "city" — collapsed 6 spellings of "new york"', tag: "clean" },
    { tool: "addTransform", say: 'Normalized "status" to lowercase ("ACTIVE" → "active")', tag: "clean" },
    { tool: "addTransform", say: 'Filled null "revenue" with 0 (3 rows affected)', tag: "fix" },
  ],
  "stg.ecommerce": [
    { tool: "addTransform", say: 'Parsed "order_date" — handled 2 date formats into DATE', tag: "cast" },
    { tool: "addTransform", say: 'Lowercased "category" and title-cased "region"', tag: "clean" },
  ],
  "int.customer_orders": [
    { tool: "createView", say: 'Created intermediate view "int_customer_orders"', tag: "create" },
    { tool: "addJoin", say: "Added INNER join customers ⋈ orders on cust_id", tag: "join" },
    { tool: "addColumn", say: "Selected 9 columns across both sources", tag: "shape" },
    { tool: "addFilter", say: "Filtered out cancelled orders", tag: "filter" },
    { tool: "castColumn", say: 'Set grain — time: order_date, dims: region, city', tag: "grain" },
    { tool: "setMaterialization", say: "Materialization → view", tag: "config" },
  ],
  "mart.fct_orders": [
    { tool: "createReport", say: 'Created fact report "fct_orders"', tag: "create" },
    { tool: "addMeasure", say: "Added measure gross_revenue = sum(qty × unit_price)", tag: "measure" },
    { tool: "addMeasure", say: "Added measure units_sold = sum(qty)", tag: "measure" },
    { tool: "setGrain", say: "Grouped by order, region, order_date", tag: "grain" },
    { tool: "setMaterialization", say: "Materialization → table", tag: "config" },
  ],
  "mart.dim_customers": [
    { tool: "createReport", say: 'Created dimension report "dim_customers"', tag: "create" },
    { tool: "setEntity", say: "Entity key → cust_id", tag: "config" },
    { tool: "addMeasure", say: "Added lifetime_revenue = sum(revenue)", tag: "measure" },
  ],
  "mart.revenue_by_region": [
    { tool: "createReport", say: 'Created fact report "fct_revenue_by_region"', tag: "create" },
    { tool: "setSource", say: "Source → int_customer_orders (intermediate)", tag: "source" },
    { tool: "addDimension", say: "Grouped by region", tag: "grain" },
    { tool: "addMeasure", say: "Added gross_revenue = sum(qty × unit_price)", tag: "measure" },
    { tool: "addMeasure", say: "Added n_orders = count(distinct order_id)", tag: "measure" },
    { tool: "setGrain", say: "Time grain → order_date by month", tag: "grain" },
  ],
};

/* ---------- Lineage graph ---------- */
const NODES = {
  "src.customers_csv": { id: "src.customers_csv", label: "customers.csv", sub: "source", layer: "source",
    schema: [
      { name: "cust_id", type: "number" }, { name: "full_name", type: "text" }, { name: "email", type: "text" },
      { name: "city", type: "text" }, { name: "status", type: "text" }, { name: "signup_source", type: "text" },
      { name: "revenue", type: "number" }, { name: "notes", type: "text" },
    ],
    files: [{ name: "customers.csv", rows: 250, when: "Jan 12" }, { name: "customers_jan.csv", rows: 64, when: "Jan 28" }] },
  "src.ecommerce_csv": { id: "src.ecommerce_csv", label: "ecommerce.csv", sub: "source", layer: "source",
    schema: [
      { name: "order_id", type: "number" }, { name: "cust_id", type: "number" }, { name: "product", type: "text" },
      { name: "category", type: "text" }, { name: "qty", type: "number" }, { name: "unit_price", type: "number" },
      { name: "order_date", type: "text" }, { name: "channel", type: "text" }, { name: "discount", type: "number" },
      { name: "status", type: "text" }, { name: "region", type: "text" },
    ],
    files: [{ name: "ecommerce.csv", rows: 1840, when: "Jan 12" }] },
  "stg.customers": { id: "stg.customers", label: "stg_customers", sub: "Customers", layer: "staging", ref: customers },
  "stg.ecommerce": { id: "stg.ecommerce", label: "stg_orders", sub: "Ecommerce", layer: "staging", ref: ecommerce },
  "int.customer_orders": { id: "int.customer_orders", label: "int_customer_orders", sub: "Customer Orders", layer: "intermediate", ref: customerOrders },
  "mart.fct_orders": { id: "mart.fct_orders", label: "fct_orders", sub: "Orders Fact", layer: "mart", ref: fctOrders },
  "mart.dim_customers": { id: "mart.dim_customers", label: "dim_customers", sub: "Customers Dim", layer: "mart", ref: dimCustomers },
};
const EDGES = [
  ["src.customers_csv", "stg.customers"],
  ["src.ecommerce_csv", "stg.ecommerce"],
  ["stg.customers", "int.customer_orders"],
  ["stg.ecommerce", "int.customer_orders"],
  ["stg.customers", "mart.dim_customers"],
  ["int.customer_orders", "mart.fct_orders"],
];

/* ---------- Chat: scripted creation of a NEW mart, live ---------- */
const CHAT_SCRIPT = {
  prompt: "Build a revenue-by-region report from customer orders",
  newNode: {
    id: "mart.revenue_by_region",
    label: "fct_revenue_by_region", sub: "Revenue by Region", layer: "mart",
    ref: {
      kind: "report", layer: "mart", node: "mart.revenue_by_region",
      id: "rp_rev_region", name: "Revenue by Region", model: "fct_revenue_by_region",
      report_type: "fact", materialization: "table", domain: "sales", rows: 4,
      source_refs: [{ id: "vw_customer_orders", type: "view" }],
      preview: [
        { region: "East", order_month: "2025-01", gross_revenue: 18420.5, n_orders: 312 },
        { region: "West", order_month: "2025-01", gross_revenue: 14110.0, n_orders: 241 },
        { region: "North", order_month: "2025-01", gross_revenue: 9320.25, n_orders: 156 },
        { region: "South", order_month: "2025-01", gross_revenue: 7715.75, n_orders: 131 },
      ],
      columns_metadata: [
        { name: "region", semantic_role: "dimension", semantic_type: "category" },
        { name: "order_month", semantic_role: "dimension", semantic_type: "date", time_granularity: "month" },
        { name: "gross_revenue", semantic_role: "measure", semantic_type: "currency", expr: "sum(qty * unit_price)" },
        { name: "n_orders", semantic_role: "measure", semantic_type: "number", expr: "count(distinct order_id)" },
      ],
      sql: `SELECT
region,
date_trunc('month', order_date) AS order_month,
sum(qty * unit_price)           AS gross_revenue,
count(distinct order_id)        AS n_orders
FROM {{ ref('int_customer_orders') }}
GROUP BY region, order_month`,
    },
  },
  newEdge: ["int.customer_orders", "mart.revenue_by_region"],
  // streamed assistant turns; each `tool` step lands in the audit
  turns: [
    { type: "text", text: "I'll build this on top of the **int_customer_orders** view so it inherits your cleaning and the customer⋈orders join. Creating a fact report in the mart layer:" },
    { type: "tool", tool: "createReport", say: 'Created fact report "fct_revenue_by_region"', tag: "create" },
    { type: "tool", tool: "setSource", say: "Source → int_customer_orders (intermediate)", tag: "source" },
    { type: "tool", tool: "addDimension", say: "Grouped by region", tag: "grain" },
    { type: "tool", tool: "addMeasure", say: "Added gross_revenue = sum(qty × unit_price)", tag: "measure" },
    { type: "tool", tool: "addMeasure", say: "Added n_orders = count(distinct order_id)", tag: "measure" },
    { type: "tool", tool: "setGrain", say: "Time grain → order_date by month", tag: "grain" },
    { type: "text", text: "Done. **fct_revenue_by_region** is in your mart layer and shows in the lineage graph. Audit and SQL are ready to review, and it'll export as a dbt model under `models/marts/`." },
  ],
};

/* ---------- dbt export tree ---------- */
const DBT_FILES = [
  { path: "dbt_project.yml", layer: "config" },
  { path: "models/staging/_sources.yml", layer: "staging" },
  { path: "models/staging/stg_customers.sql", layer: "staging", ref: "stg.customers" },
  { path: "models/staging/stg_orders.sql", layer: "staging", ref: "stg.ecommerce" },
  { path: "models/staging/_staging.yml", layer: "staging" },
  { path: "models/intermediate/int_customer_orders.sql", layer: "intermediate", ref: "int.customer_orders" },
  { path: "models/marts/fct_orders.sql", layer: "mart", ref: "mart.fct_orders" },
  { path: "models/marts/dim_customers.sql", layer: "mart", ref: "mart.dim_customers" },
  { path: "models/marts/_marts.yml", layer: "mart" },
];

const LAYERS = {
  source: { key: "source", name: "Sources", dbt: "seeds / sources", color: "var(--layer-source)", bg: "var(--layer-source-bg)", desc: "Raw uploaded CSVs" },
  staging: { key: "staging", name: "Datasets", dbt: "staging · stg_", color: "var(--layer-staging)", bg: "var(--layer-staging-bg)", desc: "Cleaned one-to-one with each upload" },
  intermediate: { key: "intermediate", name: "Views", dbt: "intermediate · int_", color: "var(--layer-intermediate)", bg: "var(--layer-intermediate-bg)", desc: "Joins & reshaping across datasets" },
  mart: { key: "mart", name: "Reports", dbt: "marts · fct_ / dim_", color: "var(--layer-mart)", bg: "var(--layer-mart-bg)", desc: "Aggregations ready for consumption" },
};

const ORG = {
  name: "Demo Org", slug: "demo-org", region: "us-east-1", plan: "Team",
  seats: 8, usedSeats: 4, created: "Jan 2025",
  members: [
    { name: "Jordan Zale", email: "jordan@demoorg.com", role: "Owner" },
    { name: "Priya Nair", email: "priya@demoorg.com", role: "Admin" },
    { name: "Marcus Lee", email: "marcus@demoorg.com", role: "Editor" },
    { name: "Sofia Ruiz", email: "sofia@demoorg.com", role: "Viewer" },
  ],
  defaults: { engine: "DuckDB", materialization: "view", modelPrefix: "analytics" },
};

const RECENTS = [
  { title: "Clean customers + build revenue mart", nodeId: "mart.fct_orders" },
  { title: "Join customers with orders", nodeId: "int.customer_orders" },
  { title: "Normalize the Customers upload", nodeId: "stg.customers" },
];

const ALL_CHATS = [
  { title: "Clean customers + build revenue mart", nodeId: "mart.fct_orders", when: "2m ago", snippet: "Added gross_revenue = sum(qty × unit_price)" },
  { title: "Join customers with orders", nodeId: "int.customer_orders", when: "11m ago", snippet: "Added INNER join customers ⋈ orders on cust_id" },
  { title: "Normalize the Customers upload", nodeId: "stg.customers", when: "1h ago", snippet: "Lowercased email, title-cased city, filled null revenue" },
  { title: "Parse Ecommerce order dates", nodeId: "stg.ecommerce", when: "1h ago", snippet: "Handled 2 date formats into a DATE column" },
  { title: "Customers dimension table", nodeId: "mart.dim_customers", when: "3h ago", snippet: "One row per customer with lifetime_revenue" },
  { title: "Explore pipeline lineage", nodeId: null, when: "Yesterday", snippet: "Walked through staging → intermediate → marts" },
  { title: "Filter out cancelled orders", nodeId: "int.customer_orders", when: "Yesterday", snippet: "Added filter status != 'cancelled'" },
  { title: "New session", nodeId: null, when: "2d ago", snippet: "Upload a CSV to get started" },
  { title: "Revenue by region report", nodeId: "mart.fct_orders", when: "3d ago", snippet: "Grouped gross_revenue by region and month" },
  { title: "Set materialization strategies", nodeId: "int.customer_orders", when: "4d ago", snippet: "Views → view, marts → table" },
];

export const DC = {
  PROJECT, PROJECTS, ORG, LAYERS, RECENTS, ALL_CHATS,
  datasets: [customers, ecommerce],
  views: [customerOrders],
  reports: [fctOrders, dimCustomers],
  byId: Object.fromEntries([customers, ecommerce, customerOrders, fctOrders, dimCustomers].map((m) => [m.node, m])),
  AUDIT, NODES, EDGES, CHAT_SCRIPT, DBT_FILES,
};
