Arogya Co-pilot
The Unified AI Health Ecosystem for Bharat.

🎯 Mission & Vision
Arogya Co-pilot is a comprehensive, AI-driven web application designed to serve as a personal health assistant for the diverse, multilingual population of India. The project's core mission is to make advanced health information and preliminary analysis tools accessible, understandable, and usable for everyone, regardless of their native language.

It aims to bridge the gap in healthcare accessibility by providing a suite of intelligent modules that can analyze health data, offer wellness plans, check for drug interactions, and connect users with local health services.

✨ Core Features
Deep Multilingual Support: Fully operational in English and 9 major Indian languages.

Secure User Authentication: Supports both email/password and anonymous guest sessions via Firebase.

Modular Architecture: A wide range of specialized "Health Modules" for targeted analysis.

Advanced AI Integration: Leverages the Google Gemini API for powerful text, image, and audio analysis, as well as conversational AI and Text-to-Speech (TTS).

Interactive UI/UX: A modern interface featuring glassmorphism, 3D animations with Three.js, and a fully responsive design for all devices.

🛠️ Technological Stack
The application is built as a single-file web app, relying on modern web technologies and external services delivered via CDNs for simplicity and rapid deployment.

Frontend:

HTML5

Tailwind CSS (Utility-first CSS framework)

JavaScript (ES Modules)

3D Graphics & Animation:

Three.js

Backend & Authentication:

Firebase Auth (Email/Password & Anonymous sign-in)

Firestore (Intended for future use)

Artificial Intelligence & Services:

Google Gemini API: The central AI engine for:

Multimodal Analysis (Text, Image, Audio)

Natural Language Understanding & Generation

Text-to-Speech (TTS)

Web Speech API: Integrated for speech-to-text functionality.

🚀 Features in Detail
🔐 User Authentication
The application provides a secure and flexible authentication flow managed by Firebase Auth.

Email & Password: Users can create an account or log in using their email and password.

Anonymous Access: Users can choose to "Continue Anonymously" for immediate access without creating an account. An anonymous UID is generated for session management.

Dynamic UI: The interface, including the visibility of the "Logout" button and the user ID display, updates automatically based on the user's authentication state.

🌍 Multilingual Interface
Accessibility is a cornerstone of the project, with robust support for 10 languages.

Language Selection: Users can select their preferred language from a dropdown menu on both the initial login modal and the main dashboard header.

Dynamic Translation: The setLanguage() function dynamically updates all text elements in the DOM by referencing a comprehensive translations object in the JavaScript. This ensures a seamless language switch without reloading the page.

🧩 Modular Architecture
The application's functionality is organized into distinct Health Modules, each designed for a specific purpose.

Module Discovery: Modules are displayed in a scrollable list in the sidebar, each with an icon, title, and description.

Dynamic Rendering: Clicking a module triggers the renderModule() function, which clears the main content area and builds the specific UI (input fields, file upload zones, buttons) required for that module.

Scalability: The architecture is highly scalable. New modules can be easily added to the allModules array with their required configuration without needing to change the core rendering logic.

🔬 In-Depth Module Explanations
This section provides a detailed breakdown of each of the 21 health modules available in Arogya Co-pilot.

Arogya-Future: Predictive Health Forecaster

Description: Analyzes key lifestyle and demographic data to provide a personalized forecast of potential long-term health risks.

How it Works: The user inputs age, gender, smoking status, and exercise habits. The AI processes this to identify risk factors and provide preventive advice.

Use Cases: Understanding lifestyle impact, establishing healthy habits, users with family history of certain conditions.

Advantages: Promotes preventive healthcare and simplifies complex risk calculations.

AI Wellness Planner

Description: Creates customized wellness plans based on health goals, dietary habits, and medical conditions.

How it Works: User specifies their goal, diet, and conditions. The AI generates a tailored diet, exercise, and lifestyle plan.

Use Cases: Planning a new diet/fitness regimen, managing a health condition via lifestyle changes.

Advantages: Highly personalized, holistic, and provides a structured, easy-to-follow plan.

Health-Trend AI: Medical Report Analyzer

Description: An AI-powered tool to interpret and simplify complex medical lab reports.

How it Works: User uploads an image of their report. The AI reads the report, explains values, highlights abnormalities, and suggests implications.

Use Cases: Understanding blood tests, tracking health trends, assisting caregivers.

Advantages: Demystifies medical jargon and empowers patients for doctor-patient conversations.

Med-Sentry AI: Drug Interaction Checker

Description: A safety tool that checks for potentially harmful interactions between multiple medications.

How it Works: User lists their medications. The AI cross-references them, identifies interactions, and provides clear warnings.

Use Cases: Starting new medication, patients with multiple prescriptions.

Advantages: Enhances medication safety and helps prevent adverse drug reactions.

Arogya-SOS: AI Emergency Response

Description: An emergency module that provides immediate access to critical information and emergency contact numbers.

How it Works: A static module displaying national emergency numbers (102, 108, 112) for immediate use.

Use Cases: Medical emergencies requiring a quick call for an ambulance or other services.

Advantages: Fast, simple, and provides potentially life-saving information.

Sonus AI: Acoustic Diagnostic System

Description: Uses audio analysis to detect potential health issues from bodily sounds like coughs and breathing.

How it Works: User uploads a short audio recording. The AI analyzes acoustic features for characteristics of respiratory conditions.

Use Cases: Getting a preliminary analysis of a persistent cough.

Advantages: Non-invasive, provides a novel data point for health assessment.

Vocal-Tone AI: Vocal Biomarker Analysis

Description: Analyzes the human voice for subtle biomarkers that could indicate underlying health issues.

How it Works: User uploads a voice recording. The AI analyzes pitch, jitter, and shimmer.

Use Cases: Tracking vocal changes that might be early indicators of health issues.

Advantages: A cutting-edge, non-invasive screening method.

Dermalens: AI Skin Health Analyzer

Description: Uses image recognition to provide a preliminary analysis of skin conditions.

How it Works: User uploads an image of a mole, rash, or skin concern. The AI analyzes visual characteristics.

Use Cases: Getting preliminary information about a skin spot and deciding on a dermatologist visit.

Advantages: Provides instant visual analysis and guides users on seeking professional consultation.

Mycro: Gut Microbiome Simulator

Description: Simulates the user's gut microbiome based on dietary inputs and symptoms.

How it Works: User inputs diet and symptoms. The AI models the likely gut microbiome state and suggests dietary changes.

Use Cases: Understanding the diet-digestive health connection, managing IBS, optimizing nutrition.

Advantages: Provides insights into a complex biological system and offers personalized advice.

Cogni-Pulse: Cognitive Decline Detection

Description: A tool for early-stage screening of cognitive decline by analyzing user text responses.

How it Works: The AI analyzes language patterns, memory recall, and semantic fluency for subtle signs of cognitive decline.

Use Cases: Regular self-screening for older adults.

Advantages: Non-invasive, accessible screening method.

Ayurveda AI: Medicinal Plant Identifier

Description: An educational tool that uses image recognition to identify medicinal plants and their traditional uses.

How it Works: User uploads a plant picture. The AI identifies it and details its Ayurvedic properties.

Use Cases: Identifying local flora for home remedies or educational purposes.

Advantages: Educational and preserves traditional knowledge.

Gait-Guard: AI Posture & Gait Analysis

Description: Analyzes user descriptions of posture and walking patterns to identify potential musculoskeletal issues.

How it Works: User describes their posture or pain. The AI suggests potential causes and corrective exercises.

Use Cases: Identifying posture problems, analyzing a limp, getting ergonomic advice.

Advantages: Provides accessible postural analysis and can help prevent chronic pain.

EHR-Summarizer: Health Record Interpreter

Description: Takes unstructured electronic health record (EHR) text and summarizes it into a clear, patient-friendly format.

How it Works: User pastes EHR text. The AI identifies key diagnoses, medications, and plans, presenting a simple summary.

Use Cases: Patients trying to understand their medical history; caregivers.

Advantages: Translates complex medical terminology and improves patient understanding.

MindWell: Empathetic Mental Companion

Description: A conversational AI for empathetic listening and mental wellness support (not a substitute for therapy).

How it Works: The user chats with the AI. The AI responds with empathy and guides users in crisis toward professional help.

Use Cases: Daily mood journaling, talking through mild anxiety.

Advantages: Provides 24/7 immediate emotional support and reduces stigma.

Vision-Fit: AI-Powered Physiotherapist

Description: Provides guidance on physiotherapy exercises based on user-described symptoms or goals.

How it Works: User describes their issue (e.g., "lower back pain"). The AI suggests safe, standard physiotherapy exercises.

Use Cases: Managing minor aches, supplementing professional physiotherapy.

Advantages: Makes basic physiotherapy knowledge accessible and promotes self-care.

Govt. Health Schemes

Description: Connects users to relevant government healthcare programs and insurance schemes.

How it Works: User selects their state/district. The module displays relevant central and state-level programs.

Use Cases: Checking eligibility for programs like Ayushman Bharat.

Advantages: Bridges the information gap between citizens and public services.

Geno-Predict AI: Genetic Marker Analysis

Description: Interprets raw genetic data to identify predispositions for certain health conditions.

How it Works: User pastes raw data from a genetic test. The AI provides information about potential health risks.

Use Cases: Users of consumer genetic tests wanting to understand specific markers.

Advantages: Helps users make sense of their genetic data for proactive health planning.

Hospital Connect

Description: Streamlines interactions with local hospitals for services like appointment booking.

How it Works: Users select their location and needed service to submit a structured request.

Use Cases: Booking hospital appointments, requesting emergency transport.

Advantages: Simplifies administrative processes.

AI-Scribe: Voice-to-Clinical Notes

Description: A productivity tool that converts spoken language into structured clinical notes.

How it Works: The app transcribes speech, and the Gemini API organizes it into a standard format like SOAP.

Use Cases: Doctors dictating patient notes, patients summarizing symptoms.

Advantages: Saves time on manual note-taking and allows for hands-free operation.

Digital Twin Simulator

Description: A simulation tool that projects the potential long-term health impact of specific lifestyle changes.

How it Works: User inputs baseline metrics and a change (e.g., "start running"). The AI forecasts the long-term impact.

Use Cases: Motivating users by visualizing benefits.

Advantages: Highly engaging and provides powerful motivation for behavior change.

Outbreak Predictor: AI-Powered Epidemic Forecasting

Description: A public health tool that assesses the risk of an infectious disease outbreak in a specific area.

How itWorks: User selects a location and inputs symptoms. The AI provides a risk level and suggests public health measures.

Use Cases: Public health officials tracking local trends.

Advantages: Provides an early-warning system and empowers communities.

🤖 Arogya Assistant & TTS
Conversational AI: A slide-out chat panel provides a general-purpose AI assistant for health-related questions. It supports both text and voice input.

Text-to-Speech: AI-generated responses in modules and the assistant can be read aloud. The speak() function:

Calls the Gemini TTS API with the text and selected language.

Receives raw PCM audio data.

Converts the PCM data into a playable WAV blob in the browser.

Manages an Audio object to play the sound and update the UI state.

🏗️ Code Structure & Logic
The entire application is self-contained within index.html.

<style> block: Contains all the CSS, including custom styles and variables that complement Tailwind CSS.

HTML <body>: Defines the complete DOM structure for the modal, main app wrapper, sidebar, and assistant panel.

<script type="module">: The core of the application logic.

Global State (state object): A single object holds the application's state, such as selectedLanguage, isLoggedIn, activeModule, etc.

Initialization (DOMContentLoaded): This is the entry point. It initializes Firebase, sets up the Three.js scene, and attaches all primary event listeners.

renderModule(module): The primary function for UI generation. It acts as a router, building the appropriate HTML form for the selected module and injecting it into the main content area.

setupModuleEventListeners(module): Called after a module is rendered, this function attaches the necessary event listeners (e.g., the "Analyze" button click handler).

callGeminiAPI(...): The central function for interacting with the Gemini model. It constructs the API payload, handles the fetch request with a retry mechanism, and displays the response.

Helper Functions: Numerous helper functions manage tasks like language translation (getTranslation), DOM manipulation (getEl), file handling (handleFileUpload), and chat message display (displayChatMessage).

🔧 Setup & Deployment
Dependencies
The project has no local dependencies or build steps. All required libraries are loaded directly from CDNs:

Tailwind CSS

Three.js

Firebase SDK (App, Auth, Firestore)

Firebase Configuration
To run the application, you must have a Firebase project with Authentication enabled. The application is designed to receive its Firebase configuration from globally injected variables:

__firebase_config__: A JSON string containing the Firebase project credentials.

__app_id__: A unique identifier for the application instance.

__initial_auth_token__: An optional pre-generated token for seamless sign-in.

Deployment
The index.html file can be deployed on any static web hosting service, such as:

Firebase Hosting

GitHub Pages

Netlify

Vercel

No server-side logic is required, as all backend operations are handled through the client-side Firebase SDK and calls to the Google Gemini API.

📄 License
This project is licensed under the MIT License. See the LICENSE file for details.
