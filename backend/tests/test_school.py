"""School routes: authorization, enrollment, and daily attendance."""
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, models
from app.database import Base, get_db
from app.main import app


@pytest.fixture
def school_client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        db.add(models.User(full_name="Admin", email="school-admin@example.com", hashed_password="unused", role="admin"))
        db.add(models.User(full_name="Learner", email="learner@example.com", hashed_password="unused", role="student"))
        db.commit()

    def override_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.state.limiter.enabled = False
    try:
        client = TestClient(app)
        client.session_factory = session_factory
        yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def headers(user_id):
    return {"Authorization": f"Bearer {auth.create_access_token({'sub': str(user_id)})}"}


def test_school_requires_admin(school_client):
    assert school_client.get("/school/summary").status_code == 401
    assert school_client.get("/school/summary", headers=headers(2)).status_code == 403


def test_teacher_class_enrollment_and_attendance(school_client):
    admin = headers(1)
    teacher = school_client.post("/school/teachers", headers=admin, json={
        "full_name": "Ada", "email": "ada@example.com", "subject": "Mathematics",
    })
    assert teacher.status_code == 201
    teacher_id = teacher.json()["id"]

    group = school_client.post("/school/classes", headers=admin, json={
        "name": "Grade 10", "section": "A", "teacher_id": teacher_id,
    })
    assert group.status_code == 201
    class_id = group.json()["id"]
    assert group.json()["teacher_name"] == "Ada"

    assert school_client.post(f"/school/classes/{class_id}/students/2", headers=admin).status_code == 201
    assert school_client.post(f"/school/classes/{class_id}/students/2", headers=admin).status_code == 409
    roster = school_client.get(f"/school/classes/{class_id}/students", headers=admin)
    assert roster.json()[0]["full_name"] == "Learner"

    record = {"class_id": class_id, "student_id": 2, "school_date": "2026-10-27", "status": "present"}
    assert school_client.put("/school/attendance", headers=admin, json=record).status_code == 200
    record["status"] = "late"
    assert school_client.put("/school/attendance", headers=admin, json=record).status_code == 200
    saved = school_client.get(f"/school/attendance?class_id={class_id}&school_date=2026-10-27", headers=admin)
    assert len(saved.json()) == 1
    assert saved.json()[0]["status"] == "late"


def test_class_assessment_is_visible_only_to_enrolled_student(school_client):
    with school_client.session_factory() as db:
        exam = models.Exam(
            title="Class test", duration_minutes=30,
            start_time=datetime.now(), end_time=datetime.now() + timedelta(days=1),
        )
        db.add(exam)
        db.commit()
        db.refresh(exam)
        exam_id = exam.id
    admin = headers(1)
    group = school_client.post("/school/classes", headers=admin, json={"name": "Grade 10", "section": "A"})
    class_id = group.json()["id"]
    assigned = school_client.put("/school/assessments", headers=admin, json={"exam_id": exam_id, "class_id": class_id})
    assert assigned.status_code == 200
    assert school_client.get("/exams/available", headers=headers(2)).json() == []
    assert school_client.get(f"/exams/{exam_id}", headers=headers(2)).status_code == 403
    assert school_client.post(f"/school/classes/{class_id}/students/2", headers=admin).status_code == 201
    assert school_client.get("/exams/available", headers=headers(2)).json()[0]["id"] == exam_id
