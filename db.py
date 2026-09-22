"""Safely truncate the Job table (or, explicitly, every table in the database)."""

from __future__ import annotations

import argparse
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text


load_dotenv()


def quote_identifier(name: str) -> str:
    """Quote a MySQL identifier after validating it came from the database."""
    return "`" + name.replace("`", "``") + "`"


def main() -> None:
    parser = argparse.ArgumentParser(description="Truncate MySQL tables.")
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--table", default="Job", help="Table to empty (default: Job).")
    scope.add_argument("--all", action="store_true", help="Empty every base table in this database.")
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required acknowledgement: TRUNCATE permanently removes all rows.",
    )
    args = parser.parse_args()

    if not args.confirm:
        parser.error("Refusing to delete data without --confirm.")

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        parser.error("DATABASE_URL is missing from .env.")
    if not database_url.startswith("mysql"):
        parser.error("This script supports a MySQL DATABASE_URL only.")

    engine = create_engine(database_url, pool_pre_ping=True)
    existing_tables = inspect(engine).get_table_names()
    targets = existing_tables if args.all else [args.table]

    missing_tables = sorted(set(targets) - set(existing_tables))
    if missing_tables:
        parser.error(f"Table not found: {', '.join(missing_tables)}")
    if not targets:
        print("No base tables found; nothing to truncate.")
        return

    print("The following table(s) will be emptied: " + ", ".join(targets))
    with engine.connect() as connection:
        connection.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        try:
            for table_name in targets:
                connection.execute(text(f"TRUNCATE TABLE {quote_identifier(table_name)}"))
                print(f"Truncated {table_name}")
        finally:
            connection.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

    print("Done. The table structure remains; only rows were removed.")


if __name__ == "__main__":
    main()
