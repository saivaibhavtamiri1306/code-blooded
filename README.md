Arogya Co-pilot: Project Documentation
1. Project Overview
Project Name: Arogya Co-pilot
Tagline: The Unified AI Health Ecosystem for Bharat.
Mission & Vision
Arogya Co-pilot is a comprehensive, AI-driven web application designed to serve as a personal health assistant for the diverse, multilingual population of India. The project's core mission is to make advanced health information and preliminary analysis tools accessible, understandable, and usable for everyone, regardless of their native language.
It aims to bridge the gap in healthcare accessibility by providing a suite of intelligent modules that can analyze health data, offer wellness plans, check for drug interactions, and connect users with local health services.
Core Features
Deep Multilingual Support: Fully operational in English and 9 major Indian languages.
Secure User Authentication: Supports both email/password and anonymous guest sessions via Firebase.
Modular Architecture: A wide range of specialized "Health Modules" for targeted analysis.
Advanced AI Integration: Leverages the Google Gemini API for powerful text, image, and audio analysis, as well as conversational AI and Text-to-Speech (TTS).
Interactive UI/UX: A modern interface featuring glassmorphism, 3D animations with Three.js, and a fully responsive design for all devices.
2. Technological Stack
The application is built as a single-file web app, relying on modern web technologies and external services delivered via CDNs for simplicity and rapid deployment.
Frontend:
HTML5: The structural backbone of the application.
Tailwind CSS: A utility-first CSS framework for building the responsive and modern user interface.
JavaScript (ES Modules): The core logic of the application, handling everything from UI rendering to API calls.
3D Graphics & Animation:
Three.js: Used to create the immersive and aesthetically pleasing animated 3D background with particles and a DNA helix.
Backend & Authentication:
Firebase Auth: Manages secure user authentication, supporting email/password and anonymous sign-in methods.
Firestore: (Intended for future use) To store user data, module history, and other persistent information.
Artificial Intelligence & Services:
Google Gemini API: The central AI engine for:
Multimodal Analysis: Processing text, images (medical reports, skin conditions), and audio (coughs, vocal biomarkers).
Natural Language Understanding & Generation: Powering the Arogya Assistant chatbot and generating insights within modules.
Text-to-Speech (TTS): Providing voice-based output for AI responses in multiple languages.
Web Speech API: Integrated for speech-to-text functionality, allowing users to interact with the assistant and modules using their voice.
