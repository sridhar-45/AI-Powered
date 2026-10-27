"""Small school administration module alongside the assessment API."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app import auth, models
from app.database import get_db

router = APIRouter(prefix="/school", tags=["school"])


def require_admin(user: models.User = Depends(auth.get_current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Only admins can manage school records")
    return user


def require_exam_enrollment(db: Session, user: models.User, exam_id: int):
    """Keep existing unassigned exams public to students; scope assigned ones to a class."""
    if user.role == "admin":
        return
    assignment = db.query(models.SchoolAssessment).filter_by(exam_id=exam_id).first()
    if assignment and not db.query(models.Enrollment).filter_by(
        class_id=assignment.class_id, student_id=user.id
    ).first():
        raise HTTPException(403, "This exam is assigned to another class")


class TeacherInput(BaseModel):
    full_name: str = Field(min_length=1)
    email: EmailStr
    subject: str = Field(min_length=1)


class StudentInput(BaseModel):
    full_name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=8)


class ClassInput(BaseModel):
    name: str = Field(min_length=1)
    section: str = Field(min_length=1)
    teacher_id: int | None = None


class AttendanceInput(BaseModel):
    class_id: int
    student_id: int
    school_date: date
    status: str


class AssessmentAssignment(BaseModel):
    exam_id: int
    class_id: int


@router.get("/summary")
def summary(db: Session = Depends(get_db), _=Depends(require_admin)):
    return {
        "students": db.query(models.User).filter(models.User.role == "student").count(),
        "teachers": db.query(models.Teacher).count(),
        "classes": db.query(models.SchoolClass).count(),
        "present_today": db.query(models.Attendance).filter(
            models.Attendance.school_date == date.today().isoformat(),
            models.Attendance.status == "present",
        ).count(),
    }


@router.get("/teachers")
def teachers(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(models.Teacher).order_by(models.Teacher.full_name).all()


@router.post("/students", status_code=201)
def create_student(data: StudentInput, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(models.User).filter(models.User.email == data.email).first():
        raise HTTPException(409, "Email already registered")
    student = models.User(
        full_name=data.full_name,
        email=data.email,
        hashed_password=auth.hash_password(data.password),
        role="student",
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return {"id": student.id, "full_name": student.full_name, "email": student.email}


@router.post("/teachers", status_code=201)
def create_teacher(data: TeacherInput, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(models.Teacher).filter(models.Teacher.email == data.email).first():
        raise HTTPException(409, "Teacher email already exists")
    teacher = models.Teacher(**data.model_dump())
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


@router.delete("/teachers/{teacher_id}")
def delete_teacher(teacher_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    teacher = db.get(models.Teacher, teacher_id)
    if not teacher:
        raise HTTPException(404, "Teacher not found")
    db.query(models.SchoolClass).filter(models.SchoolClass.teacher_id == teacher_id).update({"teacher_id": None})
    db.delete(teacher)
    db.commit()
    return {"status": "deleted"}


def class_record(item, db):
    return {
        "id": item.id,
        "name": item.name,
        "section": item.section,
        "teacher_id": item.teacher_id,
        "teacher_name": item.teacher.full_name if item.teacher else None,
        "student_count": db.query(models.Enrollment).filter(models.Enrollment.class_id == item.id).count(),
    }


@router.get("/classes")
def classes(db: Session = Depends(get_db), _=Depends(require_admin)):
    return [class_record(item, db) for item in db.query(models.SchoolClass).order_by(models.SchoolClass.name).all()]


@router.post("/classes", status_code=201)
def create_class(data: ClassInput, db: Session = Depends(get_db), _=Depends(require_admin)):
    if data.teacher_id and not db.get(models.Teacher, data.teacher_id):
        raise HTTPException(404, "Teacher not found")
    item = models.SchoolClass(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return class_record(item, db)


@router.delete("/classes/{class_id}")
def delete_class(class_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    item = db.get(models.SchoolClass, class_id)
    if not item:
        raise HTTPException(404, "Class not found")
    db.query(models.Attendance).filter(models.Attendance.class_id == class_id).delete()
    db.query(models.Enrollment).filter(models.Enrollment.class_id == class_id).delete()
    db.query(models.SchoolAssessment).filter(models.SchoolAssessment.class_id == class_id).delete()
    db.delete(item)
    db.commit()
    return {"status": "deleted"}


@router.get("/classes/{class_id}/students")
def class_students(class_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not db.get(models.SchoolClass, class_id):
        raise HTTPException(404, "Class not found")
    students = db.query(models.User).join(models.Enrollment, models.Enrollment.student_id == models.User.id).filter(
        models.Enrollment.class_id == class_id, models.User.role == "student"
    ).order_by(models.User.full_name).all()
    return [{"id": student.id, "full_name": student.full_name, "email": student.email} for student in students]


@router.post("/classes/{class_id}/students/{student_id}", status_code=201)
def enroll(class_id: int, student_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not db.get(models.SchoolClass, class_id):
        raise HTTPException(404, "Class not found")
    student = db.get(models.User, student_id)
    if not student or student.role != "student":
        raise HTTPException(404, "Student not found")
    existing = db.query(models.Enrollment).filter_by(class_id=class_id, student_id=student_id).first()
    if existing:
        raise HTTPException(409, "Student already enrolled")
    db.add(models.Enrollment(class_id=class_id, student_id=student_id))
    db.commit()
    return {"status": "enrolled"}


@router.delete("/classes/{class_id}/students/{student_id}")
def unenroll(class_id: int, student_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    db.query(models.Attendance).filter_by(class_id=class_id, student_id=student_id).delete()
    count = db.query(models.Enrollment).filter_by(class_id=class_id, student_id=student_id).delete()
    db.commit()
    if not count:
        raise HTTPException(404, "Enrollment not found")
    return {"status": "unenrolled"}


@router.get("/attendance")
def attendance(class_id: int, school_date: date, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not db.get(models.SchoolClass, class_id):
        raise HTTPException(404, "Class not found")
    return db.query(models.Attendance).filter_by(class_id=class_id, school_date=school_date.isoformat()).all()


@router.put("/attendance")
def mark_attendance(data: AttendanceInput, db: Session = Depends(get_db), _=Depends(require_admin)):
    if data.status not in {"present", "absent", "late"}:
        raise HTTPException(422, "Status must be present, absent, or late")
    enrolled = db.query(models.Enrollment).filter_by(class_id=data.class_id, student_id=data.student_id).first()
    if not enrolled:
        raise HTTPException(404, "Student is not enrolled in this class")
    entry = db.query(models.Attendance).filter_by(
        class_id=data.class_id, student_id=data.student_id, school_date=data.school_date.isoformat()
    ).first()
    if not entry:
        entry = models.Attendance(class_id=data.class_id, student_id=data.student_id, school_date=data.school_date.isoformat())
        db.add(entry)
    entry.status = data.status
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/assessments")
def assessments(db: Session = Depends(get_db), _=Depends(require_admin)):
    assignments = db.query(models.SchoolAssessment).all()
    return [{"exam_id": item.exam_id, "class_id": item.class_id} for item in assignments]


@router.put("/assessments")
def assign_assessment(data: AssessmentAssignment, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not db.get(models.Exam, data.exam_id):
        raise HTTPException(404, "Exam not found")
    if not db.get(models.SchoolClass, data.class_id):
        raise HTTPException(404, "Class not found")
    item = db.query(models.SchoolAssessment).filter_by(exam_id=data.exam_id).first()
    if item:
        item.class_id = data.class_id
    else:
        item = models.SchoolAssessment(**data.model_dump())
        db.add(item)
    db.commit()
    return {"exam_id": item.exam_id, "class_id": item.class_id}


@router.delete("/assessments/{exam_id}")
def unassign_assessment(exam_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    deleted = db.query(models.SchoolAssessment).filter_by(exam_id=exam_id).delete()
    db.commit()
    if not deleted:
        raise HTTPException(404, "Assignment not found")
    return {"status": "unassigned"}
