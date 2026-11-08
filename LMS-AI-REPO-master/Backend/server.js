const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { askFlowise } = require('./services/flowise');

const app = express();
// ngrok/TLS terminates in front of this server. Trust its forwarded protocol so
// Office for the web receives the public HTTPS document URL, not localhost/HTTP.
app.set('trust proxy', 1);
//app.use(cors());
   app.use(cors({
       origin: '*',
       credentials: true
   }));
app.use(express.json());

const chatbotIdentitySecret = process.env.CHATBOT_IDENTITY_SECRET;
const defaultGoogleClientId = '27578574110-v92r0hvooifo6qrk903j06gp4bqoslm0.apps.googleusercontent.com';
const configuredGoogleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClientId = /^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(configuredGoogleClientId)
  ? configuredGoogleClientId
  : defaultGoogleClientId;
const googleAuthClient = new OAuth2Client(googleClientId);

function createAuthToken(user) {
  if (!chatbotIdentitySecret) {
    throw new Error('CHATBOT_IDENTITY_SECRET is not configured.');
  }

  return jwt.sign({
    user_id: user.student_id,
    email: user.email,
    name: user.name,
    role: user.role,
  }, chatbotIdentitySecret, { expiresIn: '1h' });
}

function requireAuthenticatedUser(req, res, next) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.user = jwt.verify(token, chatbotIdentitySecret);
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireAdminUser(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Super Admin access is required.' });
}

app.get('/api/chatbase-token', requireAuthenticatedUser, (req, res) => {
  if (!chatbotIdentitySecret) {
    return res.status(500).json({ error: 'Chatbot identity is not configured.' });
  }

  const token = jwt.sign(
    {
      user_id: req.user.user_id,
      email: req.user.email,
      name: req.user.name,
    },
    chatbotIdentitySecret,
    { expiresIn: '1h' }
  );

  return res.json({ token });
});

app.post('/api/chat', async (req, res) => {
  const chatInput = String(req.body?.message || req.body?.chatInput || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();

  if (!chatInput || !sessionId) {
    return res.status(400).json({ error: 'A chat message and session ID are required.' });
  }

  try {
    // Keep the LMS chat input identical to the direct Flowise prompt. Adding
    // the signed-in user's LMS role here can make the model interpret the
    // role tag as a persona instruction and answer as a teacher/dean/student.
    const output = await askFlowise(chatInput, sessionId);
    return res.json({ output });
  } catch (error) {
    console.error('Flowise chat error:', error.message);
    return res.status(502).json({ error: 'Unable to reach the AI assistant.' });
  }
});

// Expose non-sensitive public config to the frontend (e.g. Google Client ID).
// This avoids hardcoding secrets in frontend source files.
app.get('/api/config', (_req, res) => {
  res.json({
    googleClientId,
  });
});

// Serve the reorganized frontend assets.
app.use(express.static(path.join(__dirname, '../Frontend')));

// Load the frontend entry point at http://localhost:5000.
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../Frontend/index.html'));
});

// Vercel's deployment bundle is read-only. /tmp is writable but ephemeral, so
// production uploads must move to persistent object storage before launch.
const uploadDir = process.env.UPLOAD_DIR || (process.env.VERCEL
  ? path.join('/tmp', 'imcc-lms-uploads')
  : path.join(__dirname, 'uploads'));
fs.mkdirSync(uploadDir, { recursive: true });
const flowiseUploadDir = process.env.FLOWISE_UPLOAD_DIR || (process.env.VERCEL
  ? path.join('/tmp', 'imcc-lms-flowise-uploads')
  : path.join(__dirname, '..', '..', 'FlowiseApp', 'uploadss'));
fs.mkdirSync(flowiseUploadDir, { recursive: true });
// Keep previously extracted lesson text available after changing its destination.
for (const filename of fs.readdirSync(uploadDir).filter((name) => name.toLowerCase().endsWith('.txt'))) {
  const legacyTextPath = path.join(uploadDir, filename);
  const flowiseTextPath = path.join(flowiseUploadDir, filename);
  if (!fs.existsSync(flowiseTextPath)) fs.copyFileSync(legacyTextPath, flowiseTextPath);
}
const permittedUploadExtensions = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.zip']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!permittedUploadExtensions.has(extension)) {
      return callback(new Error('Unsupported file type. Use PDF, DOC/DOCX, PPT/PPTX, PNG, or ZIP.'));
    }
    return callback(null, true);
  },
});
app.use('/uploads', express.static(uploadDir));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured for the Supabase database connection.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});
// ==========================================
// SUPER ADMIN: CREATE USER ACCOUNT WITH PASSWORD
// ==========================================
app.post('/api/admin/create-user', async (req, res) => {
  const { student_id, name, email, role, password } = req.body;

  if (!student_id || !name || !email || !role || !password) {
    return res.status(400).json({ error: 'All fields are required (including default password).' });
  }

  try {
    const query = `
      INSERT INTO students (student_id, name, email, role, password)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE
      SET student_id = $1, name = $2, role = $4, password = $5;
    `;

    await pool.query(query, [student_id, name, email.toLowerCase(), role, password]);
    return res.json({
      message: `Account created successfully for ${name} (${role.toUpperCase()})!`,
    });
  } catch (err) {
    console.error('Database Insert Error:', err);
    return res.status(500).json({ error: 'Failed to create account in database.' });
  }
});

// ==========================================
// SUPER ADMIN: FETCH ALL REGISTERED ACCOUNTS
// ==========================================
app.get('/api/admin/users', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT student_id, name, email, role FROM students ORDER BY role ASC, name ASC'
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('Fetch Users Error:', err);
    return res.status(500).json({ error: 'Failed to retrieve account records.' });
  }
});

// ==========================================
// DIRECT USER/ADMIN LOGIN (EMAIL & PASSWORD)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT student_id, name, email, role, password FROM students WHERE LOWER(email) = $1 OR LOWER(student_id::text) = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const user = result.rows[0];
    // Simple password check. Replace with bcrypt.compare before production use.
    if (user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    return res.json({
      message: 'Login successful',
      user: {
        student_id: user.student_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      authToken: createAuthToken(user),
    });
  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ error: 'Server connection error.' });
  }
});

// Verify Google's ID token before using profile information or assigning a role.
app.post('/api/auth/google', async (req, res) => {
  const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
  if (!credential) return res.status(400).json({ error: 'Google credential is required.' });

  try {
    const ticket = await googleAuthClient.verifyIdToken({ idToken: credential, audience: googleClientId });
    const profile = ticket.getPayload();
    const email = String(profile?.email || '').trim().toLowerCase();
    const name = String(profile?.name || '').trim();

    if (!profile?.email_verified || !email.endsWith('@imcc.edu.ph')) {
      return res.status(403).json({ error: 'Please use your verified IMCC school account (@imcc.edu.ph).' });
    }

    let result = await pool.query('SELECT student_id, name, email, role FROM students WHERE LOWER(email) = $1', [email]);
    let user = result.rows[0];
    const sid = email.split('@')[0];
    const normalizedIdentifier = sid.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedStoredName = String(user?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedGoogleName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hasPlaceholderName = !normalizedStoredName || normalizedStoredName === normalizedIdentifier;

    // Pre-assigned accounts initially use the email prefix as a placeholder name.
    // Replace only that placeholder with the institutional Google profile name; a
    // name intentionally entered by an administrator is never overwritten.
    if (user && name && hasPlaceholderName && normalizedGoogleName !== normalizedIdentifier) {
      const updated = await pool.query(
        'UPDATE students SET name = $1 WHERE LOWER(email) = $2 RETURNING student_id, name, email, role',
        [name, email]
      );
      user = updated.rows[0];
    }

    if (!user) {
      const role = 'student';
      const inserted = await pool.query(
        `INSERT INTO students (student_id, name, email, role, password)
         VALUES ($1, $2, $3, $4, 'google-sso')
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING student_id, name, email, role`,
        [sid, name || sid, email, role]
      );
      user = inserted.rows[0];
    }
    const authToken = createAuthToken(user);
    return res.json({ message: 'Signed in with Google.', authToken, user });
  } catch (error) {
    console.error('Google sign-in error:', error.message);
    return res.status(401).json({ error: 'Google sign-in could not be verified.' });
  }
});

// SUPER ADMIN ROLE REGISTRAR: pre-assign an institutional email to a role.
// The user signs in with Google later; no LMS password is created or needed.
app.post('/api/admin/assign-role', requireAuthenticatedUser, requireAdminUser, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  let role = String(req.body?.role || 'student').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();

  if (!email.endsWith('@imcc.edu.ph')) {
    return res.status(400).json({ error: 'Only IMCC institutional emails (@imcc.edu.ph) can be assigned.' });
  }
  if (role === 'instructor') role = 'teacher';
  if (!['dean', 'teacher', 'student', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  try {
    const found = await pool.query(
      'SELECT student_id FROM students WHERE LOWER(email) = $1',
      [email]
    );

    if (found.rowCount > 0) {
      await pool.query(
        `UPDATE students
         SET role = $1, name = COALESCE(NULLIF($2, ''), name)
         WHERE LOWER(email) = $3`,
        [role, name, email]
      );
      return res.json({ message: `Role updated: ${email} is now ${role}.` });
    }

    const studentId = email.split('@')[0];
    await pool.query(
      `INSERT INTO students (student_id, name, email, role, password)
       VALUES ($1, $2, $3, $4, 'google-sso')
       ON CONFLICT (email) DO UPDATE
       SET role = EXCLUDED.role, name = COALESCE(NULLIF(EXCLUDED.name, ''), students.name)`,
      [studentId, name || studentId, email, role]
    );
    return res.json({ message: `Account registered: ${email} is assigned as ${role}. They can now sign in with Google.` });
  } catch (error) {
    console.error('Assign role error:', error.message);
    return res.status(500).json({ error: 'Failed to assign role.' });
  }
});

// ==========================================
// DIRECT SUPER ADMIN LOGIN (BYPASSES GOOGLE)
// ==========================================
app.post('/api/auth/admin-login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT student_id, name, email, role, password FROM students WHERE LOWER(email) = $1 AND role = $2',
      [email.toLowerCase(), 'admin']
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid Admin email or unauthorized role.' });
    }

    const adminUser = result.rows[0];

    // Simple password check. Replace with bcrypt.compare before production use.
    if (adminUser.password !== password) {
      return res.status(401).json({ error: 'Incorrect admin password.' });
    }

    return res.json({
      message: 'Admin authentication successful',
      user: {
        student_id: adminUser.student_id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      },
      authToken: createAuthToken(adminUser),
    });
  } catch (err) {
    console.error('Admin Login Error:', err);
    return res.status(500).json({ error: 'Server connection error.' });
  }
});

// Auto-create the standalone classwork table when the backend starts.
const classworkSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS classwork (
    work_id SERIAL PRIMARY KEY,
    course_id INT,
    type VARCHAR(50),
    title VARCHAR(255),
    description TEXT,
    document_path TEXT,
    due_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`)
  .then(() => Promise.all([
    pool.query('ALTER TABLE classwork ADD COLUMN IF NOT EXISTS description TEXT'),
    pool.query('ALTER TABLE classwork ADD COLUMN IF NOT EXISTS due_date TIMESTAMP'),
  ]))
  .then(() => console.log('Classwork table is ready!'))
  .catch((error) => console.error('Error creating classwork table:', error));

// Keep track of both the assigned instructor and the dean who created a course.
// An instructor assignment can change, so it must not be used as the dean owner.
const courseSchemaReady = pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS teacher_id INTEGER')
  .then(() => Promise.all([
  // LMS account IDs may be institutional IDs containing letters.  Preserve
  // them exactly instead of coercing them to an integer.
  pool.query('ALTER TABLE courses ALTER COLUMN teacher_id TYPE VARCHAR(50) USING teacher_id::text'),
  pool.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS created_by VARCHAR(50)'),
  ]));
courseSchemaReady.catch((error) => console.error('Error preparing course ownership:', error));

const classCreationRequestsSchemaReady = courseSchemaReady.then(() => pool.query(`
  CREATE TABLE IF NOT EXISTS class_creation_requests (
    request_id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    course_name VARCHAR(255),
    course_code VARCHAR(30),
    year_level VARCHAR(80),
    instructor_name VARCHAR(255),
    instructor_id VARCHAR(50) NOT NULL,
    section VARCHAR(100),
    subject_notes TEXT,
    submitted_by VARCHAR(50) NOT NULL,
    dean_id VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMPTZ,
    course_id INT REFERENCES courses(course_id) ON DELETE SET NULL
  )
`).then(() => pool.query('CREATE INDEX IF NOT EXISTS class_creation_requests_dean_status_idx ON class_creation_requests (dean_id, status, requested_at DESC)')));
classCreationRequestsSchemaReady.catch((error) => console.error('Error preparing class creation requests:', error));

const classJoinRequestsSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS class_join_requests (
    request_id SERIAL PRIMARY KEY,
    course_id INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    student_id VARCHAR(50) NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, student_id)
  );
`).then(() => pool.query('CREATE INDEX IF NOT EXISTS class_join_requests_course_idx ON class_join_requests (course_id, requested_at)'));
classJoinRequestsSchemaReady.catch((error) => console.error('Error preparing class join requests:', error));

const gradeNotificationsSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS grade_notifications (
    grade_notification_id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) NOT NULL,
    assignment_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`).then(() => Promise.all([
  pool.query('CREATE INDEX IF NOT EXISTS grade_notifications_student_idx ON grade_notifications (student_id, created_at DESC)'),
  pool.query('DROP INDEX IF EXISTS grade_notifications_student_assignment_uidx'),
]));
gradeNotificationsSchemaReady.catch((error) => console.error('Error preparing grade notifications:', error));

const courseActivityNotificationsSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS course_activity_notifications (
    notification_id SERIAL PRIMARY KEY,
    student_id VARCHAR(50) NOT NULL,
    course_id INT REFERENCES courses(course_id) ON DELETE CASCADE,
    activity_type VARCHAR(32) NOT NULL,
    source_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, activity_type, source_id)
  )
`).then(() => pool.query('CREATE INDEX IF NOT EXISTS course_activity_notifications_student_idx ON course_activity_notifications (student_id, created_at DESC)'));
courseActivityNotificationsSchemaReady.catch((error) => console.error('Error preparing course activity notifications:', error.message));

const dismissedNotificationsSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS dismissed_notifications (
    student_id VARCHAR(50) NOT NULL,
    notification_id TEXT NOT NULL,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, notification_id)
  )
`).catch((error) => console.error('Error preparing dismissed notifications:', error.message));

async function notifyStudentsOfCourseActivity({ courseId = null, activityType, sourceId, title, contentTitle }) {
  try {
    await courseActivityNotificationsSchemaReady;
    let courseTitle = '';
    if (courseId) {
      const courseResult = await pool.query('SELECT title FROM courses WHERE course_id = $1', [courseId]);
      courseTitle = String(courseResult.rows[0]?.title || 'your class');
    }
    const message = courseId
      ? `${contentTitle} was added to ${courseTitle}.`
      : `${contentTitle} was added to the school calendar.`;
    if (courseId) {
      await pool.query(
        `INSERT INTO course_activity_notifications
          (student_id, course_id, activity_type, source_id, title, message)
         SELECT student.student_id::text, $1, $2, $3, $4, $5
         FROM enrollments enrollment
         JOIN students student ON student.student_id::text = enrollment.student_id::text
         WHERE enrollment.course_id = $1 AND LOWER(student.role) = 'student'
         ON CONFLICT (student_id, activity_type, source_id) DO NOTHING`,
        [courseId, activityType, sourceId, title, message]
      );
    } else {
      await pool.query(
        `INSERT INTO course_activity_notifications
          (student_id, course_id, activity_type, source_id, title, message)
         SELECT student_id::text, NULL, $1, $2, $3, $4
         FROM students WHERE LOWER(role) = 'student'
         ON CONFLICT (student_id, activity_type, source_id) DO NOTHING`,
        [activityType, sourceId, title, message]
      );
    }
  } catch (error) {
    console.error('Unable to create student activity notifications:', error.message);
  }
}

const classCommentsSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS class_comments (
    comment_id SERIAL PRIMARY KEY,
    course_id INT NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    author_id VARCHAR(50) NOT NULL,
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)
  .then(async () => {
    await pool.query(`ALTER TABLE class_comments
      ADD COLUMN IF NOT EXISTS work_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS work_id INT`);
    await pool.query('CREATE INDEX IF NOT EXISTS class_comments_work_idx ON class_comments (course_id, work_type, work_id, created_at)');
    console.log('Class comments table is ready!');
  })
  .catch((error) => console.error('Error preparing class comments:', error));

// Auto-create submissions table on startup
const submissionsSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS submissions (
    submission_id SERIAL PRIMARY KEY,
    work_id INT REFERENCES classwork(work_id) ON DELETE CASCADE,
    student_id VARCHAR(50) NOT NULL,
    answer_text TEXT,
    file_path TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(work_id, student_id)
  );
`)
  .then(() => console.log('Submissions table is ready!'))
  .catch((err) => console.error('Error preparing submissions:', err));

// Submissions for the class_assignments records used by the class-work UI.
const assignmentSubmissionSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS assignment_submissions (
    submission_id SERIAL PRIMARY KEY,
    assignment_id INT NOT NULL REFERENCES class_assignments(assignment_id) ON DELETE CASCADE,
    student_id VARCHAR(50) NOT NULL,
    file_path TEXT,
    file_name TEXT,
    score SMALLINT CHECK (score BETWEEN 0 AND 100),
    feedback TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(assignment_id, student_id)
  );
`)
  .then(() => Promise.all([
    pool.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS score SMALLINT'),
    pool.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS feedback TEXT'),
    pool.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS submission_url TEXT'),
    pool.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS submission_kind VARCHAR(20)'),
  ]))
  .then(() => console.log('Assignment submissions table is ready!'))
  .catch((err) => console.error('Error preparing assignment submissions:', err));

// Test Database Connection on startup
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Database connection failed:', err.stack);
  }
  console.log('✅ Successfully connected to PostgreSQL database!');
  release();
});

// GET: Notification Summary Counts & Full Notifications List
app.get('/api/notifications/dashboard', async (req, res) => {
  try {
    const userId = String(req.query.user_id || '').trim();
    const activeClassesCount = await pool.query('SELECT COUNT(*) FROM courses');
    const assignmentsDueCount = await pool.query(
      "SELECT COUNT(*) FROM class_assignments WHERE due_date >= NOW() AND due_date <= NOW() + INTERVAL '7 days'"
    );
    const resourcesCount = await pool.query('SELECT COUNT(*) FROM class_materials');

    let priorityAlerts = [];
    let systemAlerts = [];

    try {
      priorityAlerts = (await pool.query(
        "SELECT * FROM notifications WHERE category = 'priority' ORDER BY created_at DESC"
      )).rows;
      systemAlerts = (await pool.query(
        "SELECT * FROM notifications WHERE category = 'system' ORDER BY created_at DESC"
      )).rows;
    } catch (alertError) {
      console.warn('Notification alerts table is not available yet, returning an empty alert list.');
    }

    if (userId) {
      await gradeNotificationsSchemaReady;
      const gradeAlerts = await pool.query(
        `SELECT 'grade-' || notification.grade_notification_id::text AS notification_id,
                notification.title,
                'Your ' || COALESCE(assignment.title, 'activity or quiz') || ' has been graded.' AS message,
                notification.created_at
         FROM grade_notifications notification
         LEFT JOIN class_assignments assignment ON assignment.assignment_id = notification.assignment_id
         WHERE notification.student_id::text = $1::text
         UNION ALL
         SELECT 'graded-assignment-' || submission.assignment_id::text || '-' || submission.student_id AS notification_id,
                'Your work has been graded' AS title,
                'Your ' || COALESCE(assignment.title, 'activity or quiz') || ' has been graded.' AS message,
                submission.submitted_at AS created_at
         FROM assignment_submissions submission
         INNER JOIN class_assignments assignment ON assignment.assignment_id = submission.assignment_id
         WHERE submission.student_id::text = $1::text
           AND submission.score IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM grade_notifications notification
             WHERE notification.student_id::text = submission.student_id::text
               AND notification.assignment_id = submission.assignment_id
           )
         ORDER BY created_at DESC`,
        [userId]
      );
      priorityAlerts = [...gradeAlerts.rows, ...priorityAlerts];

      try {
        await courseActivityNotificationsSchemaReady;
        const activityAlerts = await pool.query(
          `SELECT 'activity-' || notification.notification_id::text AS notification_id,
                  notification.title,
                  notification.message,
                  notification.created_at
           FROM course_activity_notifications notification
           WHERE notification.student_id::text = $1::text
           ORDER BY notification.created_at DESC`,
          [userId]
        );
        systemAlerts = [...activityAlerts.rows, ...systemAlerts];
      } catch (activityError) {
        console.warn('Course activity notifications are not available:', activityError.message);
      }

      await dismissedNotificationsSchemaReady;
      const dismissedResult = await pool.query(
        'SELECT notification_id FROM dismissed_notifications WHERE student_id::text = $1::text',
        [userId]
      );
      const dismissedIds = new Set(dismissedResult.rows.map((row) => String(row.notification_id)));
      const notificationKey = (item, group) => String(
        item.notification_id ?? item.id ?? `${group}:${item.title || ''}:${item.created_at || ''}`
      );
      priorityAlerts = priorityAlerts.filter((item) => !dismissedIds.has(notificationKey(item, 'priority')));
      systemAlerts = systemAlerts.filter((item) => !dismissedIds.has(notificationKey(item, 'system')));
    }

    res.json({
      summary: {
        activeClasses: parseInt(activeClassesCount.rows[0].count) || 0,
        assignmentsDue: parseInt(assignmentsDueCount.rows[0].count) || 0,
        events: 4,
        resources: parseInt(resourcesCount.rows[0].count) || 0,
      },
      priorityAlerts,
      systemAlerts,
    });
  } catch (err) {
    console.error('Error fetching notification dashboard:', err);
    res.status(500).json({ error: 'Failed to load notifications dashboard' });
  }
});

app.delete('/api/notifications/:notificationId', async (req, res) => {
  const userId = String(req.body?.user_id || '').trim();
  const notificationId = String(req.params.notificationId || '').trim();
  if (!userId || !notificationId || notificationId.length > 255) {
    return res.status(400).json({ error: 'A valid user and notification are required.' });
  }
  try {
    await dismissedNotificationsSchemaReady;
    await pool.query(
      `INSERT INTO dismissed_notifications (student_id, notification_id)
       VALUES ($1, $2) ON CONFLICT (student_id, notification_id) DO NOTHING`,
      [userId, notificationId]
    );
    return res.json({ message: 'Notification deleted.' });
  } catch (error) {
    console.error('Error deleting notification:', error.message);
    return res.status(500).json({ error: 'Failed to delete notification.' });
  }
});

// GET /api/dashboard/:studentId
app.get('/api/dashboard/:studentId', async (req, res) => {
  const { studentId } = req.params;

  try {
    // 1. Fetch Student Info
    const studentQuery = await pool.query(
      'SELECT first_name, academic_year, year_level FROM students WHERE student_id = $1',
      [studentId]
    );

    // 2. Count Active Enrolled Classes
    const classesCount = await pool.query(
      'SELECT COUNT(*) FROM enrollments WHERE student_id = $1',
      [studentId]
    );

    // 3. Count Pending Assignments
    const assignmentsCount = await pool.query(
      `SELECT COUNT(*) FROM assignments a 
       JOIN enrollments e ON a.course_id = e.course_id 
       WHERE e.student_id = $1 AND a.is_submitted = FALSE`,
      [studentId]
    );

    // 4. Count Events
    const eventsCount = await pool.query('SELECT COUNT(*) FROM events');

    // 5. Fetch Hero Banner Data
    const heroQuery = await pool.query(
      `SELECT c.title, l.sub_text 
       FROM lessons l 
       JOIN courses c ON l.course_id = c.course_id 
       WHERE l.is_hero_featured = TRUE LIMIT 1`
    );

    // 6. Fetch Enrolled Courses list
    const coursesQuery = await pool.query(
      `SELECT c.course_id, c.code, c.title, c.class_code, c.status,
              COALESCE(l.sub_text, 'Active session') AS sub_text
       FROM courses c 
       JOIN enrollments e ON c.course_id = e.course_id 
       LEFT JOIN lessons l ON c.course_id = l.course_id 
       WHERE e.student_id = $1 
       ORDER BY c.course_id ASC`,
      [studentId]
    );

    res.json({
      student: studentQuery.rows[0] || {
        first_name: 'Student',
        academic_year: 'AY 2025-2026',
        year_level: 'BSIT',
      },
      stats: {
        activeClasses: parseInt(classesCount.rows[0].count),
        assignmentsDue: parseInt(assignmentsCount.rows[0].count),
        events: parseInt(eventsCount.rows[0].count),
      },
      hero: heroQuery.rows[0] || {
        title: 'WEB SYSTEMS & TECHNOLOGIES',
        sub_text: 'Review the lesson notes.',
      },
      courses: coursesQuery.rows,
    });

  } catch (err) {
    // THIS LOG WILL SHOW US EXACTLY WHAT IS WRONG IN THE TERMINAL
    console.error('❌ SERVER ERROR DETAILS:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/classes/unenroll
app.delete('/api/classes/unenroll', async (req, res) => {
  const { studentId, courseId } = req.body;

  if (!Number.isInteger(studentId) || !Number.isInteger(courseId)) {
    return res.status(400).json({ error: 'A valid student ID and course ID are required.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM enrollments WHERE student_id = $1 AND course_id = $2',
      [studentId, courseId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Enrollment not found.' });
    }

    res.json({ success: true, message: 'Successfully unenrolled from class.' });
  } catch (error) {
    console.error('Error unenrolling:', error.message);
    res.status(500).json({ error: 'Server error while unenrolling.' });
  }
});

// DELETE /api/classes/:courseId
app.delete('/api/classes/:courseId', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const teacherId = String(req.query.teacher_id || '').trim();

  if (!Number.isInteger(courseId) || !teacherId) {
    return res.status(400).json({ error: 'A valid course ID and teacher ID are required.' });
  }

  let client;

  try {
    await courseSchemaReady;
    client = await pool.connect();
    await client.query('BEGIN');
    const ownerResult = await client.query(
      'SELECT course_id FROM courses WHERE course_id = $1 FOR UPDATE',
      [courseId]
    );
    if (ownerResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Class not found.' });
    }
    const actorResult = await client.query(
      'SELECT role FROM students WHERE student_id::text = $1 LIMIT 1',
      [teacherId]
    );
    const actorRole = String(actorResult.rows[0]?.role || '').toLowerCase();
    if (actorRole !== 'dean') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only a dean can delete a class.' });
    }
    await client.query('DELETE FROM enrollments WHERE course_id = $1', [courseId]);
    await client.query('DELETE FROM lessons WHERE course_id = $1', [courseId]);
    const result = await client.query('DELETE FROM courses WHERE course_id = $1', [courseId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Class not found.' });
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Class deleted successfully.' });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Error deleting class:', error.message);
    res.status(500).json({ error: 'Server error while deleting class.' });
  } finally {
    client?.release();
  }
});

// Student-friendly alias: removes only this student's enrollment.
app.post('/api/courses/unenroll', async (req, res) => {
  const courseId = Number.parseInt(req.body?.course_id, 10);
  const studentId = String(req.body?.student_id || '').trim();

  if (!Number.isInteger(courseId) || !studentId) {
    return res.status(400).json({ error: 'A valid course ID and student ID are required.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM enrollments WHERE course_id = $1 AND student_id::text = $2::text',
      [courseId, studentId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Enrollment not found.' });
    return res.json({ message: 'Unenrolled successfully.' });
  } catch (error) {
    console.error('Error unenrolling student:', error.message);
    return res.status(500).json({ error: 'Failed to unenroll from class.' });
  }
});

// Instructor-only enrollment removal. This removes one student without deleting the class.
app.delete('/api/courses/:courseId/students/:studentId', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  // Institutional student IDs can contain letters (for example, fcp33530),
  // so preserve the identifier instead of coercing it to a number.
  const studentId = String(req.params.studentId || '').trim();
  const teacherId = String(req.query.teacher_id || '').trim();

  if (!Number.isInteger(courseId) || !studentId || !teacherId) {
    return res.status(400).json({ error: 'A valid course ID, student ID, and teacher ID are required.' });
  }

  try {
    await courseSchemaReady;
    const ownerResult = await pool.query(
      'SELECT teacher_id, created_by FROM courses WHERE course_id = $1',
      [courseId]
    );
    if (ownerResult.rowCount === 0) return res.status(404).json({ error: 'Class not found.' });
    const actorResult = await pool.query(
      'SELECT role FROM students WHERE student_id::text = $1::text',
      [teacherId]
    );
    const actorRole = String(actorResult.rows[0]?.role || '').toLowerCase();
    const isAssignedInstructor = String(ownerResult.rows[0].teacher_id || '') === teacherId;
    const isClassCreator = String(ownerResult.rows[0].created_by || '') === teacherId;
    const canManageClass = ['teacher', 'instructor', 'dean'].includes(actorRole) && (isAssignedInstructor || isClassCreator);
    if (!canManageClass) {
      return res.status(403).json({ error: 'Only the assigned instructor or class dean can remove students.' });
    }

    const result = await pool.query(
      'DELETE FROM enrollments WHERE course_id = $1 AND student_id = $2',
      [courseId, studentId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Student enrollment not found.' });
    return res.json({ message: 'Student removed from class.' });
  } catch (error) {
    console.error('Error removing student:', error.message);
    return res.status(500).json({ error: 'Failed to remove student from class.' });
  }
});

function generateClassCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';

  for (let index = 0; index < 6; index += 1) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return code;
}

async function createClassHandler(req, res) {
  const {
    title,
    course,
    courseCode,
    yearLevel,
    instructor,
    section,
    subText,
    teacherId,
    createdBy,
  } = req.body;

  const trimmedTitle = title?.trim();
  const trimmedCourse = course?.trim();
  const trimmedCourseCode = courseCode?.trim();
  const trimmedYearLevel = yearLevel?.trim();
  const trimmedInstructor = instructor?.trim();
  const trimmedSection = section?.trim();
  const trimmedSubText = subText?.trim();
  const assignedTeacherId = String(teacherId || '').trim();
  const creatorId = String(createdBy || '').trim();

  if (!trimmedTitle) {
    return res.status(400).json({ error: 'Class title is required.' });
  }

  let client;

  try {
    await courseSchemaReady;
    const creatorRoleResult = creatorId
      ? await pool.query('SELECT role FROM students WHERE student_id::text = $1', [creatorId])
      : { rows: [] };
    if (String(creatorRoleResult.rows[0]?.role || '').toLowerCase() !== 'dean') {
      return res.status(403).json({ error: 'Only a dean can directly create a class. Instructors must submit it for approval.' });
    }
    client = await pool.connect();
    let generatedClassCode = generateClassCode();
    let existingCode = await client.query(
      'SELECT 1 FROM courses WHERE class_code = $1',
      [generatedClassCode]
    );

    while (existingCode.rowCount > 0) {
      generatedClassCode = generateClassCode();
      existingCode = await client.query(
        'SELECT 1 FROM courses WHERE class_code = $1',
        [generatedClassCode]
      );
    }

    await client.query('BEGIN');

    const normalizedCourseCode = trimmedCourseCode
      ? trimmedCourseCode.slice(0, 12).toUpperCase()
      : trimmedCourse
        ? trimmedCourse.slice(0, 12).toUpperCase()
        : trimmedTitle.slice(0, 3).toUpperCase();

    const metadataText = [
      trimmedCourse || trimmedTitle,
      trimmedCourseCode || normalizedCourseCode,
      trimmedYearLevel,
      trimmedInstructor || 'Instructor not set',
      trimmedSection,
    ].filter(Boolean).join(' • ');

    const lessonText = [metadataText, trimmedSubText].filter(Boolean).join(' | ');

    const courseResult = await client.query(
      `INSERT INTO courses (code, title, class_code, status, teacher_id, created_by)
       VALUES ($1, $2, $3, 'Active', $4, $5)
       RETURNING *`,
      // Creating a class only creates the class record.  Students (and staff
      // joining another class) are added to enrollments exclusively through
      // the join endpoints.  An omitted instructor must remain unassigned;
      // never fall back to a real account such as ID 1.
      [normalizedCourseCode, trimmedTitle, generatedClassCode,
        assignedTeacherId || null,
        creatorId || null]
    );
    const courseRecord = courseResult.rows[0];

    if (lessonText) {
      await client.query(
        'INSERT INTO lessons (course_id, sub_text) VALUES ($1, $2)',
        [courseRecord.course_id, lessonText]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: 'Class created successfully!',
      classCode: generatedClassCode,
      courseCode: normalizedCourseCode,
      course: courseRecord,
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Error creating class:', error.message);
    res.status(500).json({ error: 'Server error while creating class.' });
  } finally {
    client?.release();
  }
}

// POST /api/classes/create
app.post('/api/classes/create', createClassHandler);

// Optional alias for the front-end course form flow
app.post('/api/courses', createClassHandler);

// Instructors submit class details to a specific dean for approval.
app.post('/api/classes/requests', async (req, res) => {
  const teacherId = String(req.body?.teacherId || '').trim();
  const deanId = String(req.body?.deanId || '').trim();
  const title = String(req.body?.title || '').trim();
  if (!teacherId || !deanId || !title) {
    return res.status(400).json({ error: 'Class name and dean approval are required.' });
  }

  try {
    await classCreationRequestsSchemaReady;
    const [teacherResult, deanResult] = await Promise.all([
      pool.query('SELECT student_id, name, role FROM students WHERE student_id::text = $1', [teacherId]),
      pool.query('SELECT student_id, role FROM students WHERE student_id::text = $1', [deanId]),
    ]);
    const teacher = teacherResult.rows[0];
    const dean = deanResult.rows[0];
    if (!teacher || !['teacher', 'instructor'].includes(String(teacher.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Only an instructor can submit a class request.' });
    }
    if (!dean || String(dean.role || '').toLowerCase() !== 'dean') {
      return res.status(400).json({ error: 'Select a valid dean to approve this class.' });
    }

    const result = await pool.query(
      `INSERT INTO class_creation_requests
        (title, course_name, course_code, year_level, instructor_name, instructor_id, section, subject_notes, submitted_by, dean_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6, $9)
       RETURNING request_id, status, requested_at`,
      [title, String(req.body?.course || '').trim(), String(req.body?.courseCode || '').trim(),
        String(req.body?.yearLevel || '').trim(), String(teacher.name || '').trim(), teacherId,
        String(req.body?.section || '').trim(), String(req.body?.subText || '').trim(), deanId]
    );
    return res.status(201).json({ success: true, message: 'Class request sent to the selected dean for approval.', request: result.rows[0] });
  } catch (error) {
    console.error('Class creation request error:', error.message);
    return res.status(500).json({ error: 'Unable to submit the class request.' });
  }
});

app.get('/api/classes/requests', async (req, res) => {
  const deanId = String(req.query?.dean_id || '').trim();
  if (!deanId) return res.status(400).json({ error: 'A dean ID is required.' });
  try {
    await classCreationRequestsSchemaReady;
    const deanResult = await pool.query("SELECT 1 FROM students WHERE student_id::text = $1 AND LOWER(role) = 'dean'", [deanId]);
    if (!deanResult.rowCount) return res.status(403).json({ error: 'Only a dean can review class requests.' });
    const result = await pool.query(
      `SELECT r.*, COALESCE(NULLIF(TRIM(teacher.name), ''), r.instructor_name) AS submitted_by_name
       FROM class_creation_requests r
       LEFT JOIN students teacher ON teacher.student_id::text = r.submitted_by::text
       WHERE r.dean_id::text = $1 AND r.status = 'pending'
       ORDER BY r.requested_at ASC`,
      [deanId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Class requests load error:', error.message);
    return res.status(500).json({ error: 'Unable to load class requests.' });
  }
});

app.post('/api/classes/requests/:requestId/approve', async (req, res) => {
  const requestId = Number.parseInt(req.params.requestId, 10);
  const deanId = String(req.body?.deanId || '').trim();
  if (!Number.isInteger(requestId) || requestId <= 0 || !deanId) {
    return res.status(400).json({ error: 'A valid request and dean are required.' });
  }

  let client;
  try {
    await classCreationRequestsSchemaReady;
    client = await pool.connect();
    await client.query('BEGIN');
    const deanResult = await client.query("SELECT 1 FROM students WHERE student_id::text = $1 AND LOWER(role) = 'dean'", [deanId]);
    if (!deanResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only a dean can approve a class request.' });
    }
    const requestResult = await client.query(
      `SELECT * FROM class_creation_requests
       WHERE request_id = $1 AND dean_id::text = $2 AND status = 'pending'
       FOR UPDATE`,
      [requestId, deanId]
    );
    if (!requestResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending class request not found.' });
    }
    const request = requestResult.rows[0];
    const normalizedCode = String(request.course_code || request.course_name || request.title).slice(0, 12).toUpperCase();
    const metadata = [request.course_name || request.title, normalizedCode, request.year_level, request.instructor_name || 'Instructor not set', request.section]
      .filter(Boolean).join(' â€¢ ');
    const lessonText = [metadata, request.subject_notes].filter(Boolean).join(' | ');
    let classCode = generateClassCode();
    let codeExists = await client.query('SELECT 1 FROM courses WHERE class_code = $1', [classCode]);
    while (codeExists.rowCount) {
      classCode = generateClassCode();
      codeExists = await client.query('SELECT 1 FROM courses WHERE class_code = $1', [classCode]);
    }
    const courseResult = await client.query(
      `INSERT INTO courses (code, title, class_code, status, teacher_id, created_by)
       VALUES ($1, $2, $3, 'Active', $4, $5) RETURNING *`,
      [normalizedCode, request.title, classCode, request.instructor_id, deanId]
    );
    const course = courseResult.rows[0];
    if (lessonText) await client.query('INSERT INTO lessons (course_id, sub_text) VALUES ($1, $2)', [course.course_id, lessonText]);
    await client.query(
      `UPDATE class_creation_requests SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, course_id = $2 WHERE request_id = $1`,
      [requestId, course.course_id]
    );
    await client.query('COMMIT');
    return res.json({ success: true, message: 'Class request approved and class created.', course, classCode });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('Class request approval error:', error.message);
    return res.status(500).json({ error: 'Unable to approve the class request.' });
  } finally {
    client?.release();
  }
});

// GET /api/courses?role=dean|teacher|student&user_id=1
// Deans see only the classes they created; teachers see assigned and joined
// classes; students see joined classes. Administrators retain the global view.
app.get('/api/courses', async (req, res) => {
  const role = String(req.query.role || 'student').toLowerCase();
  const userId = String(req.query.user_id || '').trim();

  if (!userId) {
    return res.status(400).json({ error: 'A valid user ID is required.' });
  }

  try {
    await courseSchemaReady;
    if (role === 'admin' || role === 'superadmin') {
      const result = await pool.query(
        `SELECT c.*, COALESCE(l.sub_text, '') AS sub_text,
                COALESCE(NULLIF(TRIM(instructor.name), ''), '') AS instructor_name
         FROM courses c
         LEFT JOIN lessons l ON l.course_id = c.course_id
         LEFT JOIN students instructor ON instructor.student_id::text = c.teacher_id::text
         ORDER BY c.course_id DESC`
      );
      return res.json(result.rows);
    }

    if (role === 'dean') {
      const result = await pool.query(
        `SELECT c.*, COALESCE(l.sub_text, '') AS sub_text,
                COALESCE(NULLIF(TRIM(instructor.name), ''), '') AS instructor_name
         FROM courses c
         LEFT JOIN lessons l ON l.course_id = c.course_id
         LEFT JOIN students instructor ON instructor.student_id::text = c.teacher_id::text
         WHERE c.created_by::text = $1::text
         ORDER BY c.course_id DESC`,
        [userId]
      );
      return res.json(result.rows);
    }

    if (role === 'teacher' || role === 'instructor') {
      const result = await pool.query(
        `SELECT c.*, COALESCE(l.sub_text, '') AS sub_text,
                COALESCE(NULLIF(TRIM(instructor.name), ''), '') AS instructor_name
         FROM courses c
         LEFT JOIN lessons l ON l.course_id = c.course_id
         LEFT JOIN students instructor ON instructor.student_id::text = c.teacher_id::text
         WHERE c.teacher_id::text = $1::text
            OR c.course_id IN (
              SELECT e.course_id FROM enrollments e WHERE e.student_id::text = $2
            )
         ORDER BY c.course_id DESC`,
        [userId, userId]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(
      `SELECT c.*, COALESCE(l.sub_text, '') AS sub_text,
              COALESCE(NULLIF(TRIM(instructor.name), ''), '') AS instructor_name
       FROM courses c
       LEFT JOIN lessons l ON l.course_id = c.course_id
       LEFT JOIN students instructor ON instructor.student_id::text = c.teacher_id::text
       WHERE c.course_id IN (
         SELECT e.course_id FROM enrollments e WHERE e.student_id::text = $1
       )
       ORDER BY c.course_id DESC`,
      [userId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Courses load error:', error.message);
    return res.status(500).json({ error: 'Unable to load classes.' });
  }
});

// GET ASSIGNMENTS (Task, Activity, Quiz ONLY — Safe SQL Join)
// GET ASSIGNMENTS (Instructor Focus)
async function getClassCardManager(courseId, userId) {
  const result = await pool.query(
    `SELECT c.teacher_id, c.created_by, s.role
     FROM courses c CROSS JOIN students s
     WHERE c.course_id = $1 AND s.student_id::text = $2::text`,
    [courseId, userId]
  );
  const record = result.rows[0];
  if (!record) return null;
  const role = String(record.role || '').toLowerCase();
  return {
    ...record,
    role,
    isDeanOwner: role === 'dean' && String(record.created_by || '') === userId,
    isAssignedInstructor: ['teacher', 'instructor'].includes(role) && String(record.teacher_id || '') === userId,
  };
}

app.put('/api/courses/:courseId', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const userId = String(req.body?.userId || '').trim();
  const title = String(req.body?.title || '').trim();
  if (!Number.isInteger(courseId) || courseId <= 0 || !userId || !title) {
    return res.status(400).json({ error: 'A valid class and class name are required.' });
  }
  try {
    await courseSchemaReady;
    const manager = await getClassCardManager(courseId, userId);
    if (!manager?.isDeanOwner && !manager?.isAssignedInstructor) {
      return res.status(403).json({ error: 'Only the class dean or assigned instructor can edit this class.' });
    }
    const courseName = String(req.body?.courseName || '').trim();
    const courseCode = String(req.body?.courseCode || '').trim().slice(0, 12).toUpperCase();
    const yearLevel = String(req.body?.yearLevel || '').trim();
    const instructor = String(req.body?.instructor || '').trim();
    const section = String(req.body?.section || '').trim();
    const subjectNotes = String(req.body?.subjectNotes || '').trim();
    const normalizedCode = courseCode || courseName.slice(0, 12).toUpperCase() || title.slice(0, 12).toUpperCase();
    const metadata = [courseName || title, normalizedCode, yearLevel, instructor || 'Instructor not set', section]
      .filter(Boolean).join(' \u2022 ');
    const lessonText = [metadata, subjectNotes].filter(Boolean).join(' | ');
    await pool.query('UPDATE courses SET title = $2, code = $3 WHERE course_id = $1', [courseId, title, normalizedCode]);
    const lessonResult = await pool.query('UPDATE lessons SET sub_text = $2 WHERE course_id = $1', [courseId, lessonText]);
    if (!lessonResult.rowCount) await pool.query('INSERT INTO lessons (course_id, sub_text) VALUES ($1, $2)', [courseId, lessonText]);
    return res.json({ success: true, message: 'Class information updated.' });
  } catch (error) {
    console.error('Class update error:', error.message);
    return res.status(500).json({ error: 'Unable to update this class.' });
  }
});

app.patch('/api/courses/:courseId/status', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const userId = String(req.body?.userId || '').trim();
  const status = String(req.body?.status || '').toLowerCase() === 'archived' ? 'Archived' : 'Active';
  if (!Number.isInteger(courseId) || courseId <= 0 || !userId) {
    return res.status(400).json({ error: 'A valid class and user are required.' });
  }
  try {
    await courseSchemaReady;
    const manager = await getClassCardManager(courseId, userId);
    if (!manager?.isDeanOwner && !manager?.isAssignedInstructor) {
      return res.status(403).json({ error: 'Only the class dean or assigned instructor can change its status.' });
    }
    await pool.query('UPDATE courses SET status = $2 WHERE course_id = $1', [courseId, status]);
    return res.json({ success: true, status });
  } catch (error) {
    console.error('Class status update error:', error.message);
    return res.status(500).json({ error: 'Unable to update class status.' });
  }
});

app.post('/api/courses/:courseId/staff-unenroll', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const userId = String(req.body?.userId || '').trim();
  if (!Number.isInteger(courseId) || courseId <= 0 || !userId) {
    return res.status(400).json({ error: 'A valid class and user are required.' });
  }
  try {
    await courseSchemaReady;
    const manager = await getClassCardManager(courseId, userId);
    if (manager?.isDeanOwner) {
      await pool.query('UPDATE courses SET created_by = NULL WHERE course_id = $1', [courseId]);
    } else if (manager?.isAssignedInstructor) {
      await pool.query('UPDATE courses SET teacher_id = NULL WHERE course_id = $1', [courseId]);
      await pool.query('DELETE FROM enrollments WHERE course_id = $1 AND student_id::text = $2::text', [courseId, userId]);
    } else if (manager && ['teacher', 'instructor'].includes(manager.role)) {
      const result = await pool.query('DELETE FROM enrollments WHERE course_id = $1 AND student_id::text = $2::text', [courseId, userId]);
      if (!result.rowCount) return res.status(403).json({ error: 'You are not enrolled in this class.' });
    } else {
      return res.status(403).json({ error: 'Only the class dean or an enrolled instructor can unenroll.' });
    }
    return res.json({ success: true, message: 'Class removed from your classes.' });
  } catch (error) {
    console.error('Staff unenroll error:', error.message);
    return res.status(500).json({ error: 'Unable to unenroll from this class.' });
  }
});

app.get('/api/courses/:courseId/comments', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const workType = String(req.query.work_type || '');
  const workId = Number.parseInt(req.query.work_id, 10);
  const workTables = {
    materials: { table: 'class_materials', idColumn: 'material_id' },
    assignments: { table: 'class_assignments', idColumn: 'assignment_id' },
  };
  const workTable = workTables[workType];
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'A valid course ID is required.' });
  if (!workTable || !Number.isInteger(workId)) return res.status(400).json({ error: 'A valid lesson, activity, or quiz is required.' });

  try {
    await classCommentsSchemaReady;
    const workResult = await pool.query(
      `SELECT course_id FROM ${workTable.table} WHERE ${workTable.idColumn} = $1`,
      [workId]
    );
    if (!workResult.rows[0] || Number(workResult.rows[0].course_id) !== courseId) {
      return res.status(404).json({ error: 'That class work item was not found.' });
    }
    const result = await pool.query(
      `SELECT cc.comment_id, cc.course_id, cc.author_id, cc.content, cc.created_at,
              COALESCE(NULLIF(TRIM(s.name), ''), cc.author_id::text) AS author_name
       FROM class_comments cc
       LEFT JOIN students s ON s.student_id::text = cc.author_id::text
       WHERE cc.course_id = $1 AND cc.work_type = $2 AND cc.work_id = $3
       ORDER BY cc.created_at ASC, cc.comment_id ASC`,
      [courseId, workType, workId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Error loading class comments:', error.message);
    return res.status(500).json({ error: 'Unable to load class comments.' });
  }
});

// All signed-in LMS roles can participate in a class discussion.  We validate
// the author against the LMS account table rather than requiring a short-lived
// chatbot token, which caused otherwise signed-in users to receive "Unauthorized".
app.post('/api/courses/:courseId/comments', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const content = String(req.body?.content || '').trim();
  const authorId = String(req.body?.author_id || '').trim();
  const workType = String(req.body?.work_type || '');
  const workId = Number.parseInt(req.body?.work_id, 10);
  const workTables = {
    materials: { table: 'class_materials', idColumn: 'material_id' },
    assignments: { table: 'class_assignments', idColumn: 'assignment_id' },
  };
  const workTable = workTables[workType];
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'A valid course ID is required.' });
  if (!workTable || !Number.isInteger(workId)) return res.status(400).json({ error: 'A valid lesson, activity, or quiz is required.' });
  if (!content || content.length > 1000) return res.status(400).json({ error: 'Comments must be between 1 and 1,000 characters.' });
  if (!authorId) return res.status(401).json({ error: 'Please sign in before posting a comment.' });

  try {
    await classCommentsSchemaReady;
    const workResult = await pool.query(
      `SELECT course_id FROM ${workTable.table} WHERE ${workTable.idColumn} = $1`,
      [workId]
    );
    if (!workResult.rows[0] || Number(workResult.rows[0].course_id) !== courseId) {
      return res.status(404).json({ error: 'That class work item was not found.' });
    }
    const authorResult = await pool.query(
      `SELECT student_id, name, email, role
       FROM students
       WHERE student_id::text = $1
       LIMIT 1`,
      [authorId]
    );
    const author = authorResult.rows[0];
    const role = String(author?.role || '').toLowerCase().replace(/\s+/g, '');
    if (!author || !['student', 'teacher', 'instructor', 'dean', 'admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: 'Your LMS account is not allowed to post class comments.' });
    }
    const result = await pool.query(
      `INSERT INTO class_comments (course_id, author_id, content, work_type, work_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING comment_id, course_id, author_id, content, created_at`,
      [courseId, String(author.student_id), content, workType, workId]
    );
    return res.status(201).json({
      ...result.rows[0],
      author_name: author.name || author.email || String(author.student_id),
    });
  } catch (error) {
    console.error('Error posting class comment:', error.message);
    return res.status(500).json({ error: 'Unable to post the comment.' });
  }
});

app.get('/api/assignments', assignmentsPageHandler);

// POST: Add an Activity, Task, or Quiz inside a class.
app.post('/api/classwork', upload.single('file'), async (req, res) => {
  const { course_id: courseId, title, type, description, due_date: dueDate } = req.body;
  const filePath = req.file ? `/uploads/${req.file.filename}` : null;

  if (!Number.isInteger(Number.parseInt(courseId, 10)) || !String(title || '').trim()) {
    return res.status(400).json({ error: 'A valid course and title are required.' });
  }

  try {
    if (req.file) await translateForAI(req.file.path);
    await classworkSchemaReady;
    const result = await pool.query(
      `INSERT INTO classwork (course_id, title, type, description, document_path, due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [Number.parseInt(courseId, 10), title.trim(), type || 'Activity', description || '', filePath, dueDate || null]
    );

    const activityType = String(type || 'Activity').toLowerCase();
    await notifyStudentsOfCourseActivity({
      courseId: Number.parseInt(courseId, 10),
      activityType: `classwork_${activityType}`,
      sourceId: result.rows[0].work_id,
      title: `New ${String(type || 'activity').toLowerCase()} posted`,
      contentTitle: `New ${String(type || 'activity').toLowerCase()} “${title.trim()}”`
    });

    return res.status(201).json({ message: 'Activity created successfully!', classwork: result.rows[0] });
  } catch (err) {
    console.error('Error creating classwork:', err);
    return res.status(500).json({ error: 'Failed to create activity' });
  }
});

app.post('/api/submissions', upload.single('file'), async (req, res) => {
  const assignmentId = Number.parseInt(req.body?.work_id, 10);
  const studentId = Number.parseInt(req.body?.student_id, 10);
  const answerText = String(req.body?.answer_text || '').trim();
  const filePath = req.file ? `/uploads/${req.file.filename}` : null;

  if (!Number.isInteger(assignmentId) || !Number.isInteger(studentId) || (!answerText && !filePath)) {
    return res.status(400).json({ error: 'Provide a valid assignment, student, and answer or attachment.' });
  }

  try {
    await submissionsSchemaReady;
    const enrollment = await pool.query(
      `SELECT 1 FROM class_assignments a
       JOIN enrollments e ON e.course_id = a.course_id
       WHERE a.assignment_id = $1 AND e.student_id = $2`,
      [assignmentId, studentId]
    );
    if (enrollment.rowCount === 0) return res.status(403).json({ error: 'You are not enrolled in this assignment’s class.' });

    const result = await pool.query(
      `INSERT INTO submissions (assignment_id, student_id, answer_text, file_path)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET answer_text = EXCLUDED.answer_text,
                     file_path = COALESCE(EXCLUDED.file_path, submissions.file_path),
                     submitted_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [assignmentId, studentId, answerText, filePath]
    );
    return res.json({ message: 'Submission saved successfully!', data: result.rows[0] });
  } catch (error) {
    console.error('Error saving submission:', error.message);
    return res.status(500).json({ error: 'Failed to submit assignment.' });
  }
});

// Save a student's file for a class assignment.
app.post('/api/assignments/:assignmentId/submission', upload.single('file'), async (req, res) => {
  const assignmentId = Number.parseInt(req.params.assignmentId, 10);
  const studentId = String(req.body?.student_id || '').trim();
  const submissionUrl = String(req.body?.submission_url || '').trim();
  const submissionKind = req.file ? 'file' : String(req.body?.submission_kind || '');
  const submittedFileName = req.file ? req.file.originalname : String(req.body?.file_name || '').trim();

  if (!Number.isInteger(assignmentId) || !studentId || (!req.file && !submissionUrl)) {
    return res.status(400).json({ error: 'An assignment, student, and file or link are required.' });
  }
  if (submissionUrl.length > 2000) return res.status(400).json({ error: 'The submitted link is too long.' });
  if (!req.file && submissionKind === 'link') {
    const isInternalPath = submissionUrl.startsWith('/') && !submissionUrl.startsWith('//');
    let parsedUrl = null;
    try { parsedUrl = new URL(submissionUrl); } catch (_) { /* Internal LMS paths are allowed. */ }
    if (!isInternalPath && (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol))) {
      return res.status(400).json({ error: 'Provide an internal LMS path or a valid http:// or https:// link.' });
    }
  }
  if (!req.file && submissionKind !== 'link') {
    return res.status(400).json({ error: 'Choose a supported submission type.' });
  }
  if (!submittedFileName || submittedFileName.length > 200) {
    return res.status(400).json({ error: 'Add a title of 1 to 200 characters for your submitted work.' });
  }

  try {
    await assignmentSubmissionSchemaReady;
    const enrollment = await pool.query(
      `SELECT 1 FROM class_assignments a
       JOIN enrollments e ON e.course_id = a.course_id
       WHERE a.assignment_id = $1 AND e.student_id = $2`,
      [assignmentId, studentId]
    );
    if (enrollment.rowCount === 0) return res.status(403).json({ error: 'You are not enrolled in this assignment’s class.' });

    const result = await pool.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, file_path, file_name, submission_url, submission_kind)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET file_path = EXCLUDED.file_path,
                     file_name = EXCLUDED.file_name,
                     submission_url = EXCLUDED.submission_url,
                     submission_kind = EXCLUDED.submission_kind,
                     submitted_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [assignmentId, studentId, req.file ? `/uploads/${req.file.filename}` : null, submittedFileName, req.file ? null : submissionUrl, submissionKind]
    );
    return res.json({ message: 'Submission saved successfully.', submission: result.rows[0] });
  } catch (error) {
    console.error('Error saving assignment submission:', error.message);
    return res.status(500).json({ error: 'Failed to submit assignment.' });
  }
});

app.delete('/api/assignments/:assignmentId/submission', async (req, res) => {
  const assignmentId = Number.parseInt(req.params.assignmentId, 10);
  const studentId = String(req.query.student_id || '').trim();
  if (!Number.isInteger(assignmentId) || !studentId) {
    return res.status(400).json({ error: 'An assignment and student are required.' });
  }

  try {
    await assignmentSubmissionSchemaReady;
    await pool.query(
      'DELETE FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2',
      [assignmentId, studentId]
    );
    return res.json({ message: 'Submission removed.' });
  } catch (error) {
    console.error('Error removing assignment submission:', error.message);
    return res.status(500).json({ error: 'Failed to unsubmit assignment.' });
  }
});

// Instructor and dean class views use this to review submitted files.
app.get('/api/assignments/:assignmentId/submissions', async (req, res) => {
  const assignmentId = Number.parseInt(req.params.assignmentId, 10);
  if (!Number.isInteger(assignmentId)) return res.status(400).json({ error: 'A valid assignment is required.' });

  try {
    await assignmentSubmissionSchemaReady;
    const result = await pool.query(
      `SELECT student_id, file_name, file_path, submission_url, submission_kind, score, feedback, submitted_at
       FROM assignment_submissions
       WHERE assignment_id = $1
       ORDER BY submitted_at DESC`,
      [assignmentId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Error loading assignment submissions:', error.message);
    return res.status(500).json({ error: 'Failed to load submissions.' });
  }
});

app.get('/api/assignments/:assignmentId/submission', async (req, res) => {
  const assignmentId = Number.parseInt(req.params.assignmentId, 10);
  const studentId = String(req.query.student_id || '').trim();
  if (!Number.isInteger(assignmentId) || !studentId) {
    return res.status(400).json({ error: 'An assignment and student are required.' });
  }

  try {
    await assignmentSubmissionSchemaReady;
    const result = await pool.query(
      `SELECT file_name, file_path, submission_url, submission_kind, score, feedback, submitted_at
       FROM assignment_submissions
       WHERE assignment_id = $1 AND student_id = $2`,
      [assignmentId, studentId]
    );
    return res.json({ submission: result.rows[0] || null });
  } catch (error) {
    console.error('Error loading student submission:', error.message);
    return res.status(500).json({ error: 'Failed to load submission.' });
  }
});

app.post('/api/assignments/:assignmentId/submissions/:studentId/grade', async (req, res) => {
  const assignmentId = Number.parseInt(req.params.assignmentId, 10);
  const studentId = String(req.params.studentId || '').trim();
  const score = Number(req.body?.score);
  const feedback = String(req.body?.feedback || '').trim();

  if (!Number.isInteger(assignmentId) || !studentId || !Number.isInteger(score) || score < 0) {
    return res.status(400).json({ error: 'Provide a non-negative whole-number score.' });
  }

  try {
    await gradeNotificationsSchemaReady;
    await assignmentSubmissionSchemaReady;
    const assignmentResult = await pool.query(
      'SELECT total_points, title FROM class_assignments WHERE assignment_id = $1',
      [assignmentId]
    );
    if (assignmentResult.rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' });

    const totalPoints = Number(assignmentResult.rows[0].total_points);
    const maxScore = Number.isFinite(totalPoints) ? totalPoints : 100;
    if (score > maxScore) return res.status(400).json({ error: `Provide a score from 0 to ${maxScore}.` });

    const result = await pool.query(
      `UPDATE assignment_submissions
       SET score = $3, feedback = $4
       WHERE assignment_id = $1 AND student_id = $2
       RETURNING student_id, file_name, file_path, score, feedback, submitted_at`,
      [assignmentId, studentId, score, feedback || null]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Submission not found.' });
    const assignmentTitle = String(assignmentResult.rows[0].title || 'Activity or quiz');
    const notificationMessage = `Your ${assignmentTitle} has been graded.`;
    await pool.query(
      `INSERT INTO grade_notifications (student_id, assignment_id, title, message)
       VALUES ($1, $2, $3, $4)
      `,
      [studentId, assignmentId, 'Your work has been graded', notificationMessage]
    );
    return res.json({ message: 'Grade saved.', submission: result.rows[0] });
  } catch (error) {
    console.error('Error saving grade:', error.message);
    return res.status(500).json({ error: 'Failed to save grade.' });
  }
});

// POST /api/classes/join
app.post('/api/classes/join', async (req, res) => {
  const studentId = String(req.body?.studentId || '').trim();
  const { classCode } = req.body;
  const normalizedCode = classCode?.trim().toUpperCase();

  if (!studentId || !normalizedCode) {
    return res.status(400).json({ error: 'Student ID and class code are required.' });
  }

  try {
    await classJoinRequestsSchemaReady;
    const courseResult = await pool.query(
      'SELECT course_id, title FROM courses WHERE UPPER(class_code) = $1',
      [normalizedCode]
    );

    if (courseResult.rowCount === 0) {
      return res.status(404).json({ error: 'Invalid class code. No class was found.' });
    }

    const course = courseResult.rows[0];
    const existingEnrollment = await pool.query(
      'SELECT enrollment_id FROM enrollments WHERE student_id = $1 AND course_id = $2',
      [studentId, course.course_id]
    );

    if (existingEnrollment.rowCount > 0) {
      return res.status(409).json({ error: `You are already enrolled in "${course.title}".` });
    }

    const existingRequest = await pool.query(
      'SELECT request_id FROM class_join_requests WHERE student_id = $1 AND course_id = $2',
      [studentId, course.course_id]
    );
    if (existingRequest.rowCount > 0) return res.status(409).json({ error: 'Your request to join this class is awaiting instructor approval.' });
    await pool.query('INSERT INTO class_join_requests (student_id, course_id) VALUES ($1, $2)', [studentId, course.course_id]);

    res.status(202).json({
      success: true,
      message: `Your request to join "${course.title}" was sent to the instructor for approval.`,
      course,
    });
  } catch (error) {
    console.error('Error joining class:', error.message);
    res.status(500).json({ error: 'Server error while attempting to join class.' });
  }
});

// Alias for the role-based dashboard flow. The existing /api/classes/join
// endpoint remains available for compatibility with the current modal.
app.post('/api/courses/join', async (req, res) => {
  const studentId = String(req.body?.student_id || '').trim();
  const normalizedCode = String(req.body?.class_code || '').trim().toUpperCase();

  if (!studentId || !normalizedCode) {
    return res.status(400).json({ error: 'Student ID and class code are required.' });
  }

  try {
    await classJoinRequestsSchemaReady;
    const courseResult = await pool.query(
      'SELECT course_id, title FROM courses WHERE UPPER(class_code) = $1',
      [normalizedCode]
    );
    if (courseResult.rowCount === 0) {
      return res.status(404).json({ error: 'Invalid class code. No class was found.' });
    }

    const course = courseResult.rows[0];
    const enrollmentResult = await pool.query(
      'SELECT enrollment_id FROM enrollments WHERE student_id = $1 AND course_id = $2',
      [studentId, course.course_id]
    );
    if (enrollmentResult.rowCount > 0) return res.status(409).json({ error: `You are already enrolled in "${course.title}".` });
    const pendingResult = await pool.query('SELECT request_id FROM class_join_requests WHERE student_id = $1 AND course_id = $2', [studentId, course.course_id]);
    if (pendingResult.rowCount > 0) return res.status(409).json({ error: 'Your request to join this class is awaiting instructor approval.' });
    await pool.query('INSERT INTO class_join_requests (student_id, course_id) VALUES ($1, $2)', [studentId, course.course_id]);
    return res.status(202).json({ message: `Your request to join "${course.title}" was sent to the instructor for approval.`, course });
  } catch (error) {
    console.error('Error joining class:', error.message);
    return res.status(500).json({ error: 'Server error while attempting to join class.' });
  }
});

// GET /api/courses/:courseId/members
// A lightweight roster for the class-members control. Grades remain available
// only from the separate class-record endpoint.
app.get('/api/courses/:courseId/members', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const actorId = String(req.query.user_id || '').trim();
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'A valid course ID is required.' });

  try {
    await classJoinRequestsSchemaReady;
    const result = await pool.query(
      `SELECT e.student_id,
              COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(s.first_name), ''), 'Student #' || e.student_id::text) AS student_name,
              s.year_level
       FROM enrollments e
       LEFT JOIN students s ON s.student_id::text = e.student_id::text
       WHERE e.course_id = $1
         AND COALESCE(LOWER(TRIM(s.role)), 'student') = 'student'
       ORDER BY student_name`,
      [courseId]
    );
    let requests = [];
    if (actorId) {
      await courseSchemaReady;
      const [courseResult, actorResult] = await Promise.all([
        pool.query('SELECT teacher_id, created_by FROM courses WHERE course_id = $1', [courseId]),
        pool.query('SELECT role FROM students WHERE student_id::text = $1::text', [actorId]),
      ]);
      const course = courseResult.rows[0];
      const role = String(actorResult.rows[0]?.role || '').toLowerCase();
      const staffRole = ['teacher', 'instructor', 'dean'].includes(role);
      const assigned = String(course?.teacher_id || '') === actorId;
      const creator = String(course?.created_by || '') === actorId;
      if (staffRole && (assigned || creator)) {
        const requestResult = await pool.query(
          `SELECT r.student_id,
                  COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(s.first_name), ''), 'Student #' || r.student_id) AS student_name,
                  s.year_level, r.requested_at
           FROM class_join_requests r
           LEFT JOIN students s ON s.student_id::text = r.student_id::text
           WHERE r.course_id = $1
           ORDER BY r.requested_at, student_name`,
          [courseId]
        );
        requests = requestResult.rows;
      }
    }
    return res.json({ members: result.rows, requests });
  } catch (error) {
    console.error('Error loading class members:', error.message);
    return res.status(500).json({ error: 'Failed to load class members.' });
  }
});

async function authorizeClassJoinRequestManager(courseId, actorId) {
  await courseSchemaReady;
  const [courseResult, actorResult] = await Promise.all([
    pool.query('SELECT teacher_id, created_by FROM courses WHERE course_id = $1', [courseId]),
    pool.query('SELECT role FROM students WHERE student_id::text = $1::text', [actorId]),
  ]);
  const course = courseResult.rows[0];
  if (!course) return false;
  const role = String(actorResult.rows[0]?.role || '').toLowerCase();
  return ['teacher', 'instructor', 'dean'].includes(role) &&
    (String(course.teacher_id || '') === actorId || String(course.created_by || '') === actorId);
}

app.post('/api/courses/:courseId/join-requests/:studentId/approve', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const studentId = String(req.params.studentId || '').trim();
  const actorId = String(req.body?.user_id || '').trim();
  if (!Number.isInteger(courseId) || !studentId || !actorId) return res.status(400).json({ error: 'Course, student, and instructor IDs are required.' });
  let client;
  try {
    await classJoinRequestsSchemaReady;
    if (!await authorizeClassJoinRequestManager(courseId, actorId)) return res.status(403).json({ error: 'Only this class instructor or dean can approve join requests.' });
    client = await pool.connect();
    await client.query('BEGIN');
    const request = await client.query('DELETE FROM class_join_requests WHERE course_id = $1 AND student_id = $2 RETURNING student_id', [courseId, studentId]);
    if (!request.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Join request not found.' });
    }
    await client.query('INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [studentId, courseId]);
    await client.query('COMMIT');
    return res.json({ message: 'Student approved and added to the class.' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Error approving class join request:', error.message);
    return res.status(500).json({ error: 'Failed to approve join request.' });
  } finally {
    client?.release();
  }
});

app.delete('/api/courses/:courseId/join-requests/:studentId', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const studentId = String(req.params.studentId || '').trim();
  const actorId = String(req.query.user_id || '').trim();
  if (!Number.isInteger(courseId) || !studentId || !actorId) return res.status(400).json({ error: 'Course, student, and instructor IDs are required.' });
  try {
    await classJoinRequestsSchemaReady;
    if (!await authorizeClassJoinRequestManager(courseId, actorId)) return res.status(403).json({ error: 'Only this class instructor or dean can delete join requests.' });
    const result = await pool.query('DELETE FROM class_join_requests WHERE course_id = $1 AND student_id = $2', [courseId, studentId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Join request not found.' });
    return res.json({ message: 'Join request declined.' });
  } catch (error) {
    console.error('Error deleting class join request:', error.message);
    return res.status(500).json({ error: 'Failed to delete join request.' });
  }
});

// GET /api/courses/:courseId/record
// Returns the enrolled roster and the grades stored for each class assignment.
app.get('/api/courses/:courseId/record', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  if (!Number.isInteger(courseId)) return res.status(400).json({ error: 'A valid course ID is required.' });

  try {
    const [studentsResult, assignmentsResult, scoresResult, classMetaResult] = await Promise.all([
      pool.query(
        `SELECT e.student_id,
                COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(s.first_name), ''), 'Student #' || e.student_id::text) AS student_name,
                s.academic_year,
                s.year_level
         FROM enrollments e
         LEFT JOIN students s ON s.student_id::text = e.student_id::text
         WHERE e.course_id = $1
           AND COALESCE(LOWER(TRIM(s.role)), 'student') = 'student'
         ORDER BY student_name`,
        [courseId]
      ),
      pool.query(
        `SELECT assignment_id, title, total_points
         FROM class_assignments
         WHERE course_id = $1
         ORDER BY assignment_id`,
        [courseId]
      ),
      pool.query(
        `SELECT submission.student_id, submission.assignment_id, submission.score
         FROM assignment_submissions submission
         INNER JOIN class_assignments assignment ON assignment.assignment_id = submission.assignment_id
         WHERE assignment.course_id = $1`,
        [courseId]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT COALESCE(l.sub_text, '') AS sub_text
         FROM courses c
         LEFT JOIN lessons l ON l.course_id = c.course_id
         WHERE c.course_id = $1
         LIMIT 1`,
        [courseId]
      ),
    ]);

    const classMeta = String(classMetaResult.rows[0]?.sub_text || '').split('|')[0];
    const courseYear = classMeta.split('•').map((part) => part.trim()).filter(Boolean)[2] || '';

    return res.json({
      students: studentsResult.rows,
      assignments: assignmentsResult.rows,
      scores: scoresResult.rows,
      course_year: courseYear,
    });
  } catch (error) {
    console.error('Error loading class record:', error.message);
    return res.status(500).json({ error: 'Failed to load the class record.' });
  }
});

// GET /api/courses/:courseId/full-details
app.get('/api/courses/:courseId/full-details', async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);

  if (!Number.isInteger(courseId)) {
    return res.status(400).json({ error: 'A valid course ID is required.' });
  }

  try {
    const courseResult = await pool.query(
      `SELECT c.course_id, c.code, c.title, c.class_code, c.status, l.sub_text
       FROM courses c
       LEFT JOIN lessons l ON l.course_id = c.course_id
       WHERE c.course_id = $1
       LIMIT 1`,
      [courseId]
    );

    if (courseResult.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    const courseRecord = courseResult.rows[0];
    const metaParts = String(courseRecord.sub_text || '').split('•').map((part) => part.trim()).filter(Boolean);
    const instructor = metaParts[3] || 'Instructor not set';

    // Related class content is optional, so an empty or not-yet-created
    // content table must not prevent the course page from opening.
    const [materialsResult, resourcesResult, announcementsResult, assignmentsResult] = await Promise.all([
      pool.query(
        'SELECT * FROM class_materials WHERE course_id = $1 ORDER BY material_id DESC',
        [courseId]
      ).catch(() => ({ rows: [] })),
      pool.query(
        'SELECT * FROM class_resources WHERE course_id = $1 ORDER BY resource_id DESC',
        [courseId]
      ).catch(() => ({ rows: [] })),
      pool.query(
        'SELECT * FROM class_announcements WHERE course_id = $1 ORDER BY announcement_id DESC',
        [courseId]
      ).catch(() => ({ rows: [] })),
      pool.query(
        'SELECT * FROM class_assignments WHERE course_id = $1 ORDER BY due_date ASC',
        [courseId]
      ).catch(() => ({ rows: [] })),
    ]);

    res.json({
      course: {
        ...courseRecord,
        instructor,
      },
      materials: materialsResult.rows,
      resources: resourcesResult.rows,
      assignments: assignmentsResult.rows,
      announcements: announcementsResult.rows,
    });
  } catch (error) {
    console.error('Error fetching class full details:', error.message);
    res.status(500).json({ error: 'Server error loading class view.' });
  }
});

// POST /api/courses/:courseId/classwork
app.post('/api/courses/:courseId/classwork', upload.single('file'), async (req, res) => {
  const courseId = Number.parseInt(req.params.courseId, 10);
  const { type, title, description, file_link: fileLink, dueDate, totalPoints } = req.body || {};
  const documentUrl = req.file ? `/uploads/${req.file.filename}` : String(fileLink || '').trim();
  const workDescription = String(description || '').trim();

  if (!Number.isInteger(courseId)) {
    return res.status(400).json({ error: 'A valid course ID is required.' });
  }

  if (!['Lesson', 'Task', 'Activity', 'Quiz', 'Resource'].includes(type) || !String(title || '').trim()) {
    return res.status(400).json({ error: 'Choose a type and enter a title.' });
  }
  if (workDescription.length > 2000) return res.status(400).json({ error: 'Description must be 2,000 characters or fewer.' });

  try {
    if (req.file) {
      console.log('[AI SYNC] Uploaded file:', req.file.path);
      await translateForAI(req.file.path);
    }
    const courseResult = await pool.query(
      'SELECT course_id FROM courses WHERE course_id = $1',
      [courseId]
    );
    if (courseResult.rowCount === 0) {
      return res.status(404).json({ error: 'Course not found.' });
    }

    if (type === 'Lesson' || type === 'Resource') {
      await Promise.all([classMaterialsNullableUrlReady, classWorkDescriptionSchemaReady]);
      const result = await pool.query(
        `INSERT INTO class_materials (course_id, title, description, pdf_url)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [courseId, title.trim(), workDescription || null, documentUrl || null]
      );
      await notifyStudentsOfCourseActivity({
        courseId,
        activityType: type.toLowerCase(),
        sourceId: result.rows[0].material_id,
        title: type === 'Lesson' ? 'New lesson uploaded' : 'New resource added',
        contentTitle: `New ${type.toLowerCase()} “${title.trim()}”`
      });
      return res.status(201).json({ message: 'Class work added successfully.', item: result.rows[0] });
    }

    // This keeps document links available for tasks, activities, and quizzes too.
    await classWorkDescriptionSchemaReady;
    const points = Number(totalPoints);
    const result = await pool.query(
      `INSERT INTO class_assignments (course_id, title, description, type, due_date, total_points, file_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [courseId, title.trim(), workDescription || null, type, dueDate || null, Number.isFinite(points) ? points : 50, documentUrl || null]
    );
    await notifyStudentsOfCourseActivity({
      courseId,
      activityType: type.toLowerCase(),
      sourceId: result.rows[0].assignment_id,
      title: `New ${type.toLowerCase()} posted`,
      contentTitle: `New ${type.toLowerCase()} “${title.trim()}”`
    });
    return res.status(201).json({ message: 'Class work added successfully.', item: result.rows[0] });
  } catch (error) {
    console.error('Error adding class work:', error.message);
    return res.status(500).json({ error: 'Failed to add class work.' });
  }
});

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Files must be 25 MB or smaller.' });
  }
  if (error?.message === 'Unsupported file type. Use PDF, DOC/DOCX, PPT/PPTX, PNG, or ZIP.') {
    return res.status(400).json({ error: error.message });
  }
  return next(error);
});

// DELETE /api/materials/:id
app.delete('/api/materials/:id', async (req, res) => {
  const materialId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(materialId)) {
    return res.status(400).json({ error: 'A valid material ID is required.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM class_materials WHERE material_id = $1 RETURNING material_id',
      [materialId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Material not found.' });
    return res.json({ message: 'Material deleted successfully.' });
  } catch (error) {
    console.error('Error deleting material:', error.message);
    return res.status(500).json({ error: 'Failed to delete material.' });
  }
});

// Serve an uploaded document inline. Class views use this endpoint rather than
// linking straight to /uploads, which can make browsers save the file instead.
function sendUploadedFileInline(res, url, title) {
  if (!url.startsWith('/uploads/')) return res.redirect(url);

  const filePath = path.join(uploadDir, path.basename(url));
  const extension = path.extname(filePath);
  const baseName = String(title || 'document')
    .replace(/[^a-z0-9._ -]/gi, '-')
    .replace(/[. ]+$/, '') || 'document';
  const fileName = baseName.toLowerCase().endsWith(extension.toLowerCase())
    ? baseName
    : `${baseName}${extension}`;
  return res.sendFile(filePath, {
    headers: { 'Content-Disposition': `inline; filename="${fileName}"` },
  });
}

function sendDocumentPreview(res, req, title, viewPath, fileUrl) {
  const safeTitle = String(title || 'Document').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  const sourceUrl = `${protocol}://${req.get('host')}${viewPath}`;
  const extension = path.extname(String(fileUrl || '').split('?')[0]).toLowerCase();
  const canOpenDirectly = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension);
  const viewerUrl = canOpenDirectly
    ? viewPath
    : `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(sourceUrl)}`;
  const isOfficeFile = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(extension);
  const content = isOfficeFile || canOpenDirectly
    ? `<iframe title="${safeTitle}" src="${viewerUrl}" allowfullscreen></iframe>`
    : '<p class="notice">This file type cannot be previewed in the browser.</p>';

  return res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — IMCC LMS</title>
<style>body{margin:0;background:#171a1b;color:#f4f4f4;font:16px Arial,sans-serif}.bar{height:64px;display:flex;align-items:center;gap:12px;padding:0 24px;background:#252829;box-sizing:border-box}.badge{background:#d95a70;border-radius:7px;padding:8px 10px;font-weight:800}.name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}main{height:calc(100vh - 64px);display:grid;place-items:center}iframe{width:100%;height:100%;border:0;background:#fff}.notice{padding:24px;background:#292d2f;border-radius:10px}</style>
</head><body><header class="bar"><span class="badge">FILE</span><span class="name">${safeTitle}</span></header><main>${content}</main></body></html>`);
}

// VIEW a local resource inline. This intentionally uses Content-Disposition:
// inline so the browser previews supported types (especially PDFs) instead of
// treating the View action as a download.
app.get('/api/materials/:id/view', async (req, res) => {
  const materialId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(materialId)) return res.status(400).json({ error: 'A valid material ID is required.' });
  try {
    const result = await pool.query('SELECT title, pdf_url FROM class_materials WHERE material_id = $1', [materialId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Resource not found.' });
    const { title, pdf_url: url } = result.rows[0];
    if (!url) return res.status(400).json({ error: 'No file is attached to this resource.' });
    return sendUploadedFileInline(res, url, title);
  } catch (error) {
    console.error('Error viewing resource:', error.message);
    return res.status(500).json({ error: 'Failed to view resource.' });
  }
});

// Google-Classroom-style preview shell. PDFs/images render locally; Office
// documents render through Office for the web when this LMS is publicly hosted.
app.get('/api/materials/:id/preview', async (req, res) => {
  const materialId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(materialId)) return res.status(400).json({ error: 'A valid material ID is required.' });
  try {
    const result = await pool.query('SELECT title, pdf_url FROM class_materials WHERE material_id = $1', [materialId]);
    if (result.rowCount === 0 || !result.rows[0].pdf_url) return res.status(404).json({ error: 'Resource file not found.' });
    return sendDocumentPreview(res, req, result.rows[0].title, `/api/materials/${materialId}/view`, result.rows[0].pdf_url);
  } catch (error) {
    console.error('Error previewing resource:', error.message);
    return res.status(500).json({ error: 'Failed to preview resource.' });
  }
});

// VIEW attached task, activity, and quiz documents inline.
app.get('/api/assignments/:id/view', async (req, res) => {
  const assignmentId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(assignmentId)) return res.status(400).json({ error: 'A valid assignment ID is required.' });
  try {
    const result = await pool.query('SELECT title, file_url FROM class_assignments WHERE assignment_id = $1', [assignmentId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' });
    const { title, file_url: url } = result.rows[0];
    if (!url) return res.status(400).json({ error: 'No file is attached to this assignment.' });
    return sendUploadedFileInline(res, url, title);
  } catch (error) {
    console.error('Error viewing assignment:', error.message);
    return res.status(500).json({ error: 'Failed to view assignment file.' });
  }
});

app.get('/api/assignments/:id/preview', async (req, res) => {
  const assignmentId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(assignmentId)) return res.status(400).json({ error: 'A valid assignment ID is required.' });
  try {
    const result = await pool.query('SELECT title, file_url FROM class_assignments WHERE assignment_id = $1', [assignmentId]);
    if (result.rowCount === 0 || !result.rows[0].file_url) return res.status(404).json({ error: 'Assignment file not found.' });
    return sendDocumentPreview(res, req, result.rows[0].title, `/api/assignments/${assignmentId}/view`, result.rows[0].file_url);
  } catch (error) {
    console.error('Error previewing assignment:', error.message);
    return res.status(500).json({ error: 'Failed to preview assignment.' });
  }
});

// DOWNLOAD a resource as a file, using its lesson title as the download name.
app.get('/api/materials/:id/download', async (req, res) => {
  const materialId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(materialId)) return res.status(400).json({ error: 'A valid material ID is required.' });
  try {
    const result = await pool.query('SELECT title, pdf_url FROM class_materials WHERE material_id = $1', [materialId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Resource not found.' });
    const { title, pdf_url: url } = result.rows[0];
    if (!url) return res.status(400).json({ error: 'No file is attached to this resource.' });
    if (!url.startsWith('/uploads/')) return res.redirect(url);
    const filePath = path.join(uploadDir, path.basename(url));
    const safeName = String(title || 'resource').replace(/[\\/:*?"<>|]/g, '-');
    return res.download(filePath, `${safeName}${path.extname(filePath)}`);
  } catch (error) {
    console.error('Error downloading resource:', error.message);
    return res.status(500).json({ error: 'Failed to download resource.' });
  }
});

// DELETE /api/assignments/:id
app.delete('/api/assignments/:id', async (req, res) => {
  const assignmentId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(assignmentId)) {
    return res.status(400).json({ error: 'A valid assignment ID is required.' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM class_assignments WHERE assignment_id = $1 RETURNING assignment_id',
      [assignmentId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found.' });
    return res.json({ message: 'Assignment deleted successfully.' });
  } catch (error) {
    console.error('Error deleting assignment:', error.message);
    return res.status(500).json({ error: 'Failed to delete assignment.' });
  }
});

// ASSIGNMENTS TAB: role-aware activities, quizzes, and tasks across classes.
function normalizeRole(role) {
  const value = String(role || 'student').toLowerCase().replace(/\s+/g, '');
  if (value === 'teacher' || value === 'instructor') return 'instructor';
  if (value === 'dean' || value === 'admin' || value === 'superadmin') return 'admin';
  return 'student';
}

async function assignmentsPageHandler(req, res) {
  const role = normalizeRole(req.query.role);
  const userId = String(req.query.user_id || '').trim();

  if (!userId) {
    return res.status(400).json({ error: 'A valid user ID is required.' });
  }

  try {
    await assignmentSubmissionSchemaReady;
    // Keep course ownership numeric and enrollment/submission user IDs textual.
    // This avoids PostgreSQL inferring one parameter as both integer and text.
    const courseFilter = role === 'admin'
      ? null
      : (await pool.query(
        role === 'instructor'
          ? `SELECT course_id FROM courses WHERE teacher_id::text = $1::text
             UNION
             SELECT course_id FROM enrollments WHERE student_id::text = $1::text`
          : 'SELECT course_id FROM enrollments WHERE student_id::text = $1::text',
        [userId]
      )).rows.map((row) => row.course_id);

    const result = courseFilter === null
      ? await pool.query(
      `SELECT
         a.assignment_id AS work_id,
         a.assignment_id,
         a.course_id,
         a.type,
         a.title,
         a.due_date,
         a.total_points,
         a.file_url AS document_path,
         COALESCE(c.title, 'Class Work') AS course_title,
         COALESCE(c.code, '') AS course_code,
         submission.submission_id,
         submission.file_name,
         submission.file_path,
         submission.score,
         submission.feedback,
         submission.submitted_at
       FROM class_assignments a
       INNER JOIN courses c ON c.course_id = a.course_id
       LEFT JOIN assignment_submissions submission
         ON submission.assignment_id = a.assignment_id AND submission.student_id::text = $1::text
       ORDER BY a.due_date ASC NULLS LAST, a.assignment_id DESC`,
        [userId]
      )
      : await pool.query(
        `SELECT
           a.assignment_id AS work_id, a.assignment_id, a.course_id, a.type, a.title,
           a.due_date, a.total_points, a.file_url AS document_path,
           COALESCE(c.title, 'Class Work') AS course_title, COALESCE(c.code, '') AS course_code,
           submission.submission_id, submission.file_name, submission.file_path,
           submission.score, submission.feedback, submission.submitted_at
         FROM class_assignments a
         INNER JOIN courses c ON c.course_id = a.course_id
         LEFT JOIN assignment_submissions submission
           ON submission.assignment_id = a.assignment_id AND submission.student_id::text = $1::text
         WHERE a.course_id = ANY($2::int[])
         ORDER BY a.due_date ASC NULLS LAST, a.assignment_id DESC`,
        [userId, courseFilter]
      );

    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assignments page:', error.message);
    return res.status(500).json({ error: 'Failed to load assignments.' });
  }
}

app.get('/api/pages/assignments', assignmentsPageHandler);

const calendarEventsSchemaReady = pool.query(`
  CREATE TABLE IF NOT EXISTS events (
    event_id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    start_date DATE NOT NULL, end_date DATE, course_id INT, created_by VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(async () => {
  await Promise.all([
    pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS title TEXT'),
    pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT'),
    pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS start_date DATE'),
    pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS end_date DATE'),
    pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS course_id INT'),
  ]);
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by VARCHAR(50)');
  await pool.query('ALTER TABLE events ALTER COLUMN created_by TYPE VARCHAR(50) USING created_by::text');
  console.log('Events table is ready!');
})
  .catch((error) => console.error('Error preparing calendar events:', error.message));

async function calendarCourseIds(role, userId) {
  if (role === 'admin') return null;
  const query = role === 'instructor'
    ? `SELECT course_id FROM courses WHERE teacher_id::text = $1::text UNION SELECT course_id FROM enrollments WHERE student_id::text = $1::text`
    : 'SELECT course_id FROM enrollments WHERE student_id::text = $1::text';
  return (await pool.query(query, [userId])).rows.map((row) => row.course_id);
}

app.get('/api/pages/calendar', async (req, res) => {
  const role = normalizeRole(req.query.role);
  const userId = String(req.query.user_id || '').trim();
  const month = String(req.query.month || '');
  if (!userId || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'A valid user ID and month are required.' });
  try {
    await calendarEventsSchemaReady;
    const courseIds = await calendarCourseIds(role, userId);
    const [year, monthNumber] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    const eventParams = [start, end];
    let eventQuery = `SELECT event_id, title, description, start_date, end_date
                      FROM events WHERE start_date < $2::date AND COALESCE(end_date, start_date) >= $1::date`;
    if (courseIds !== null) { eventQuery += ' AND (course_id IS NULL OR course_id = ANY($3::int[]))'; eventParams.push(courseIds); }
    const assignmentParams = [start, end];
    let assignmentQuery = `SELECT a.assignment_id, a.title, a.type, a.due_date, c.title AS course_title
                           FROM class_assignments a JOIN courses c ON c.course_id = a.course_id
                           WHERE a.due_date >= $1::date AND a.due_date < $2::date
                           AND LOWER(COALESCE(a.type, '')) IN ('task', 'activity', 'quiz')`;
    if (courseIds !== null) { assignmentQuery += ' AND a.course_id = ANY($3::int[])'; assignmentParams.push(courseIds); }
    const [events, assignments] = await Promise.all([pool.query(eventQuery, eventParams), pool.query(assignmentQuery, assignmentParams)]);
    return res.json([
      ...events.rows.map((event) => ({ kind: 'event', id: event.event_id, title: event.title, description: event.description, start_date: event.start_date, end_date: event.end_date, course_title: null })),
      ...assignments.rows.map((assignment) => ({ kind: 'assignment', id: assignment.assignment_id, title: assignment.title, description: assignment.type, start_date: assignment.due_date, end_date: null, course_title: assignment.course_title })),
    ]);
  } catch (error) { console.error('Error loading calendar:', error.message); return res.status(500).json({ error: 'Failed to load calendar.' }); }
});

app.post('/api/pages/events', async (req, res) => {
  const role = String(req.body?.role || '').toLowerCase().replace(/\s+/g, '');
  const userId = String(req.body?.user_id || '').trim();
  const title = String(req.body?.title || '').trim();
  const startDate = String(req.body?.start_date || '').slice(0, 10);
  const endDate = String(req.body?.end_date || '').slice(0, 10) || null;
  if (role !== 'dean') return res.status(403).json({ error: 'Only a dean can add calendar events.' });
  if (!userId) return res.status(400).json({ error: 'Your user session could not be identified. Please sign in again.' });
  if (!title) return res.status(400).json({ error: 'An event title is required.' });
  const parsedStartDate = new Date(`${startDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(parsedStartDate.getTime()) || parsedStartDate.toISOString().slice(0, 10) !== startDate) {
    return res.status(400).json({ error: 'A valid start date is required.' });
  }
  try {
    await calendarEventsSchemaReady;
    const deanResult = await pool.query(
      `SELECT 1 FROM students WHERE student_id::text = $1::text AND LOWER(role) = 'dean'`,
      [userId]
    );
    if (!deanResult.rowCount) return res.status(403).json({ error: 'Only a dean can add calendar events.' });
    const courseId = Number.parseInt(req.body?.course_id, 10) || null;
    const result = await pool.query('INSERT INTO events (title, description, start_date, end_date, course_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [title, String(req.body?.description || '').trim() || null, startDate, endDate, courseId, userId]);
    await notifyStudentsOfCourseActivity({
      courseId,
      activityType: 'calendar_event',
      sourceId: result.rows[0].event_id,
      title: 'New calendar event',
      contentTitle: `New calendar event “${title}”`
    });
    return res.status(201).json({ message: 'Event added!', event: result.rows[0] });
  } catch (error) { return res.status(500).json({ error: 'Failed to add event.' }); }
});

app.delete('/api/pages/events/:eventId', async (req, res) => {
  const eventId = Number.parseInt(req.params.eventId, 10);
  const userId = String(req.body?.user_id || '').trim();
  const role = String(req.body?.role || '').toLowerCase().replace(/\s+/g, '');
  if (!Number.isInteger(eventId) || eventId <= 0) return res.status(400).json({ error: 'A valid event ID is required.' });
  if (role !== 'dean' || !userId) return res.status(403).json({ error: 'Only a dean can delete calendar events.' });
  try {
    await calendarEventsSchemaReady;
    const deanResult = await pool.query(
      `SELECT 1 FROM students WHERE student_id::text = $1::text AND LOWER(role) = 'dean'`,
      [userId]
    );
    if (!deanResult.rowCount) return res.status(403).json({ error: 'Only a dean can delete calendar events.' });
    const result = await pool.query('DELETE FROM events WHERE event_id = $1 RETURNING event_id', [eventId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Calendar event not found.' });
    await courseActivityNotificationsSchemaReady;
    await pool.query(
      `DELETE FROM course_activity_notifications WHERE activity_type = 'calendar_event' AND source_id = $1`,
      [eventId]
    );
    return res.json({ message: 'Calendar event deleted.' });
  } catch (error) {
    console.error('Error deleting calendar event:', error.message);
    return res.status(500).json({ error: 'Failed to delete calendar event.' });
  }
});

// ==========================================
// RESOURCES PAGE: all lessons/materials (role-aware)
// ==========================================
// Older databases required a PDF URL. Lessons may be text-only, so make the
// attachment optional without requiring a manual pgAdmin migration.
const classMaterialsNullableUrlReady = pool.query(
  'ALTER TABLE class_materials ALTER COLUMN pdf_url DROP NOT NULL'
).then(() => console.log('Class materials can be saved without a file.'))
  .catch((error) => console.error('Error updating class materials schema:', error.message));

// Descriptions are optional for all lesson and assignment types. The migration
// keeps existing databases compatible without a manual schema update.
const classWorkDescriptionSchemaReady = Promise.all([
  pool.query('ALTER TABLE class_materials ADD COLUMN IF NOT EXISTS description TEXT'),
  pool.query('ALTER TABLE class_assignments ADD COLUMN IF NOT EXISTS description TEXT'),
  pool.query('ALTER TABLE class_assignments ADD COLUMN IF NOT EXISTS file_url TEXT'),
]).catch((error) => console.error('Error updating class work description schema:', error.message));

async function resourcesCourseIds(role, userId) {
  if (['admin', 'dean', 'superadmin'].includes(role)) return null;
  const query = ['instructor', 'teacher'].includes(role)
    ? `SELECT course_id FROM courses WHERE teacher_id::text = $1::text
       UNION SELECT course_id FROM enrollments WHERE student_id::text = $1::text`
    : 'SELECT course_id FROM enrollments WHERE student_id::text = $1::text';
  return (await pool.query(query, [userId])).rows.map((row) => row.course_id);
}

app.get('/api/pages/resources', async (req, res) => {
  const role = String(req.query.role || 'student').toLowerCase().replace(/\s+/g, '');
  const userId = String(req.query.user_id || '').trim();
  if (!userId) return res.status(400).json({ error: 'A valid user ID is required.' });
  try {
    const scope = await resourcesCourseIds(role, userId);
    const baseQuery = `SELECT m.material_id, m.title, m.pdf_url, c.title AS course_title, c.code AS course_code
                       FROM class_materials m JOIN courses c ON c.course_id = m.course_id`;
    const result = scope === null
      ? await pool.query(`${baseQuery} ORDER BY m.material_id DESC`)
      : await pool.query(`${baseQuery} WHERE m.course_id = ANY($1::int[]) ORDER BY m.material_id DESC`, [scope]);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching resources:', error.message);
    return res.status(500).json({ error: 'Failed to load resources.' });
  }
});

app.get('/api/pages/my-classes', async (req, res) => {
  const role = String(req.query.role || 'student').toLowerCase().replace(/\s+/g, '');
  const userId = String(req.query.user_id || '').trim();
  if (!userId) return res.status(400).json({ error: 'A valid user ID is required.' });
  try {
    const scope = await resourcesCourseIds(role, userId);
    const result = scope === null
      ? await pool.query('SELECT course_id, title, code FROM courses ORDER BY course_id DESC')
      : await pool.query('SELECT course_id, title, code FROM courses WHERE course_id = ANY($1::int[]) ORDER BY course_id DESC', [scope]);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching my classes:', error.message);
    return res.status(500).json({ error: 'Failed to load classes.' });
  }
});

app.post('/api/pages/resources', upload.single('file'), async (req, res) => {
  const role = String(req.body?.role || '').toLowerCase().replace(/\s+/g, '');
  if (!['instructor', 'teacher', 'dean', 'admin', 'superadmin'].includes(role)) return res.status(403).json({ error: 'Only staff can add resources.' });
  const courseId = Number.parseInt(req.body?.course_id, 10);
  const title = String(req.body?.title || '').trim();
  const fileUrl = req.file ? `/uploads/${req.file.filename}` : String(req.body?.file_link || '').trim();
  if (!Number.isInteger(courseId) || !title) return res.status(400).json({ error: 'A class and a title are required.' });
  try {
    if (req.file) await translateForAI(req.file.path);
    await classMaterialsNullableUrlReady;
    const result = await pool.query('INSERT INTO class_materials (course_id, title, pdf_url) VALUES ($1, $2, $3) RETURNING *', [courseId, title, fileUrl || null]);
    await notifyStudentsOfCourseActivity({
      courseId,
      activityType: 'resource',
      sourceId: result.rows[0].material_id,
      title: 'New resource added',
      contentTitle: `New resource “${title}”`
    });
    return res.status(201).json({ message: 'Resource added!', item: result.rows[0] });
  } catch (error) {
    console.error('Error adding resource:', error.message);
    return res.status(500).json({ error: 'Failed to add resource.' });
  }
});

// Vercel imports the Express app as a serverless handler. Keep the local
// listener for development only.
if (require.main === module) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

module.exports = app;


const mammoth = require('mammoth');
// pdf-parse v2 needs its worker initialized explicitly in serverless runtimes.
require('pdf-parse/worker');
const pdf = require('pdf-parse');

// --- AUTO TRANSLATE FOR AI ---
async function translateForAI(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const txtPath = path.join(flowiseUploadDir, `${path.parse(filePath).name}.txt`);

    try {
        if (ext === '.docx' || ext === '.doc') {
            const result = await mammoth.extractRawText({ path: filePath });
            fs.writeFileSync(txtPath, result.value, 'utf8');
            console.log(` Translated Word doc to: ${txtPath}`);
            return true;
        } 
        else if (ext === '.pdf') {
            const dataBuffer = fs.readFileSync(filePath);
            const data = await pdf(dataBuffer);
            fs.writeFileSync(txtPath, data.text, 'utf8');
            console.log(` Translated PDF to: ${txtPath}`);
            return true;
        }
        return false;
    } catch (err) {
        console.error('Translation failed:', err.message);
        throw err;
    }
}



app.get('/api/flowise/course-materials/:courseId', async (req, res) => {
  // Authenticate the Flowise integration.
  const apiKey = process.env.FLOWISE_SYNC_API_KEY;
  const providedKey = req.get('x-api-key');

  if (!apiKey || providedKey !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const courseId = Number.parseInt(req.params.courseId, 10);

  if (!Number.isInteger(courseId) || courseId <= 0) {
    return res.status(400).json({ error: 'Invalid course ID' });
  }

  try {
    const result = await pool.query(
      `SELECT material_id, course_id, title, description, pdf_url
       FROM class_materials
       WHERE course_id = $1
       ORDER BY material_id DESC`,
      [courseId]
    );

    const documents = [];

    for (const material of result.rows) {
      if (!material.pdf_url) continue;

      // Only accept filenames stored in this application's uploads folder.
      const filename = path.basename(material.pdf_url);
      const txtFilename = `${path.parse(filename).name}.txt`;
      const txtPath = path.join(flowiseUploadDir, txtFilename);

      // Verify the resolved path stays inside Flowise's uploads directory.
      if (path.dirname(txtPath) !== path.resolve(flowiseUploadDir)) continue;

      if (!fs.existsSync(txtPath)) continue;

      const content = fs.readFileSync(txtPath, 'utf8').trim();
      if (!content) continue;

      documents.push({
        pageContent: content,
        metadata: {
          courseId: material.course_id,
          materialId: material.material_id,
          title: material.title,
          description: material.description || ''
        }
      });
    }

    return res.json({ courseId, documents });
  } catch (error) {
    console.error('Flowise materials endpoint error:', error.message);
    return res.status(500).json({
      error: 'Failed to retrieve course materials'
    });
  }
});


// Call this function right after your file upload saves:
// translateForAI(req.file.path); 
// ---------------------------------
