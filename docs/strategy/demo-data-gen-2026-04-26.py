"""Generate synthetic e-commerce orders CSV for the staging-layer demo.

Domain: e-commerce orders. Universally relatable for non-technical stakeholders,
covers every rough-edge pattern naturally (region casing, payment-method
variants, mixed date formats, currency strings).

Output: /usr/local/share/dc-demo-data/ecommerce-orders.csv
Rows:   250 (small enough to load fast, large enough to demo group-by/filter)
Cols:   10 mixing text / numeric / date / categorical

Reproducibility: stdlib only, fixed seed. Run again to regenerate identical CSV.
No PII. All names/emails/products are synthetic.
"""

from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

SEED = 20260426
N_ROWS = 250
OUTPUT = Path("/usr/local/share/dc-demo-data/ecommerce-orders.csv")

# Categorical pools with intentional rough edges — the demo's whole point is
# to show chat-driven cleanup, so each pool has casing / whitespace / typo
# variants that a user would naturally ask the agent to fix.
REGIONS = [
    "North", "north", "NORTH", " North ",
    "South", "south", "SOUTH ",
    "East", "east", " East",
    "West", "west", "WEST",
]

# product_category — typos and casing variants
CATEGORIES = [
    "Electronics", "electronics", "Electornics",  # typo intentional
    "Apparel", "apparel", "APPAREL ",
    "Home Goods", "home goods", "Home goods",
    "Books", "books",
    "Toys", "toys", " Toys",
]

PRODUCTS = {
    "Electronics": ["Wireless Headphones", "USB-C Charger", "Bluetooth Speaker", "4K Webcam", "Mechanical Keyboard"],
    "Apparel":     ["Cotton T-Shirt", "Denim Jacket", "Running Shoes", "Wool Socks", "Baseball Cap"],
    "Home Goods":  ["Ceramic Mug", "Throw Pillow", "Desk Lamp", "Cutting Board", "Wall Clock"],
    "Books":       ["Mystery Novel", "Cookbook Vol 2", "Sci-Fi Anthology", "Travel Guide: Iceland", "Coding Manual"],
    "Toys":        ["Building Blocks", "Plush Bear", "Puzzle 1000pc", "Toy Car Set", "Board Game Classic"],
}

PAYMENT_METHODS = [
    "credit_card", "Credit Card", "credit-card", "CREDIT_CARD",
    "PayPal", "paypal", "Paypal",
    "Apple Pay", "apple_pay", "applepay",
    "bank_transfer", "Bank Transfer",
]

SHIPPING_STATUSES = [
    "Delivered", "delivered", "DELIVERED",
    "Pending", "pending", "PENDING",
    "Shipped", "shipped",
    "Cancelled", "cancelled",
]

EMAIL_DOMAINS = ["example.com", "demo.io", "sample.net", "testmail.org"]
FIRST_NAMES = ["alex", "sam", "jordan", "taylor", "morgan", "casey", "riley", "jamie",
               "drew", "quinn", "avery", "rowan", "sage", "blake", "cameron"]
LAST_NAMES  = ["smith", "lee", "patel", "garcia", "nguyen", "kim", "brown", "davis",
               "wilson", "moore", "clark", "lewis", "walker", "hall", "young"]


def normalize_category_for_lookup(c: str) -> str:
    """Strip whitespace + lowercase to find the canonical product list."""
    cleaned = c.strip().lower()
    for canonical in PRODUCTS:
        if cleaned in (canonical.lower(), "electornics" if canonical == "Electronics" else None):
            return canonical
    return "Electronics"  # safe fallback


def make_email(rng: random.Random) -> str:
    first = rng.choice(FIRST_NAMES)
    last = rng.choice(LAST_NAMES)
    domain = rng.choice(EMAIL_DOMAINS)
    email = f"{first}.{last}@{domain}"
    # Sprinkle in trailing whitespace ~10% of the time — common real-world dirt
    if rng.random() < 0.10:
        email = email + " "
    if rng.random() < 0.05:
        email = " " + email
    return email


def make_date(rng: random.Random) -> str:
    """Random date in 2025, returned in one of two formats to demo standardization."""
    start = date(2025, 1, 1)
    days_offset = rng.randint(0, 364)
    d = start + timedelta(days=days_offset)
    # 60% ISO format, 40% US format — gives a clear mixed-format demo prompt
    if rng.random() < 0.60:
        return d.isoformat()                        # "2025-03-15"
    return f"{d.month:02d}/{d.day:02d}/{d.year}"    # "03/15/2025"


def make_unit_price(rng: random.Random, category: str) -> str:
    """Price as a string with $ on some rows — gives a 'strip currency symbol' prompt."""
    base_ranges = {
        "Electronics": (29.99, 399.99),
        "Apparel":     (12.99,  89.99),
        "Home Goods":  ( 8.99, 129.99),
        "Books":       ( 6.99,  34.99),
        "Toys":        ( 9.99,  79.99),
    }
    lo, hi = base_ranges[category]
    price = round(rng.uniform(lo, hi), 2)
    # ~30% of rows include the dollar sign — a natural cleanup target
    if rng.random() < 0.30:
        return f"${price:.2f}"
    return f"{price:.2f}"


def make_discount(rng: random.Random) -> str:
    """Discount % with ~15% nulls — gives a 'fill missing discounts with zero' prompt."""
    if rng.random() < 0.15:
        return ""  # null
    return f"{rng.choice([0, 0, 0, 5, 10, 15, 20, 25])}"


def main() -> None:
    rng = random.Random(SEED)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    for i in range(1, N_ROWS + 1):
        category_raw = rng.choice(CATEGORIES)
        canonical_cat = normalize_category_for_lookup(category_raw)
        product = rng.choice(PRODUCTS[canonical_cat])
        rows.append({
            "order_id":         f"ORD-{i:05d}",
            "order_date":       make_date(rng),
            "customer_email":   make_email(rng),
            "region":           rng.choice(REGIONS),
            "product_category": category_raw,
            "product_name":     product,
            "quantity":         rng.randint(1, 8),
            "unit_price":       make_unit_price(rng, canonical_cat),
            "discount_pct":     make_discount(rng),
            "payment_method":   rng.choice(PAYMENT_METHODS),
            "shipping_status":  rng.choice(SHIPPING_STATUSES),
        })

    fieldnames = list(rows[0].keys())
    with OUTPUT.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {OUTPUT}")


if __name__ == "__main__":
    main()
