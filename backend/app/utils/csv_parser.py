"""Shared CSV parsing and cleaning utilities."""

import io

import pandas as pd


def parse_and_clean_csv(file_content: bytes) -> pd.DataFrame:
    """Parse raw CSV bytes into a cleaned DataFrame.

    Strips whitespace from column headers and string column values.
    """
    df = pd.read_csv(io.BytesIO(file_content))
    df.columns = df.columns.str.strip()
    str_cols = df.select_dtypes(include="object").columns
    df[str_cols] = df[str_cols].apply(lambda col: col.str.strip())
    return df
