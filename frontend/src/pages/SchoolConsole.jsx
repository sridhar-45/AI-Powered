import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiCall, removeToken } from "../utils/api";
import "./SchoolConsole.css";

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function SchoolConsole() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [user, setUser] = useState(null);
  const [summary, setSummary] = useState(null);
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [roster, setRoster] = useState([]);
  const [marks, setMarks] = useState({});
  const [date, setDate] = useState(today());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [teacherForm, setTeacherForm] = useState({ full_name: "", email: "", subject: "" });
  const [studentForm, setStudentForm] = useState({ full_name: "", email: "", password: "" });
  const [classForm, setClassForm] = useState({ name: "", section: "", teacher_id: "" });
  const [studentId, setStudentId] = useState("");

  async function refresh() {
    const profile = await apiCall("/auth/me");
    if (profile.role !== "admin") { navigate("/dashboard", { replace: true }); return; }
    const [stats, people, staff, groups] = await Promise.all([
      apiCall("/school/summary"), apiCall("/admin/students"),
      apiCall("/school/teachers"), apiCall("/school/classes"),
    ]);
    setUser(profile);
    setSummary(stats);
    setStudents(people);
    setTeachers(staff);
    setClasses(groups);
    setClassId(current => groups.some(group => String(group.id) === String(current)) ? current : (groups[0]?.id ?? ""));
  }

  useEffect(() => { refresh().catch(err => setError(err.message)); }, []);

  useEffect(() => {
    if (!classId) { setRoster([]); setMarks({}); return; }
    Promise.all([
      apiCall(`/school/classes/${classId}/students`),
      apiCall(`/school/attendance?class_id=${classId}&school_date=${date}`),
    ]).then(([people, attendance]) => {
      setRoster(people);
      setMarks(Object.fromEntries(attendance.map(item => [item.student_id, item.status])));
    }).catch(err => setError(err.message));
  }, [classId, date]);

  async function run(action, success) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refresh(); setNotice(success); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function addTeacher(event) {
    event.preventDefault();
    await run(() => apiCall("/school/teachers", "POST", teacherForm), "Teacher added.");
    setTeacherForm({ full_name: "", email: "", subject: "" });
  }
  async function addStudent(event) {
    event.preventDefault();
    await run(() => apiCall("/school/students", "POST", studentForm), "Student account created.");
    setStudentForm({ full_name: "", email: "", password: "" });
  }
  async function addClass(event) {
    event.preventDefault();
    await run(() => apiCall("/school/classes", "POST", {
      ...classForm, teacher_id: classForm.teacher_id ? Number(classForm.teacher_id) : null,
    }), "Class created.");
    setClassForm({ name: "", section: "", teacher_id: "" });
  }
  async function enroll(event) {
    event.preventDefault();
    if (!classId || !studentId) return;
    await run(() => apiCall(`/school/classes/${classId}/students/${studentId}`, "POST"), "Student enrolled.");
    setStudentId("");
    const people = await apiCall(`/school/classes/${classId}/students`);
    setRoster(people);
  }
  async function mark(student, status) {
    await run(() => apiCall("/school/attendance", "PUT", {
      class_id: Number(classId), student_id: student.id, school_date: date, status,
    }), `${student.full_name} marked ${status}.`);
    setMarks(previous => ({ ...previous, [student.id]: status }));
  }
  async function removeTeacher(teacher) {
    if (!window.confirm(`Remove ${teacher.full_name} from the teacher directory?`)) return;
    await run(() => apiCall(`/school/teachers/${teacher.id}`, "DELETE"), "Teacher removed.");
  }
  async function removeClass(group) {
    if (!window.confirm(`Delete ${group.name} ${group.section} and its attendance records?`)) return;
    await run(() => apiCall(`/school/classes/${group.id}`, "DELETE"), "Class removed.");
  }
  async function unenroll(student) {
    if (!window.confirm(`Remove ${student.full_name} from this class?`)) return;
    await run(() => apiCall(`/school/classes/${classId}/students/${student.id}`, "DELETE"), "Student removed from class.");
    setRoster(await apiCall(`/school/classes/${classId}/students`));
  }

  const menu = [
    ["overview", "Overview", "▦"], ["students", "Students", "◉"],
    ["teachers", "Teachers", "♙"], ["classes", "Classes", "▤"],
    ["attendance", "Attendance", "✓"], ["assessments", "Assessments", "◎"],
  ];
  const selectedClass = classes.find(item => String(item.id) === String(classId));
  const unassigned = students.filter(person => !roster.some(member => member.id === person.id));

  return <div className="school-shell">
    <aside className="school-sidebar">
      <Link className="school-brand" to="/school"><span className="school-brand-mark">S</span><span><strong>SchoolDesk</strong><small>ADMIN WORKSPACE</small></span></Link>
      <div className="school-nav-label">MANAGEMENT</div>
      <nav className="school-nav">{menu.map(([key, label, icon]) =>
        <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><span>{icon}</span>{label}</button>
      )}</nav>
      <div className="school-nav-label school-nav-label-gap">ASSESSMENTS</div>
      <Link className="school-side-link" to="/dashboard">↗ Exam dashboard</Link>
      <Link className="school-side-link" to="/admin/create-exam">＋ Create exam</Link>
      <div className="school-side-bottom"><div className="school-avatar">{user?.full_name?.[0] || "A"}</div><div><strong>{user?.full_name || "Administrator"}</strong><small>School administrator</small></div></div>
    </aside>
    <main className="school-main">
      <header className="school-topbar"><div><span className="school-breadcrumb">School management</span><span className="school-breadcrumb-sep">/</span><strong>{menu.find(item => item[0] === tab)?.[1]}</strong></div><button onClick={() => { removeToken(); navigate("/login"); }}>Sign out</button></header>
      <div className="school-content">
        {error && <div className="school-alert error">{error}</div>}
        {notice && <div className="school-alert success">{notice}</div>}
        {tab === "overview" && <>
          <div className="school-heading"><div><div className="school-kicker">SCHOOL OVERVIEW</div><h1>Good day, {user?.full_name?.split(" ")[0] || "Admin"}</h1><p>Keep your people, classes, and attendance in one place.</p></div><span className="school-date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span></div>
          <div className="school-stats">{[["Students", summary?.students, "◉", "blue"], ["Teachers", summary?.teachers, "♙", "violet"], ["Classes", summary?.classes, "▤", "orange"], ["Present today", summary?.present_today, "✓", "green"]].map(([label, value, icon, color]) => <div className="school-stat" key={label}><span className={`school-stat-icon ${color}`}>{icon}</span><strong>{value ?? "—"}</strong><span>{label}</span></div>)}</div>
          <div className="school-grid-two"><section className="school-card"><div className="school-section-title"><h2>Quick actions</h2><span>Start here</span></div><div className="school-actions">{[["Add a student", "students", "Create a student account"], ["Add a teacher", "teachers", "Build your staff directory"], ["Create a class", "classes", "Organize a new section"], ["Take attendance", "attendance", "Record today's roll call"]].map(([label, target, detail]) => <button key={label} onClick={() => setTab(target)}><span className="school-action-symbol">↗</span><span><strong>{label}</strong><small>{detail}</small></span></button>)}</div></section><section className="school-card"><div className="school-section-title"><h2>Classes</h2><button onClick={() => setTab("classes")}>View all →</button></div>{classes.length ? classes.slice(0, 5).map(group => <div className="school-class-preview" key={group.id}><span className="school-class-badge">{group.name.slice(0, 2).toUpperCase()}</span><span><strong>{group.name} · {group.section}</strong><small>{group.teacher_name || "Teacher not assigned"}</small></span><em>{group.student_count} students</em></div>) : <p className="school-empty">No classes yet. Create one to get started.</p>}</section></div>
        </>}
        {tab === "students" && <><PageHeading kicker="PEOPLE" title="Students" description="Create accounts and manage the student roster." count={students.length} /><section className="school-card"><h2>Add student</h2><form className="school-form" onSubmit={addStudent}><input required placeholder="Full name" value={studentForm.full_name} onChange={e => setStudentForm({ ...studentForm, full_name: e.target.value })} /><input required type="email" placeholder="Email address" value={studentForm.email} onChange={e => setStudentForm({ ...studentForm, email: e.target.value })} /><input required minLength="8" type="password" placeholder="Initial password (8+ characters)" value={studentForm.password} onChange={e => setStudentForm({ ...studentForm, password: e.target.value })} /><button disabled={busy}>Add student</button></form></section><section className="school-card"><div className="school-section-title"><h2>Student roster</h2><Link to="/admin/students">Exam actions →</Link></div><div className="school-table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Exam submissions</th></tr></thead><tbody>{students.map(student => <tr key={student.id}><td><strong>{student.full_name}</strong></td><td>{student.email}</td><td>{student.submission_count}</td></tr>)}</tbody></table></div>{!students.length && <p className="school-empty">No students found.</p>}</section></>}
        {tab === "teachers" && <><PageHeading kicker="PEOPLE" title="Teachers" description="Maintain the teaching staff directory." count={teachers.length} /><section className="school-card"><h2>Add teacher</h2><form className="school-form" onSubmit={addTeacher}><input required placeholder="Full name" value={teacherForm.full_name} onChange={e => setTeacherForm({ ...teacherForm, full_name: e.target.value })} /><input required type="email" placeholder="Email address" value={teacherForm.email} onChange={e => setTeacherForm({ ...teacherForm, email: e.target.value })} /><input required placeholder="Subject" value={teacherForm.subject} onChange={e => setTeacherForm({ ...teacherForm, subject: e.target.value })} /><button disabled={busy}>Add teacher</button></form></section><section className="school-card"><h2>Teacher directory</h2><div className="school-table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Subject</th><th></th></tr></thead><tbody>{teachers.map(teacher => <tr key={teacher.id}><td><strong>{teacher.full_name}</strong></td><td>{teacher.email}</td><td><span className="school-pill">{teacher.subject}</span></td><td><button className="school-text-danger" onClick={() => removeTeacher(teacher)}>Remove</button></td></tr>)}</tbody></table></div>{!teachers.length && <p className="school-empty">No teachers added yet.</p>}</section></>}
        {tab === "classes" && <><PageHeading kicker="ACADEMICS" title="Classes" description="Organize sections, assign teachers, and enroll students." count={classes.length} /><section className="school-card"><h2>Create class</h2><form className="school-form" onSubmit={addClass}><input required placeholder="Class name (e.g. Grade 10)" value={classForm.name} onChange={e => setClassForm({ ...classForm, name: e.target.value })} /><input required placeholder="Section (e.g. A)" value={classForm.section} onChange={e => setClassForm({ ...classForm, section: e.target.value })} /><select value={classForm.teacher_id} onChange={e => setClassForm({ ...classForm, teacher_id: e.target.value })}><option value="">No teacher assigned</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.full_name}</option>)}</select><button disabled={busy}>Create class</button></form></section><section className="school-card"><h2>All classes</h2><div className="school-table-wrap"><table><thead><tr><th>Class</th><th>Teacher</th><th>Students</th><th></th></tr></thead><tbody>{classes.map(group => <tr key={group.id}><td><strong>{group.name} · {group.section}</strong></td><td>{group.teacher_name || "Unassigned"}</td><td>{group.student_count}</td><td><button className="school-text-danger" onClick={() => removeClass(group)}>Remove</button></td></tr>)}</tbody></table></div>{!classes.length && <p className="school-empty">No classes created yet.</p>}</section><section className="school-card"><h2>Class enrollment</h2><ClassSelect classes={classes} value={classId} onChange={setClassId} /><form className="school-form school-enroll" onSubmit={enroll}><select required value={studentId} onChange={e => setStudentId(e.target.value)}><option value="">Select a student</option>{unassigned.map(student => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select><button disabled={!classId || busy}>Enroll student</button></form><div className="school-roster">{roster.map(student => <div key={student.id}><span>{student.full_name}<small>{student.email}</small></span><button className="school-text-danger" onClick={() => unenroll(student)}>Remove</button></div>)}{classId && !roster.length && <p className="school-empty">No students enrolled in this class.</p>}</div></section></>}
        {tab === "assessments" && <SchoolAssessments classes={classes} />}
        {tab === "attendance" && <><PageHeading kicker="DAILY RECORDS" title="Attendance" description="Mark present, absent, or late for each enrolled student." /><section className="school-card"><div className="school-attendance-controls"><ClassSelect classes={classes} value={classId} onChange={setClassId} /><label>Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div><div className="school-section-title"><h2>{selectedClass ? `${selectedClass.name} · ${selectedClass.section}` : "Choose a class"}</h2><span>{roster.length} enrolled</span></div><div className="school-attendance-list">{roster.map(student => <div key={student.id}><span className="school-student-icon">{student.full_name[0]}</span><span className="school-attendance-name"><strong>{student.full_name}</strong><small>{student.email}</small></span><div className="school-mark-buttons">{["present", "absent", "late"].map(status => <button key={status} disabled={busy} className={marks[student.id] === status ? `chosen ${status}` : ""} onClick={() => mark(student, status)}>{status}</button>)}</div></div>)}{!roster.length && <p className="school-empty">Select a class with enrolled students to take attendance.</p>}</div></section></>}
      </div>
    </main>
  </div>;
}

function PageHeading({ kicker, title, description, count }) {
  return <div className="school-heading"><div><div className="school-kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div>{count !== undefined && <span className="school-count">{count} total</span>}</div>;
}

function ClassSelect({ classes, value, onChange }) {
  return <label className="school-select-label">Class <select value={value} onChange={e => onChange(e.target.value)}><option value="">Select class</option>{classes.map(group => <option key={group.id} value={group.id}>{group.name} · {group.section}</option>)}</select></label>;
}

function SchoolAssessments({ classes }) {
  const [exams, setExams] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selected, setSelected] = useState({ exam_id: "", class_id: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function refresh() {
    const [examRows, assignedRows] = await Promise.all([apiCall("/exams/available"), apiCall("/school/assessments")]);
    setExams(examRows); setAssignments(assignedRows);
  }
  useEffect(() => { refresh().catch(err => setError(err.message)); }, []);
  async function assign(event) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      await apiCall("/school/assessments", "PUT", { exam_id: Number(selected.exam_id), class_id: Number(selected.class_id) });
      await refresh(); setNotice("Assessment assigned to class.");
    } catch (err) { setError(err.message); }
  }
  async function unassign(examId) {
    setError(""); setNotice("");
    try { await apiCall(`/school/assessments/${examId}`, "DELETE"); await refresh(); setNotice("Class assignment removed."); }
    catch (err) { setError(err.message); }
  }
  return <><PageHeading kicker="ASSESSMENTS" title="Class assessments" description="Assign exams to a class so only enrolled students can open them." count={exams.length} />
    {error && <div className="school-alert error">{error}</div>}{notice && <div className="school-alert success">{notice}</div>}
    <section className="school-card"><h2>Assign an exam</h2><form className="school-form" onSubmit={assign}>
      <select required value={selected.exam_id} onChange={e => setSelected({ ...selected, exam_id: e.target.value })}><option value="">Select exam</option>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select>
      <select required value={selected.class_id} onChange={e => setSelected({ ...selected, class_id: e.target.value })}><option value="">Select class</option>{classes.map(group => <option key={group.id} value={group.id}>{group.name} · {group.section}</option>)}</select>
      <button disabled={!classes.length || !exams.length}>Save assignment</button>
    </form></section>
    <section className="school-card"><h2>Exam access</h2><div className="school-table-wrap"><table><thead><tr><th>Exam</th><th>Class access</th><th>Questions</th><th></th></tr></thead><tbody>{exams.map(exam => {
      const assignment = assignments.find(item => item.exam_id === exam.id);
      const group = classes.find(item => item.id === assignment?.class_id);
      return <tr key={exam.id}><td><strong>{exam.title}</strong></td><td>{group ? `${group.name} · ${group.section}` : "All students"}</td><td>{exam.questions.length}</td><td>{assignment && <button className="school-text-danger" onClick={() => unassign(exam.id)}>Remove assignment</button>}</td></tr>;
    })}</tbody></table></div>{!exams.length && <p className="school-empty">No exams yet. Create one from the exam dashboard.</p>}</section>
  </>;
}
