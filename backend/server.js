const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = 3000;

app.use(cors({
    origin: ['https://prismatic-begonia-55beb8.netlify.app', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

const db = mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
}).promise();
app.get('/', (req, res) => {
    res.send('Server is working!');
});

// ==================== AUTHENTICATION ====================

// REGISTER
app.post('/register', async (req, res) => {
    console.log('📝 Register request received');
    console.log('Body:', req.body);
    
    const { email, password, role, full_name } = req.body;
    
    // Check if all fields are present
    if (!email || !password || !role || !full_name) {
        console.log('❌ Missing fields');
        return res.json({ success: false, message: 'All fields are required' });
    }
    
    try {
        // Check if user already exists
        const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            console.log('❌ User already exists:', email);
            return res.json({ success: false, message: 'Email already exists' });
        }
        
        // Insert new user
        const result = await db.query(
            'INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)',
            [email, password, role, full_name]
        );
        
        console.log('✅ User registered:', email);
        res.json({ success: true, message: 'User registered successfully!' });
        
    } catch (error) {
        console.log('❌ Database error:', error.message);
        res.json({ success: false, message: error.message });
    }
});
// LOGIN
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }
        
        const user = users[0];
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.json({ success: false, message: 'Incorrect password' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({ 
            success: true, 
            message: 'Login successful!',
            token: token,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            }
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ==================== JOBS ====================

// GET ALL JOBS
app.get('/jobs', async (req, res) => {
    try {
        const [jobs] = await db.query(`
            SELECT jobs.*, users.full_name as employer_name 
            FROM jobs 
            JOIN users ON jobs.employer_id = users.id 
            ORDER BY jobs.created_at DESC
        `);
        res.json({ success: true, jobs: jobs });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// POST A JOB (Employer only)
app.post('/jobs', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'Please login first' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.role !== 'employer') {
            return res.json({ success: false, message: 'Only employers can post jobs' });
        }
        
        const { title, description, requirements, location, deadline } = req.body;
        
        await db.query(
            'INSERT INTO jobs (employer_id, title, description, requirements, location, deadline) VALUES (?, ?, ?, ?, ?, ?)',
            [decoded.id, title, description, requirements, location, deadline]
        );
        
        res.json({ success: true, message: 'Job posted successfully!' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ==================== APPLICATIONS ====================

// APPLY FOR A JOB (Job Seeker only)
app.post('/apply', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'Please login first' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.role !== 'jobseeker') {
            return res.json({ success: false, message: 'Only job seekers can apply' });
        }
        
        const { job_id, cover_letter } = req.body;
        
        const [existing] = await db.query(
            'SELECT * FROM applications WHERE job_id = ? AND job_seeker_id = ?',
            [job_id, decoded.id]
        );
        
        if (existing.length > 0) {
            return res.json({ success: false, message: 'You already applied for this job' });
        }
        
        await db.query(
            'INSERT INTO applications (job_id, job_seeker_id, cover_letter) VALUES (?, ?, ?)',
            [job_id, decoded.id, cover_letter || '']
        );
        
        res.json({ success: true, message: 'Application submitted successfully!' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// GET MY APPLICATIONS (Job Seeker)
app.get('/my-applications', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'Please login first' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const [applications] = await db.query(`
            SELECT applications.*, jobs.title, jobs.location, jobs.deadline 
            FROM applications 
            JOIN jobs ON applications.job_id = jobs.id 
            WHERE applications.job_seeker_id = ?
            ORDER BY applications.applied_at DESC
        `, [decoded.id]);
        
        res.json({ success: true, applications: applications });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ==================== EMPLOYER DASHBOARD ====================

// GET APPLICANTS FOR EMPLOYER'S JOBS
app.get('/employer/applicants', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.role !== 'employer') {
            return res.json({ success: false, message: 'Only employers can view applicants' });
        }
        
        const [applicants] = await db.query(`
            SELECT 
                applications.*,
                jobs.title as job_title,
                jobs.location as job_location,
                users.full_name as seeker_name,
                users.email as seeker_email
            FROM applications 
            JOIN jobs ON applications.job_id = jobs.id 
            JOIN users ON applications.job_seeker_id = users.id 
            WHERE jobs.employer_id = ?
            ORDER BY applications.applied_at DESC
        `, [decoded.id]);
        
        res.json({ success: true, applicants: applicants });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// UPDATE APPLICATION STATUS
app.put('/applications/:id/status', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { status } = req.body;
    const applicationId = req.params.id;
    
    if (!token) {
        return res.json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.role !== 'employer') {
            return res.json({ success: false, message: 'Only employers can update status' });
        }
        
        await db.query(
            'UPDATE applications SET status = ? WHERE id = ?',
            [status, applicationId]
        );
        
        res.json({ success: true, message: 'Application status updated!' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});
// SEARCH JOBS (with filters)
app.get('/jobs/search', async (req, res) => {
    const { keyword, location } = req.query;
    
    let query = `
        SELECT jobs.*, users.full_name as employer_name 
        FROM jobs 
        JOIN users ON jobs.employer_id = users.id 
        WHERE 1=1
    `;
    let params = [];
    
    if (keyword && keyword.trim() !== '') {
        query += ` AND (jobs.title LIKE ? OR jobs.description LIKE ?)`;
        params.push(`%${keyword}%`, `%${keyword}%`);
    }
    
    if (location && location.trim() !== '') {
        query += ` AND jobs.location LIKE ?`;
        params.push(`%${location}%`);
    }
    
    query += ` ORDER BY jobs.created_at DESC`;
    
    try {
        const [jobs] = await db.query(query, params);
        res.json({ success: true, jobs: jobs });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});
// GET EMPLOYER'S OWN JOBS
app.get('/my-jobs', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.role !== 'employer') {
            return res.json({ success: false, message: 'Only employers can access' });
        }
        
        const [jobs] = await db.query(
            'SELECT * FROM jobs WHERE employer_id = ? ORDER BY created_at DESC',
            [decoded.id]
        );
        
        res.json({ success: true, jobs: jobs });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// UPDATE JOB
app.put('/jobs/:id', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const jobId = req.params.id;
    const { title, description, requirements, location, deadline } = req.body;
    
    if (!token) {
        return res.json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const [job] = await db.query('SELECT * FROM jobs WHERE id = ? AND employer_id = ?', [jobId, decoded.id]);
        
        if (job.length === 0) {
            return res.json({ success: false, message: 'Job not found or unauthorized' });
        }
        
        await db.query(
            'UPDATE jobs SET title = ?, description = ?, requirements = ?, location = ?, deadline = ? WHERE id = ?',
            [title, description, requirements, location, deadline, jobId]
        );
        
        res.json({ success: true, message: 'Job updated successfully!' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// DELETE JOB
app.delete('/jobs/:id', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const jobId = req.params.id;
    
    if (!token) {
        return res.json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const [job] = await db.query('SELECT * FROM jobs WHERE id = ? AND employer_id = ?', [jobId, decoded.id]);
        
        if (job.length === 0) {
            return res.json({ success: false, message: 'Job not found or unauthorized' });
        }
        
        // Delete applications first (foreign key constraint)
        await db.query('DELETE FROM applications WHERE job_id = ?', [jobId]);
        await db.query('DELETE FROM jobs WHERE id = ?', [jobId]);
        
        res.json({ success: true, message: 'Job deleted successfully!' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});
// GET USER PROFILE
app.get('/profile', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const [users] = await db.query(
            'SELECT id, email, full_name, role, created_at FROM users WHERE id = ?',
            [decoded.id]
        );
        
        if (users.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }
        
        // Get statistics
        let stats = {};
        
        if (users[0].role === 'jobseeker') {
            const [applications] = await db.query(
                'SELECT COUNT(*) as count FROM applications WHERE job_seeker_id = ?',
                [decoded.id]
            );
            stats.applications_count = applications[0].count;
        } else {
            const [jobs] = await db.query(
                'SELECT COUNT(*) as count FROM jobs WHERE employer_id = ?',
                [decoded.id]
            );
            const [applicants] = await db.query(
                'SELECT COUNT(*) as count FROM applications WHERE job_id IN (SELECT id FROM jobs WHERE employer_id = ?)',
                [decoded.id]
            );
            stats.jobs_count = jobs[0].count;
            stats.applicants_count = applicants[0].count;
        }
        
        res.json({ success: true, user: users[0], stats: stats });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// UPDATE USER PROFILE
app.put('/profile', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { full_name } = req.body;
    
    if (!token) {
        return res.json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        await db.query(
            'UPDATE users SET full_name = ? WHERE id = ?',
            [full_name, decoded.id]
        );
        
        res.json({ success: true, message: 'Profile updated successfully!' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});
// Test database connection on startup
async function testDB() {
    try {
        const [result] = await db.query('SELECT 1');
        console.log('✅ Database connected');
    } catch (err) {
        console.log('❌ Database error:', err.message);
    }
}
testDB();
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});