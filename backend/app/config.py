"""Application configuration from environment variables."""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    database_url: str = "postgresql+asyncpg://dashboard:dashboard_secret@localhost:5432/dashboard_chat"

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Debug mode
    debug: bool = True

    # App info
    app_name: str = "Dashboard Chat API"
    app_version: str = "1.0.0"

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse CORS origins from comma-separated string."""
        return [origin.strip() for origin in self.cors_origins.split(",")]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
