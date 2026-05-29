const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['https://prismatic-begonia-55beb8.netlify.app', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

// Database connection
const db = mysql.createPool({
    host: 'mysql.railway.internal',
    user: 'root',
    password: 'mvnlpcuQzXLgJQagWKxxxxxxxxxx',  // <-- PUT YOUR FULL PASSWORD HERE
    database: 'railway',
    port: 3306,
    waitForConnections: true,
    connectionLimit: 5
}).promise();

// Test database connection
async function testDB() {
    try {
        const [result] = await db.query('SELECT 1');
        console.log('✅ Database connected successfully');
    } catch (err) {
        console.log('❌ Database error:', err.message);
    }
}
testDB();

app.get('/', (req, res) => {
    res.json({ message: 'API is working' });
});

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

app.post('/register', async (req, res) => {
    console.log('📝 Register request received');
    const { email, password, role, full_name } = req.body;
    
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
    } catch (error) {
        console.log('❌ Error:', error.message);
        res.json({ success: false, message: error.message });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.json({ success: false, message: 'User not found' });
        }
        
        const user = users[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.json({ success: false, message: 'Incorrect password' });
        }
        
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
        });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});