"""Cloud SQL (PostgreSQL) async connection pool."""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import DATABASE_URL

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=5, max_overflow=10)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    """Dependency that yields a database session."""
    async with async_session() as session:
        yield session
