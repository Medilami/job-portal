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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});