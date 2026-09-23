from __future__ import annotations

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()


def main() -> None:
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise ValueError("DATABASE_URL not found in .env")

    engine = create_engine(database_url, pool_pre_ping=True)

    with engine.begin() as connection:
        connection.execute(
            text("""
                ALTER TABLE `Job`
                MODIFY COLUMN `country` VARCHAR(100) NOT NULL
            """)
        )

    print("Successfully removed default value from country column.")
    print("country is now NOT NULL and must be supplied when inserting rows.")


if __name__ == "__main__":
    main()