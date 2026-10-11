# 🇮🇹🇧🇩 Patente B Italia (বাংলা)

> **ইতালিয়ান ড্রাইভিং লাইসেন্স (Patente B) কুইজ বাংলা ব্যাখ্যা সহ (100% Free Trial)**  
> An interactive bilingual Italian-Bangla exam simulator and study portal for the Italian Driving License (Patente B).

---

## 🌟 Key Features

1. **🚦 Authentic SVG Italian Road Signs (`RoadSign.tsx`)**:
   - High-definition vector representations for STOP signs, Give Way triangles, danger signs, parking/stopping bans, speed limits, and overtaking prohibitions.
2. **🎯 30-Question Official Exam Simulator**:
   - Official ministerial format: 30 Questions, 20-minute countdown timer, max 3 mistakes passing rule.
   - Interactive 30-question matrix navigation with instant pass/fail verdict and confetti celebration.
3. **🎮 240-Round Game Map Progression**:
   - Systematic level-by-level study roadmap across all 25 chapters of the Italian Highway Code (*Codice della Strada*).
   - Rounds 1 to 7 are **100% Free** (up to 200 questions).
4. **🔒 €49 Lifetime VIP Membership Paywall**:
   - Unlocks all 240 rounds and 7,100+ questions.
   - Designed for Italian payment methods: PostePay Evolution, Credit Card, PayPal, Satispay.
5. **📖 Tricky Word Vocabulary & Audio Speech (TTS)**:
   - Searchable glossary of bureaucratic terms (*Carreggiata, Spartitraffico, Sorpasso, Sosta, Fermata, Dosso*) with native Italian text-to-speech audio pronunciation.
6. **❌ Persistent Mistake Bank**:
   - Saves failed questions in browser `localStorage` for targeted revision until zero errors.

---

## 🛠️ Tech Stack

- **Framework**: Next.js + React + TypeScript
- **Authentication**: Better Auth (MongoDB sessions, email/password, Google OAuth, email verification)
- **Database**: MongoDB Atlas (authentication and student data); Firebase Firestore remains for app settings/admin data only
- **Styling**: Tailwind CSS (Glassmorphism & Responsive layout)
- **Icons**: Lucide React
- **Animations**: Canvas Confetti
- **Audio**: Web Speech API (Native Italian TTS)

---

## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/shifat-manjum/patente-bangla-italia.git

# Navigate to project directory
cd patente-bangla-italia

# Install dependencies
npm install

# Configure local environment
cp .env.example .env
# Set BETTER_AUTH_SECRET, BETTER_AUTH_URL, MONGODB_URI, Google OAuth credentials,
# and RESEND_API_KEY in .env before using authentication.

# Start local development server
npm run dev
```

For Google OAuth, register `${BETTER_AUTH_URL}/api/auth/callback/google` as an
authorized redirect URI in Google Cloud Console. Email/password registration
requires email verification, sent through Resend.

Firebase client settings are read from the `NEXT_PUBLIC_FIREBASE_*` variables
in `.env`. Because these variables are included in browser code, the Firebase
API key is public configuration, not a secret. Restrict the key to the APIs and
web origins this app needs, and protect Firestore data with Security Rules and
App Check.

---

## ⚖️ Legal Disclaimer

*Patente B Italia (বাংলা)* is an independent educational platform created to assist Bengali speakers in studying the Italian Highway Code (*Codice della Strada*). This platform is **NOT affiliated with, authorized, or sponsored by the Ministero delle Infrastrutture e dei Trasporti (MIT)** or the *Motorizzazione Civile*. All quiz questions are based on public domain ministerial decrees under Article 5 of Italian Law n. 633/1941.
# Patentaguru
