import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBzatW8S9YboSNjMdJcgQopEi5EIK_m3X4",
    authDomain: "adammakescoffee-d0068.firebaseapp.com",
    projectId: "adammakescoffee-d0068",
    storageBucket: "adammakescoffee-d0068.firebasestorage.app",
    messagingSenderId: "854152075483",
    appId: "1:854152075483:web:a5bfc1f94803c3def194fe",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);