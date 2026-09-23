from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from flask import Flask, render_template, request
from sqlalchemy import DateTime, Integer, String, Text, create_engine, func, select
from sqlalchemy.dialects.mysql import JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
PAGE_SIZE = 50


class Base(DeclarativeBase):
    pass


class Job(Base):
    """Read-only mapping of the existing Job table."""

    __tablename__ = "Job"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jobId: Mapped[str | None] = mapped_column(String(255))
    jobTitle: Mapped[str | None] = mapped_column(String(500))
    companyName: Mapped[str | None] = mapped_column(String(255))
    companyLogo: Mapped[str | None] = mapped_column(String(1000))
    companyLocation: Mapped[str | None] = mapped_column(String(255))
    jobLocation: Mapped[str | None] = mapped_column(String(255))
    jobType: Mapped[str | None] = mapped_column(String(50))
    yearOfExperience: Mapped[str | None] = mapped_column(String(50))
    skills: Mapped[object | None] = mapped_column(JSON)
    jobPostTime: Mapped[datetime | None] = mapped_column(DateTime)
    jobDescription: Mapped[str | None] = mapped_column(Text)
    salary: Mapped[str | None] = mapped_column(String(255))
    jobSource: Mapped[str | None] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(100))
    jobUrl: Mapped[str | None] = mapped_column(String(1000))
    country: Mapped[str | None] = mapped_column(String(50))
    createdAt: Mapped[datetime | None] = mapped_column(DateTime)
    updatedAt: Mapped[datetime | None] = mapped_column(DateTime)


app = Flask(__name__)


def database_session():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is missing. Add it to .env before starting the monitor.")
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    return sessionmaker(bind=engine)()


def day_bounds(selected_day: date) -> tuple[datetime, datetime]:
    # Database DATETIME values are assumed to be in APP_TIMEZONE.
    timezone = ZoneInfo(APP_TIMEZONE)
    start = datetime.combine(selected_day, time.min, tzinfo=timezone).replace(tzinfo=None)
    end = start + timedelta(days=1)
    return start, end


@app.template_filter("display_time")
def display_time(value: datetime | None) -> str:
    if not value:
        return "—"
    return value.strftime("%d %b %Y, %I:%M %p")


@app.template_filter("skills_text")
def skills_text(value: object | None) -> str:
    if isinstance(value, list):
        return ", ".join(map(str, value))
    return str(value) if value else "—"


@app.get("/")
def dashboard():
    tz = ZoneInfo(APP_TIMEZONE)
    today = datetime.now(tz).date()
    requested_date = request.args.get("date", today.isoformat())
    try:
        selected_day = date.fromisoformat(requested_date)
    except ValueError:
        selected_day = today

    page = max(request.args.get("page", 1, type=int), 1)
    search = request.args.get("q", "").strip()
    selected_source = request.args.get("source", "").strip()
    selected_country = request.args.get("country", "").strip()
    start, end = day_bounds(selected_day)

    try:
        with database_session() as session:
            day_query = select(Job).where(Job.createdAt >= start, Job.createdAt < end)
            source_expression = func.coalesce(Job.jobSource, "Unknown")
            sources = session.scalars(
                select(source_expression).where(Job.createdAt >= start, Job.createdAt < end)
                .distinct()
                .order_by(source_expression)
            ).all()
            
            country_expression = func.coalesce(Job.country, "Unknown")
            countries = session.scalars(
                select(country_expression).where(Job.createdAt >= start, Job.createdAt < end)
                .distinct()
                .order_by(country_expression)
            ).all()

            base_query = day_query
            if selected_source:
                base_query = base_query.where(source_expression == selected_source)
            if selected_country:
                base_query = base_query.where(country_expression == selected_country)
            if search:
                term = f"%{search}%"
                base_query = base_query.where(
                    Job.jobTitle.ilike(term) | Job.companyName.ilike(term) | Job.jobLocation.ilike(term)
                )

            total = session.scalar(select(func.count()).select_from(base_query.subquery())) or 0
            jobs = session.scalars(
                base_query.order_by(Job.createdAt.desc(), Job.id.desc())
                .offset((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
            ).all()

            # The breakdown follows a selected source, but not the text search, so
            # it stays a complete category summary for that source and date.
            breakdown_conditions = [Job.createdAt >= start, Job.createdAt < end]
            if selected_source:
                breakdown_conditions.append(source_expression == selected_source)
            breakdown = session.execute(
                select(
                    source_expression.label("source"),
                    func.coalesce(Job.category, "General").label("category"),
                    func.count().label("count"),
                )
                .where(*breakdown_conditions)
                .group_by(Job.jobSource, Job.category)
                .order_by(func.count().desc(), Job.jobSource, Job.category)
            ).all()
            
            country_breakdown = session.execute(
                select(
                    country_expression.label("country"),
                    func.count().label("count"),
                )
                .where(Job.createdAt >= start, Job.createdAt < end)
                .group_by(Job.country)
                .order_by(func.count().desc())
            ).all()

            today_start, today_end = day_bounds(today)
            yesterday_start, yesterday_end = day_bounds(today - timedelta(days=1))
            today_count = session.scalar(select(func.count()).select_from(Job).where(Job.createdAt >= today_start, Job.createdAt < today_end)) or 0
            yesterday_count = session.scalar(select(func.count()).select_from(Job).where(Job.createdAt >= yesterday_start, Job.createdAt < yesterday_end)) or 0
    except Exception as exc:
        return render_template("dashboard.html", error=str(exc), jobs=[], breakdown=[], country_breakdown=[], sources=[], countries=[], total=0, today_count=0, yesterday_count=0,
                               selected_day=selected_day, today=today, yesterday=today - timedelta(days=1), search=search, selected_source=selected_source, selected_country=selected_country, page=page, has_next=False,
                               timezone=APP_TIMEZONE)

    return render_template(
        "dashboard.html", jobs=jobs, total=total, today_count=today_count, yesterday_count=yesterday_count,
        selected_day=selected_day, today=today, yesterday=today - timedelta(days=1), search=search, selected_source=selected_source, selected_country=selected_country,
        page=page, has_next=page * PAGE_SIZE < total, breakdown=breakdown, country_breakdown=country_breakdown, sources=sources, countries=countries,
        error=None, timezone=APP_TIMEZONE,
    )


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5001)
