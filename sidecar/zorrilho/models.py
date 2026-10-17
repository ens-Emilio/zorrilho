from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class VoiceProfile(Base):
    __tablename__ = "voice_profiles"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False, default="cloned")
    engine = Column(String, nullable=False, default="xtts_v2")
    ref_audio_path = Column(String, nullable=True)
    ref_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    generations = relationship(
        "GenerationHistory",
        back_populates="profile",
        cascade="all, delete-orphan",
    )


class GenerationHistory(Base):
    __tablename__ = "generation_history"

    id = Column(String, primary_key=True, index=True)
    voice_profile_id = Column(String, ForeignKey("voice_profiles.id"), nullable=False)
    text = Column(Text, nullable=False)
    output_path = Column(String, nullable=True)
    engine = Column(String, nullable=False)
    duration_ms = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    profile = relationship("VoiceProfile", back_populates="generations")
