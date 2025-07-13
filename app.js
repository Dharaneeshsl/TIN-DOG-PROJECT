// TIN-DOG Application - Complete Full-Stack Implementation

class TinDogApp {
    constructor() {
        this.currentUser = null;
        this.dogs = [];
        this.matches = [];
        this.messages = [];
        this.currentCardIndex = 0;
        this.token = localStorage.getItem('token');
        this.apiBase = 'http://localhost:3000/api';
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.checkAuthStatus();
        this.generateSampleDogs();
    }

    // Data Management
    async loadData() {
        if (this.token) {
            try {
                await this.loadUserProfile();
                await this.loadDogs();
                await this.loadMatches();
            } catch (error) {
                console.error('Error loading data:', error);
                this.logout();
            }
        }
    }

    saveToken(token) {
        this.token = token;
        localStorage.setItem('token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('token');
    }

    // API Methods
    async loadUserProfile() {
        try {
            const response = await fetch(`${this.apiBase}/user/profile`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                this.currentUser = await response.json();
            } else {
                throw new Error('Failed to load profile');
            }
        } catch (error) {
            console.error('Error loading profile:', error);
            throw error;
        }
    }

    async loadDogs() {
        try {
            const response = await fetch(`${this.apiBase}/dogs`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                this.dogs = await response.json();
            } else {
                throw new Error('Failed to load dogs');
            }
        } catch (error) {
            console.error('Error loading dogs:', error);
            // Fallback to sample data
            this.generateSampleDogs();
        }
    }

    async loadMatches() {
        try {
            const response = await fetch(`${this.apiBase}/matches`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                this.matches = await response.json();
            } else {
                throw new Error('Failed to load matches');
            }
        } catch (error) {
            console.error('Error loading matches:', error);
            this.matches = [];
        }
    }

    // Event Listeners
    setupEventListeners() {
        // Navigation
        document.getElementById('loginBtn').addEventListener('click', () => this.showLoginModal());
        document.getElementById('signupBtn').addEventListener('click', () => this.showSignupModal());
        document.getElementById('getStartedBtn').addEventListener('click', () => this.showSignupModal());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

        // Forms
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('signupForm').addEventListener('submit', (e) => this.handleSignup(e));
        document.getElementById('profileForm').addEventListener('submit', (e) => this.handleProfileUpdate(e));

        // Swipe buttons
        document.getElementById('likeBtn').addEventListener('click', () => this.likeDog());
        document.getElementById('nopeBtn').addEventListener('click', () => this.nopeDog());

        // Navigation links
        document.querySelectorAll('[data-section]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSection(e.target.closest('a').dataset.section);
            });
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.nopeDog();
            if (e.key === 'ArrowRight') this.likeDog();
        });
    }

    // Authentication
    async checkAuthStatus() {
        if (this.token) {
            try {
                await this.loadData();
                this.showApp();
            } catch (error) {
                console.error('Auth check failed:', error);
                this.clearToken();
                this.showLanding();
            }
        } else {
            this.showLanding();
        }
    }

    showLoginModal() {
        const modal = new bootstrap.Modal(document.getElementById('loginModal'));
        modal.show();
    }

    showSignupModal() {
        const modal = new bootstrap.Modal(document.getElementById('signupModal'));
        modal.show();
    }

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        try {
            const response = await fetch(`${this.apiBase}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                this.currentUser = data.user;
                this.saveToken(data.token);
                await this.loadData();
                this.showApp();
                this.showAlert('Login successful!', 'success');
                bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            } else {
                this.showAlert(data.error || 'Login failed', 'danger');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showAlert('Network error. Please try again.', 'danger');
        }
    }

    async handleSignup(e) {
        e.preventDefault();
        const ownerName = document.getElementById('ownerName').value;
        const dogName = document.getElementById('dogName').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;

        try {
            const response = await fetch(`${this.apiBase}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    ownerName, 
                    dogName, 
                    email, 
                    password,
                    dogAge: '',
                    dogBreed: '',
                    dogBio: ''
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.currentUser = data.user;
                this.saveToken(data.token);
                await this.loadData();
                this.showApp();
                this.showAlert('Account created successfully!', 'success');
                bootstrap.Modal.getInstance(document.getElementById('signupModal')).hide();
            } else {
                this.showAlert(data.error || 'Registration failed', 'danger');
            }
        } catch (error) {
            console.error('Signup error:', error);
            this.showAlert('Network error. Please try again.', 'danger');
        }
    }

    logout() {
        this.currentUser = null;
        this.clearToken();
        this.showLanding();
        this.showAlert('Logged out successfully', 'success');
    }

    // UI Management
    showLanding() {
        document.getElementById('appSection').classList.add('d-none');
        document.querySelector('nav').classList.remove('d-none');
        document.getElementById('home').classList.remove('d-none');
    }

    showApp() {
        document.getElementById('appSection').classList.remove('d-none');
        document.querySelector('nav').classList.add('d-none');
        document.getElementById('home').classList.add('d-none');
        
        this.updateUserProfile();
        this.loadCurrentCard();
        this.loadMatches();
        this.loadMessages();
    }

    showSection(sectionName) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.add('d-none');
        });

        // Show selected section
        document.getElementById(sectionName + 'Section').classList.remove('d-none');

        // Update navigation
        document.querySelectorAll('.sidebar .nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionName}"]`).classList.add('active');
    }

    updateUserProfile() {
        if (this.currentUser) {
            document.getElementById('currentDogName').textContent = this.currentUser.dogName;
        }
    }

    // Dog Matching System
    generateSampleDogs() {
        if (this.dogs.length === 0) {
            const sampleDogs = [
                {
                    id: 1,
                    name: 'Buddy',
                    age: '3 years',
                    breed: 'Golden Retriever',
                    image: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=400',
                    bio: 'Loves playing fetch and swimming!'
                },
                {
                    id: 2,
                    name: 'Luna',
                    age: '2 years',
                    breed: 'Husky',
                    image: 'https://images.unsplash.com/photo-1547407139-3c921a66005c?w=400',
                    bio: 'Adventure seeker and snow lover!'
                },
                {
                    id: 3,
                    name: 'Max',
                    age: '4 years',
                    breed: 'German Shepherd',
                    image: 'https://images.unsplash.com/photo-1589941013453-ec89f33b5e95?w=400',
                    bio: 'Protective and loyal companion!'
                },
                {
                    id: 4,
                    name: 'Bella',
                    age: '1 year',
                    breed: 'Corgi',
                    image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400',
                    bio: 'Small but mighty! Loves treats and cuddles.'
                },
                {
                    id: 5,
                    name: 'Rocky',
                    age: '5 years',
                    breed: 'Boxer',
                    image: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400',
                    bio: 'Energetic and playful! Always ready for fun.'
                }
            ];
            this.dogs = sampleDogs;
            this.saveData();
        }
    }

    loadCurrentCard() {
        if (this.currentCardIndex >= this.dogs.length) {
            this.currentCardIndex = 0;
        }

        const dog = this.dogs[this.currentCardIndex];
        if (dog) {
            document.getElementById('cardImage').src = dog.image;
            document.getElementById('cardName').textContent = dog.name;
            document.getElementById('cardAge').textContent = dog.age;
            document.getElementById('cardBreed').textContent = dog.breed;
        }
    }

    async likeDog() {
        const currentDog = this.dogs[this.currentCardIndex];
        
        try {
            const response = await fetch(`${this.apiBase}/matches`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    dogId: currentDog.id,
                    action: 'like'
                })
            });

            const data = await response.json();

            if (response.ok && data.isMatch) {
                this.showMatchAlert(currentDog);
                await this.loadMatches(); // Refresh matches
            }

            this.nextCard();
        } catch (error) {
            console.error('Error liking dog:', error);
            this.nextCard();
        }
    }

    async nopeDog() {
        const currentDog = this.dogs[this.currentCardIndex];
        
        try {
            await fetch(`${this.apiBase}/matches`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    dogId: currentDog.id,
                    action: 'pass'
                })
            });
        } catch (error) {
            console.error('Error passing dog:', error);
        }
        
        this.nextCard();
    }

    nextCard() {
        this.currentCardIndex++;
        if (this.currentCardIndex >= this.dogs.length) {
            this.currentCardIndex = 0;
        }
        this.loadCurrentCard();
    }



    showMatchAlert(dog) {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-success alert-dismissible fade show position-fixed';
        alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        alertDiv.innerHTML = `
            <strong>It's a Match! 🎉</strong><br>
            You and ${dog.name} liked each other!
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alertDiv);
        
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 5000);
    }

    // Matches Management
    loadMatches() {
        const matchesList = document.getElementById('matchesList');
        matchesList.innerHTML = '';

        this.matches.forEach(match => {
            const otherDog = match.otherDog;
            if (!otherDog) return;

            const matchCard = document.createElement('div');
            matchCard.className = 'col-md-4 col-lg-3';
            matchCard.innerHTML = `
                <div class="match-card">
                    <img src="${otherDog.image || otherDog.profile?.image}" alt="${otherDog.name || otherDog.dogName}">
                    <h5>${otherDog.name || otherDog.dogName}</h5>
                    <p class="text-muted">${otherDog.breed || otherDog.profile?.breed}</p>
                    <button class="btn btn-primary btn-sm" onclick="app.openChat('${match.conversationId}')">
                        <i class="fas fa-comments me-1"></i>Message
                    </button>
                </div>
            `;
            matchesList.appendChild(matchCard);
        });
    }

    // Messaging System
    loadMessages() {
        const messagesList = document.getElementById('messagesList');
        messagesList.innerHTML = '';

        this.matches.forEach(match => {
            const otherDog = match.otherDog;
            if (!otherDog) return;

            const messageItem = document.createElement('div');
            messageItem.className = 'message-item';
            messageItem.innerHTML = `
                <div class="message-header">
                    <img src="${otherDog.image || otherDog.profile?.image}" alt="${otherDog.name || otherDog.dogName}">
                    <div>
                        <h6>${otherDog.name || otherDog.dogName}</h6>
                        <small class="text-muted">${otherDog.breed || otherDog.profile?.breed}</small>
                    </div>
                </div>
                <p class="text-muted">Click to start chatting!</p>
            `;
            messageItem.addEventListener('click', () => this.openChat(match.conversationId));
            messagesList.appendChild(messageItem);
        });
    }

    openChat(matchId) {
        // In a real app, this would open a chat interface
        this.showAlert('Chat feature coming soon!', 'info');
    }

    // Profile Management
    async handleProfileUpdate(e) {
        e.preventDefault();
        
        const formData = new FormData();
        formData.append('age', document.getElementById('profileAge').value);
        formData.append('breed', document.getElementById('profileBreed').value);
        formData.append('bio', document.getElementById('profileBio').value);
        formData.append('location', this.currentUser.profile.location || '');
        formData.append('interests', JSON.stringify(this.currentUser.profile.interests || []));
        formData.append('vaccinated', this.currentUser.profile.vaccinated || false);
        formData.append('neutered', this.currentUser.profile.neutered || false);

        const imageFile = document.getElementById('profilePicture').files[0];
        if (imageFile) {
            formData.append('image', imageFile);
        }

        try {
            const response = await fetch(`${this.apiBase}/user/profile`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                },
                body: formData
            });

            const data = await response.json();

            if (response.ok) {
                this.currentUser.profile = data.profile;
                this.showAlert('Profile updated successfully!', 'success');
            } else {
                this.showAlert(data.error || 'Profile update failed', 'danger');
            }
        } catch (error) {
            console.error('Profile update error:', error);
            this.showAlert('Network error. Please try again.', 'danger');
        }
    }

    // Utility Functions
    showAlert(message, type) {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
        alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alertDiv);
        
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 3000);
    }


}

// Initialize the application
const app = new TinDogApp();

// Additional utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add loading states to buttons
document.querySelectorAll('button[type="submit"]').forEach(button => {
    button.addEventListener('click', function() {
        const originalText = this.innerHTML;
        this.innerHTML = '<span class="loading"></span> Loading...';
        this.disabled = true;
        
        setTimeout(() => {
            this.innerHTML = originalText;
            this.disabled = false;
        }, 2000);
    });
});

// Add search functionality (for future enhancement)
function searchDogs(query) {
    return app.dogs.filter(dog => 
        dog.name.toLowerCase().includes(query.toLowerCase()) ||
        dog.breed.toLowerCase().includes(query.toLowerCase())
    );
}

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TinDogApp;
} 