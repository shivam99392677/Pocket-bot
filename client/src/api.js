// ============================================================
// API HELPER - Centralized fetch calls with Firebase/JWT auth
// ============================================================
import { getIdToken } from './firebase';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

// Get the auth token (Firebase ID token or stored JWT)
async function getToken() {
    // Try Firebase token first
    const firebaseToken = await getIdToken();
    if (firebaseToken) return firebaseToken;

    // Fallback to stored JWT
    return localStorage.getItem('pocketbuddy_token');
}

// Make authenticated API call
async function apiCall(endpoint, options = {}) {
    const token = await getToken();
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers
        },
        ...options
    };

    // If body is an object, stringify it
    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
    }

    return data;
}

// ---- Auth ----
export const auth = {
    register: (body) => apiCall('/auth/register', { method: 'POST', body }),
    login: (body) => apiCall('/auth/login', { method: 'POST', body }),
    firebaseSync: (body) => apiCall('/auth/firebase-sync', { method: 'POST', body }),
    getProfile: () => apiCall('/auth/profile'),
    updateProfile: (body) => apiCall('/auth/profile', { method: 'PUT', body })
};

// ---- Feature 1: Expenses ----
export const expenses = {
    add: (body) => apiCall('/expenses', { method: 'POST', body }),
    list: (params = '') => apiCall(`/expenses?${params}`),
    summary: (days = 30) => apiCall(`/expenses/summary?days=${days}`),
    trends: () => apiCall('/expenses/trends'),
    delete: (id) => apiCall(`/expenses/${id}`, { method: 'DELETE' })
};

// ---- Feature 2: Food ----
export const food = {
    log: (body) => apiCall('/food/log', { method: 'POST', body }),
    getLog: (days = 7) => apiCall(`/food/log?days=${days}`),
    recommendations: () => apiCall('/food/recommendations'),
    budgetAnalysis: () => apiCall('/food/budget-analysis')
};

// ---- Feature 3: Travel ----
export const travel = {
    log: (body) => apiCall('/travel/log', { method: 'POST', body }),
    options: () => apiCall('/travel/options'),
    savings: () => apiCall('/travel/savings'),
    patterns: () => apiCall('/travel/patterns')
};

// ---- Feature 4: Burnout ----
export const burnout = {
    checkin: (body) => apiCall('/health/checkin', { method: 'POST', body }),
    score: () => apiCall('/burnout/score'),
    alert: () => apiCall('/burnout/alert'),
    trends: (days = 30) => apiCall(`/burnout/trends?days=${days}`),
    recommendations: () => apiCall('/burnout/recommendations')
};

// ---- Feature 5: Routine ----
export const routine = {
    setGoal: (body) => apiCall('/routine/goal', { method: 'POST', body }),
    plan: () => apiCall('/routine/plan'),
    checkin: (body) => apiCall('/routine/checkin', { method: 'POST', body }),
    progress: () => apiCall('/routine/progress'),
    tips: () => apiCall('/routine/tips')
};

// ---- Feature 6: Support ----
export const support = {
    chat: (message) => apiCall('/chat/chat', { method: 'POST', body: { message } }),
    chatHistory: (limit = 20) => apiCall(`/chat/chat/history?limit=${limit}`),
    suggestions: () => apiCall('/support/suggestions'),
    emergency: () => apiCall('/support/emergency'),
    feedback: (body) => apiCall('/support/feedback', { method: 'POST', body }),
    getAIRecommendation: () => apiCall('/support/recommendation'),
    getPurchaseAdvice: (body) => apiCall('/support/purchase-advice', { method: 'POST', body }),
    peerConnect: (body) => apiCall('/support/peer/connect', { method: 'POST', body })
};

// ---- Feature 7: v1 Analytics (ML endpoints) ----
export const v1 = {
    dashboard: (userId) => apiCall(`/v1/dashboard/${userId}`),
    burnout: (userId) => apiCall(`/v1/burnout/${userId}`),
    wellnessScore: (userId) => apiCall(`/v1/wellness-score/${userId}`),
    financialHealth: (userId) => apiCall(`/v1/financial-health/${userId}`),
    recommendations: (userId) => apiCall(`/v1/recommendations/${userId}`)
};

