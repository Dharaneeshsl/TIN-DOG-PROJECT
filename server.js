// Complete TIN-DOG Backend Server
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static('uploads'));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'tin-dog-secret-key-2024';

// In-memory database (in production, use MongoDB/PostgreSQL)
let users = [];
let dogs = [];
let matches = [];
let messages = [];
let conversations = [];

// Load initial data
try {
    if (fs.existsSync('data/users.json')) {
        users = JSON.parse(fs.readFileSync('data/users.json', 'utf8'));
    }
    if (fs.existsSync('data/dogs.json')) {
        dogs = JSON.parse(fs.readFileSync('data/dogs.json', 'utf8'));
    }
    if (fs.existsSync('data/matches.json')) {
        matches = JSON.parse(fs.readFileSync('data/matches.json', 'utf8'));
    }
    if (fs.existsSync('data/messages.json')) {
        messages = JSON.parse(fs.readFileSync('data/messages.json', 'utf8'));
    }
} catch (error) {
    console.log('No existing data found, starting fresh');
}

// Create data directory if it doesn't exist
if (!fs.existsSync('data')) {
    fs.mkdirSync('data');
}
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Save data to files
const saveData = () => {
    try {
        fs.writeFileSync('data/users.json', JSON.stringify(users, null, 2));
        fs.writeFileSync('data/dogs.json', JSON.stringify(dogs, null, 2));
        fs.writeFileSync('data/matches.json', JSON.stringify(matches, null, 2));
        fs.writeFileSync('data/messages.json', JSON.stringify(messages, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
};

// Initialize sample data
const initializeSampleData = () => {
    if (dogs.length === 0) {
        dogs = [
            {
                id: 1,
                name: 'Buddy',
                age: '3 years',
                breed: 'Golden Retriever',
                image: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=400',
                bio: 'Loves playing fetch and swimming!',
                ownerId: null,
                location: 'New York, NY',
                interests: ['fetch', 'swimming', 'walks'],
                vaccinated: true,
                neutered: true
            },
            {
                id: 2,
                name: 'Luna',
                age: '2 years',
                breed: 'Husky',
                image: 'https://images.unsplash.com/photo-1547407139-3c921a66005c?w=400',
                bio: 'Adventure seeker and snow lover!',
                ownerId: null,
                location: 'Seattle, WA',
                interests: ['hiking', 'snow', 'running'],
                vaccinated: true,
                neutered: false
            },
            {
                id: 3,
                name: 'Max',
                age: '4 years',
                breed: 'German Shepherd',
                image: 'https://images.unsplash.com/photo-1589941013453-ec89f33b5e95?w=400',
                bio: 'Protective and loyal companion!',
                ownerId: null,
                location: 'Los Angeles, CA',
                interests: ['training', 'protection', 'loyalty'],
                vaccinated: true,
                neutered: true
            },
            {
                id: 4,
                name: 'Bella',
                age: '1 year',
                breed: 'Corgi',
                image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400',
                bio: 'Small but mighty! Loves treats and cuddles.',
                ownerId: null,
                location: 'Austin, TX',
                interests: ['cuddles', 'treats', 'play'],
                vaccinated: true,
                neutered: false
            },
            {
                id: 5,
                name: 'Rocky',
                age: '5 years',
                breed: 'Boxer',
                image: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400',
                bio: 'Energetic and playful! Always ready for fun.',
                ownerId: null,
                location: 'Miami, FL',
                interests: ['energy', 'play', 'fun'],
                vaccinated: true,
                neutered: true
            }
        ];
        saveData();
    }
};

// Routes

// Home route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API Routes

// User Registration
app.post('/api/auth/register', async (req, res) => {
    try {
        const { ownerName, dogName, email, password, dogAge, dogBreed, dogBio } = req.body;

        // Check if user already exists
        if (users.find(u => u.email === email)) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const newUser = {
            id: Date.now(),
            ownerName,
            dogName,
            email,
            password: hashedPassword,
            createdAt: new Date().toISOString(),
            profile: {
                age: dogAge || '',
                breed: dogBreed || '',
                bio: dogBio || '',
                image: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=100',
                location: '',
                interests: [],
                vaccinated: false,
                neutered: false
            }
        };

        users.push(newUser);
        saveData();

        // Generate JWT token
        const token = jwt.sign({ userId: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            user: {
                id: newUser.id,
                ownerName: newUser.ownerName,
                dogName: newUser.dogName,
                email: newUser.email,
                profile: newUser.profile
            },
            token
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                ownerName: user.ownerName,
                dogName: user.dogName,
                email: user.email,
                profile: user.profile
            },
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user profile
app.get('/api/user/profile', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.user.userId);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({
        id: user.id,
        ownerName: user.ownerName,
        dogName: user.dogName,
        email: user.email,
        profile: user.profile
    });
});

// Update user profile
app.put('/api/user/profile', authenticateToken, upload.single('image'), (req, res) => {
    try {
        const userIndex = users.findIndex(u => u.id === req.user.userId);
        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { age, breed, bio, location, interests, vaccinated, neutered } = req.body;

        // Update profile
        users[userIndex].profile = {
            ...users[userIndex].profile,
            age: age || users[userIndex].profile.age,
            breed: breed || users[userIndex].profile.breed,
            bio: bio || users[userIndex].profile.bio,
            location: location || users[userIndex].profile.location,
            interests: interests ? JSON.parse(interests) : users[userIndex].profile.interests,
            vaccinated: vaccinated === 'true',
            neutered: neutered === 'true'
        };

        // Handle image upload
        if (req.file) {
            users[userIndex].profile.image = `/uploads/${req.file.filename}`;
        }

        saveData();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: users[userIndex].profile
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get available dogs for swiping
app.get('/api/dogs', authenticateToken, (req, res) => {
    const currentUser = users.find(u => u.id === req.user.userId);
    if (!currentUser) {
        return res.status(404).json({ error: 'User not found' });
    }

    // Filter out user's own dog and already swiped dogs
    const availableDogs = dogs.filter(dog => 
        dog.ownerId !== req.user.userId && 
        !matches.some(match => 
            (match.dog1Id === req.user.userId && match.dog2Id === dog.id) ||
            (match.dog2Id === req.user.userId && match.dog1Id === dog.id)
        )
    );

    res.json(availableDogs);
});

// Create a match
app.post('/api/matches', authenticateToken, (req, res) => {
    try {
        const { dogId, action } = req.body; // action: 'like' or 'pass'
        const currentUser = users.find(u => u.id === req.user.userId);

        if (action === 'like') {
            // Check if it's a mutual match
            const isMatch = Math.random() > 0.7; // 30% chance for demo

            if (isMatch) {
                const newMatch = {
                    id: Date.now(),
                    dog1Id: req.user.userId,
                    dog2Id: dogId,
                    timestamp: new Date().toISOString(),
                    status: 'active'
                };

                matches.push(newMatch);
                saveData();

                // Create conversation
                const conversation = {
                    id: Date.now(),
                    matchId: newMatch.id,
                    participants: [req.user.userId, dogId],
                    messages: [],
                    createdAt: new Date().toISOString()
                };

                conversations.push(conversation);

                res.json({
                    success: true,
                    isMatch: true,
                    match: newMatch,
                    message: 'It\'s a match! 🎉'
                });
            } else {
                res.json({
                    success: true,
                    isMatch: false,
                    message: 'Dog liked!'
                });
            }
        } else {
            res.json({
                success: true,
                isMatch: false,
                message: 'Dog passed!'
            });
        }
    } catch (error) {
        console.error('Match creation error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user matches
app.get('/api/matches', authenticateToken, (req, res) => {
    const userMatches = matches.filter(match => 
        match.dog1Id === req.user.userId || match.dog2Id === req.user.userId
    );

    const matchesWithDetails = userMatches.map(match => {
        const otherDogId = match.dog1Id === req.user.userId ? match.dog2Id : match.dog1Id;
        const otherDog = dogs.find(dog => dog.id === otherDogId);
        const otherUser = users.find(user => user.id === otherDogId);

        return {
            ...match,
            otherDog: otherDog || otherUser,
            conversationId: conversations.find(conv => conv.matchId === match.id)?.id
        };
    });

    res.json(matchesWithDetails);
});

// Get conversation messages
app.get('/api/conversations/:conversationId/messages', authenticateToken, (req, res) => {
    const conversation = conversations.find(conv => conv.id === parseInt(req.params.conversationId));
    
    if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
    }

    // Check if user is part of conversation
    if (!conversation.participants.includes(req.user.userId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    res.json(conversation.messages);
});

// Send message
app.post('/api/conversations/:conversationId/messages', authenticateToken, (req, res) => {
    try {
        const { content } = req.body;
        const conversation = conversations.find(conv => conv.id === parseInt(req.params.conversationId));
        
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        // Check if user is part of conversation
        if (!conversation.participants.includes(req.user.userId)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const newMessage = {
            id: Date.now(),
            senderId: req.user.userId,
            content,
            timestamp: new Date().toISOString(),
            read: false
        };

        conversation.messages.push(newMessage);
        saveData();

        res.json({
            success: true,
            message: newMessage
        });
    } catch (error) {
        console.error('Message send error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Search dogs
app.get('/api/dogs/search', authenticateToken, (req, res) => {
    const { breed, age, location } = req.query;
    
    let filteredDogs = dogs.filter(dog => dog.ownerId !== req.user.userId);

    if (breed) {
        filteredDogs = filteredDogs.filter(dog => 
            dog.breed.toLowerCase().includes(breed.toLowerCase())
        );
    }

    if (age) {
        filteredDogs = filteredDogs.filter(dog => 
            dog.age.includes(age)
        );
    }

    if (location) {
        filteredDogs = filteredDogs.filter(dog => 
            dog.location.toLowerCase().includes(location.toLowerCase())
        );
    }

    res.json(filteredDogs);
});

// Get app statistics
app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: users.length,
        totalMatches: matches.length,
        totalDogs: dogs.length,
        activeConversations: conversations.length
    };

    res.json(stats);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
        }
    }
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Initialize sample data
initializeSampleData();

// Start server
app.listen(PORT, () => {
    console.log(`🚀 TIN-DOG server running on http://localhost:${PORT}`);
    console.log(`📱 Open your browser and navigate to the URL above`);
    console.log(`🐕 Ready to help dogs find their perfect match!`);
    console.log(`📊 Total users: ${users.length}, Total dogs: ${dogs.length}`);
});

module.exports = app; 