const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS for Netlify frontend
app.use(cors({
    origin: ['https://prismatic-begonia-55beb8.netlify.app', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

// Database connection
let db;
try {
    db = mysql.createPool({
        uri: process.env.MYSQL_URL,
        waitForConnections: true,
        connectionLimit: 5
    }).promise();
    console.log('✅ Database connected');
} catch (err) {
    console.log('❌ Database error:', err.message);
}

// Test route
app.get('/', (req, res) => {
    res.json({ message: 'Job Portal API is running' });
});

// Test database route
app.get('/test-db', async (req, res) => {
    try {
        const [result] = await db.query('SELECT 1 as connected');
        res.json({ success: true, message: 'Database connected' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// REGISTER
app.post('/register', async (req, res) => {
    console.log('📝 Register request:', req.body.email);
    
    const { email, password, role, full_name } = req.body;
    
    if (!email || !password || !role || !full_name) {
        return res.json({ success: false, message: 'All fields required' });
    }
    
    try {
        const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.json({ success: false, message: 'Email already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await db.query(
            'INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)',
            [email, hashedPassword, role, full_name]
        );
        
        console.log('✅ User registered:', email);
        res.json({ success: true, message: 'User registered successfully!' });
    } catch (err) {
        console.log('❌ Register error:', err.message);
        res.json({ success: false, message: err.message });
    }
});

// LOGIN
app.post('/login', async (req, res) => {
    console.log('📝 Login request:', req.body.email);
    
    const { email, password } = req.body;
    
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }
        
        const user = users[0];
        const valid = await bcrypt.compare(password, user.password);
        
        if (!valid) {
            return res.json({ success: false, message: 'Invalid password' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret_key',
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            }
        });
    } catch (err) {
        console.log('❌ Login error:', err.message);
        res.json({ success: false, message: err.message });
    }
});

// GET JOBS
app.get('/jobs', async (req, res) => {
    try {
        const [jobs] = await db.query(`
            SELECT jobs.*, users.full_name as employer_name 
            FROM jobs 
            JOIN users ON jobs.employer_id = users.id 
            ORDER BY jobs.created_at DESC
        `);
        res.json({ success: true, jobs });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// POST JOB
app.post('/jobs', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'No token' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        
        if (decoded.role !== 'employer') {
            return res.json({ success: false, message: 'Employers only' });
        }
        
        const { title, description, requirements, location, deadline } = req.body;
        
        await db.query(
            'INSERT INTO jobs (employer_id, title, description, requirements, location, deadline) VALUES (?, ?, ?, ?, ?, ?)',
            [decoded.id, title, description, requirements, location, deadline]
        );
        
        res.json({ success: true, message: 'Job posted!' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});
// ========== ADDITIONAL ENDPOINTS ==========

// GET MY JOBS (for manage-jobs page)
app.get('/my-jobs', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const [jobs] = await db.query('SELECT * FROM jobs WHERE employer_id = ? ORDER BY created_at DESC', [decoded.id]);
        res.json({ success: true, jobs });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// GET EMPLOYER APPLICANTS
app.get('/employer/applicants', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        if (decoded.role !== 'employer') return res.json({ success: false, message: 'Employers only' });
        
        const [applicants] = await db.query(`
            SELECT a.*, j.title as job_title, j.location as job_location, 
                   u.full_name as seeker_name, u.email as seeker_email
            FROM applications a
            JOIN jobs j ON a.job_id = j.id
            JOIN users u ON a.job_seeker_id = u.id
            WHERE j.employer_id = ?
            ORDER BY a.applied_at DESC
        `, [decoded.id]);
        
        res.json({ success: true, applicants });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// UPDATE APPLICATION STATUS
app.put('/applications/:id/status', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const { status } = req.body;
        const applicationId = req.params.id;
        
        await db.query('UPDATE applications SET status = ? WHERE id = ?', [status, applicationId]);
        res.json({ success: true, message: 'Status updated' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// GET MY APPLICATIONS (for job seekers)
app.get('/my-applications', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const [applications] = await db.query(`
            SELECT a.*, j.title, j.location, j.deadline
            FROM applications a
            JOIN jobs j ON a.job_id = j.id
            WHERE a.job_seeker_id = ?
            ORDER BY a.applied_at DESC
        `, [decoded.id]);
        
        res.json({ success: true, applications });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// GET USER PROFILE
app.get('/profile', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const [users] = await db.query('SELECT id, email, full_name, role, created_at FROM users WHERE id = ?', [decoded.id]);
        
        if (users.length === 0) return res.json({ success: false, message: 'User not found' });
        
        let stats = {};
        if (users[0].role === 'jobseeker') {
            const [apps] = await db.query('SELECT COUNT(*) as count FROM applications WHERE job_seeker_id = ?', [decoded.id]);
            stats.applications_count = apps[0].count;
        } else {
            const [jobs] = await db.query('SELECT COUNT(*) as count FROM jobs WHERE employer_id = ?', [decoded.id]);
            const [applicants] = await db.query(`
                SELECT COUNT(*) as count FROM applications WHERE job_id IN (SELECT id FROM jobs WHERE employer_id = ?)
            `, [decoded.id]);
            stats.jobs_count = jobs[0].count;
            stats.applicants_count = applicants[0].count;
        }
        
        res.json({ success: true, user: users[0], stats });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// UPDATE USER PROFILE
app.put('/profile', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const { full_name } = req.body;
        await db.query('UPDATE users SET full_name = ? WHERE id = ?', [full_name, decoded.id]);
        res.json({ success: true, message: 'Profile updated' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// APPLY FOR JOB
app.post('/apply', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        if (decoded.role !== 'jobseeker') return res.json({ success: false, message: 'Only job seekers can apply' });
        
        const { job_id, cover_letter } = req.body;
        
        // Check if already applied
        const [existing] = await db.query('SELECT * FROM applications WHERE job_id = ? AND job_seeker_id = ?', [job_id, decoded.id]);
        if (existing.length > 0) {
            return res.json({ success: false, message: 'You already applied for this job' });
        }
        
        await db.query('INSERT INTO applications (job_id, job_seeker_id, cover_letter) VALUES (?, ?, ?)', [job_id, decoded.id, cover_letter || '']);
        res.json({ success: true, message: 'Application submitted successfully!' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// DELETE JOB
app.delete('/jobs/:id', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const jobId = req.params.id;
        
        // Delete applications first (foreign key constraint)
        await db.query('DELETE FROM applications WHERE job_id = ?', [jobId]);
        await db.query('DELETE FROM jobs WHERE id = ? AND employer_id = ?', [jobId, decoded.id]);
        res.json({ success: true, message: 'Job deleted' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});

// UPDATE JOB
app.put('/jobs/:id', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ success: false, message: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        const jobId = req.params.id;
        const { title, description, requirements, location, deadline } = req.body;
        
        await db.query(
            'UPDATE jobs SET title = ?, description = ?, requirements = ?, location = ?, deadline = ? WHERE id = ? AND employer_id = ?',
            [title, description, requirements, location, deadline, jobId, decoded.id]
        );
        res.json({ success: true, message: 'Job updated' });
    } catch (err) {
        res.json({ success: false, message: err.message });
    }
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});