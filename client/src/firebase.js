// ============================================================
// FIREBASE CLIENT CONFIG
// Replace the values below with your Firebase project config
// Get these from: Firebase Console → Project Settings → Your apps → Web app
// ============================================================
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    GoogleAuthProvider,
    signInWithPopup
} from 'firebase/auth';

const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyAxJJgI_f1C3m9r0rMEUUigptA9hIqwNkk",
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "pocketbuddy-f580d.firebaseapp.com",
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "pocketbuddy-f580d",
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "pocketbuddy-f580d.firebasestorage.app",
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "472300580815",
    appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:472300580815:web:45f2c51151aed573caacba",
    measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || "G-CVSVCMZC8E"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// ---- Auth Helper Functions ----

// Register a new user with email/password
export async function registerWithEmail(email, password, displayName) {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    // Set the display name
    await updateProfile(userCredential.user, { displayName });
    return userCredential.user;
}

// Login with email/password
export async function loginWithEmail(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
}

// Login with Google
export async function loginWithGoogle() {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
}

// Logout
export async function logout() {
    await signOut(auth);
}

// Get the current user's ID token (for API calls)
// export async function getIdToken() {
//     const user = auth.currentUser;
//     if (!user) return null;
//     return await user.getIdToken();
// }

export async function getIdToken() {
    const user = auth.currentUser;

    console.log("Current User:", user);

    if (!user) return null;

    const token = await user.getIdToken();

    console.log("Token Generated:", token);

    return token;
}

// Listen for auth state changes
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, callback);
}

export { auth };
export default app;
