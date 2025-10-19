import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, collection, query, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let app, db, auth;
let userId = null;
let scene, camera, renderer, particles, dna, orb;
let mouseX = 0, mouseY = 0;
let audioPlayer = null; // To manage the currently playing audio

// NOTE: Replace with your actual Firebase config if different
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyCJYyqeCGlsUreOFyR4LXrlZDKublc15Ik", // Replace with your key if different
  authDomain: "arogya-copilot.firebaseapp.com", // Replace if different
  projectId: "arogya-copilot", // Replace if different
  storageBucket: "arogya-copilot.firebasestorage.app", // Replace if different
  messagingSenderId: "743739908215", // Replace if different
  appId: "1:743739908215:web:08aa603e2627d0f0dd2672" // Replace if different
};

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

const state = {
    selectedLanguage: 'en-US', isRecording: false, isLoggedIn: false, firestoreReady: false,
    uploadedFiles: [], moduleHistory: {}, isTTSEnabled: true, isSidebarOpen: false, activeModule: null
};

const getEl = id => document.getElementById(id);
const welcomeAuthModal = getEl('welcome-auth-modal'), appWrapper = getEl('app-wrapper'),
      chatWindow = getEl('chat-window'), chatInput = getEl('chat-input'),
      mainModuleContent = getEl('main-module-content'), arogyaAssistantPanel = getEl('arogya-assistant-panel'),
      arogyaAssistantToggle = getEl('arogya-assistant-toggle');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) { recognition.continuous = false; recognition.interimResults = false; }

// --- TTS Helper Functions (API-based) ---
const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) { bytes[i] = binaryString.charCodeAt(i); }
    return bytes.buffer;
};

const pcmToWav = (pcmData, sampleRate) => {
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);

    // RIFF chunk descriptor
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + pcmData.byteLength, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // Sub-chunk size
    view.setUint16(20, 1, true); // Audio format (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // Byte rate
    view.setUint16(32, numChannels * bytesPerSample, true); // Block align
    view.setUint16(34, bytesPerSample * 8, true); // Bits per sample
    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, pcmData.byteLength, true);

    return new Blob([wavHeader, pcmData], { type: 'audio/wav' });
};

const VOICE_CONFIG = {
    'en-US': { voiceName: 'Zephyr' },
    'hi-IN': { voiceName: 'Kore' },
    'bn-IN': { voiceName: 'Puck' },
    'te-IN': { voiceName: 'Leda' },
    'mr-IN': { voiceName: 'Charon' },
    'ta-IN': { voiceName: 'Fenrir' },
    'gu-IN': { voiceName: 'Aoede' },
    'kn-IN': { voiceName: 'Orus' },
    'ml-IN': { voiceName: 'Sadachbia' },
    'pa-IN': { voiceName: 'Callirrhoe' }
};

const speak = async (text, btn) => {
    const isLoading = btn && btn.classList.contains('loading-speech');
    const isSpeaking = btn && btn.classList.contains('speaking');

    // Stop any currently playing audio
    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.src = '';
        audioPlayer = null;
    }
    // Reset all other buttons
    document.querySelectorAll('.speak-btn.speaking, .speak-btn.loading-speech').forEach(b => {
        b.classList.remove('speaking', 'loading-speech');
    });

    // If the clicked button was already active, the above code stops it. So we just return.
    if (isLoading || isSpeaking) {
        return;
    }

    if (!text || !btn) return;

    btn.classList.add('loading-speech'); // Show loader immediately

    const langConfig = VOICE_CONFIG[state.selectedLanguage];
    if (!langConfig) {
        console.error(`No voice configuration found for language: ${state.selectedLanguage}`);
        if (btn) btn.classList.remove('loading-speech');
        return;
    }

    const apiKey = "AIzaSyCbPOQM8vN7pou3lupqEd-1MfTFGnA61UM"; // Replace with your Gemini API Key
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`; // Use 1.5 Flash
    const payload = {
        model: "models/gemini-1.5-flash-latest", // Specify model for TTS
        contents: [{ role: "user", parts: [{ text }] }], // Use user role for content
        generationConfig: {
            responseMimeType: "audio/wav", // Request WAV directly if supported, else process PCM
            // Note: Check if the API directly supports WAV output for TTS models.
            // If not, you'll need the PCM processing as before. Assuming PCM for now.
        },
        // TTS specific configuration might need a different structure/endpoint
        // Let's assume the previous TTS endpoint structure was correct for TTS generation:
         ttsConfig: { // This structure might be hypothetical, check API docs
             audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
             voice: { languageCode: state.selectedLanguage, name: langConfig.voiceName }
         }
        // Fallback to previous payload structure if the above doesn't work for TTS:
        /*
        contents: [{ parts: [{ text }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: langConfig } }
        }
        */
    };

     // Choose the correct API endpoint and payload structure for TTS
     const ttsApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-preview-tts:generateContent?key=${apiKey}`; // Assuming this is correct TTS endpoint
     const ttsPayload = {
         contents: [{ parts: [{ text }] }],
         generationConfig: {
             responseModalities: ["AUDIO"],
             speechConfig: { voiceConfig: { prebuiltVoiceConfig: langConfig } }
         }
     };


    try {
        const response = await fetchWithRetry(ttsApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ttsPayload) });
        const result = await response.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;

        if (audioData && mimeType?.startsWith("audio/")) {
            // Determine if it's PCM or WAV/MP3 etc.
            if (mimeType.includes("pcm") || mimeType.includes("linear16")) {
                 const sampleRateMatch = mimeType.match(/rate=(\d+)/);
                 const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 24000; // Default sample rate
                 const pcmData = base64ToArrayBuffer(audioData);
                 // Ensure buffer length is even for Int16Array
                 const bufferLength = pcmData.byteLength % 2 === 0 ? pcmData.byteLength : pcmData.byteLength - 1;
                 const pcmInt16Data = new Int16Array(pcmData.slice(0, bufferLength));
                 const wavBlob = pcmToWav(pcmInt16Data.buffer, sampleRate);
                 const audioUrl = URL.createObjectURL(wavBlob);
                 playAudio(audioUrl, btn);
            } else {
                 // Directly play if it's a standard format like wav, mp3, ogg
                 const audioBlob = new Blob([base64ToArrayBuffer(audioData)], { type: mimeType });
                 const audioUrl = URL.createObjectURL(audioBlob);
                 playAudio(audioUrl, btn);
            }

        } else {
            console.error("TTS API Response:", result); // Log the full response for debugging
            throw new Error("No audio data received from API or invalid format.");
        }
    } catch (error) {
        console.error("TTS API Error:", error);
        if (btn) btn.classList.remove('loading-speech'); // Clean up on error
    }
};

// Helper function to play audio and handle events
const playAudio = (audioUrl, btn) => {
    btn.classList.remove('loading-speech');
    btn.classList.add('speaking');

    audioPlayer = new Audio(audioUrl);
    audioPlayer.play().catch(e => {
        console.error("Audio play failed:", e);
        if(btn) btn.classList.remove('speaking');
         URL.revokeObjectURL(audioUrl); // Clean up memory on immediate fail
    });

    audioPlayer.onended = () => {
        if (btn) btn.classList.remove('speaking');
        audioPlayer = null;
        URL.revokeObjectURL(audioUrl); // Clean up memory
    };
    audioPlayer.onerror = (e) => {
        console.error("Audio playback error:", e);
        if (btn) btn.classList.remove('speaking');
        audioPlayer = null;
        URL.revokeObjectURL(audioUrl);
    };
};


const translations = { /* Your extensive translations object remains the same */
    'en-US': {
        welcome_subtitle: 'Your AI Health Ecosystem for Bharat.', select_language_label: 'Select your preferred language:', email_placeholder: 'Email Address', password_placeholder: 'Password', login_button: 'Login', signup_button: 'Sign Up', or_divider: 'OR', anonymous_button: 'Continue Anonymously', proceed_button: 'Proceed to App', health_modules_title: 'Health Modules', logout_button: 'Logout', ask_arogya_placeholder: 'Ask Arogya...', welcome_placeholder_title: 'Welcome to Arogya', welcome_placeholder_subtitle: 'Select a module from the left to begin your health journey.', auth_success_login: 'Login successful! Entering...', auth_success_signup: 'Sign up successful! Welcome.', auth_fail: msg => `Operation failed: ${msg}`, auth_enter_details: 'Please enter both email and password.', greeting: 'Hello! I am Arogya Co-Pilot. How can I assist you today?', file_read_error: 'Error: Could not read the uploaded file.', drop_invalid_file: type => `Please drop a valid ${type} file.`, upload_invalid_file: type => `Error: Please upload a valid ${type} file.`, analysis_loading: 'AI is analyzing your input... This may take a moment.', analysis_error: 'An error occurred during AI analysis. Please try again.', upload_first: 'Please upload at least one report image first.', upload_audio_first: 'Please upload an audio file first.',
        module_future_title: 'Arogya-Future', module_future_desc: 'Predictive Health Forecaster',
        module_wellness_title: 'AI Wellness Planner', module_wellness_desc: 'Dynamic AI Health Plans',
        module_healthtrend_title: 'Health-Trend AI', module_healthtrend_desc: 'Medical Report Analyzer',
        module_medsentry_title: 'Med-Sentry AI', module_medsentry_desc: 'Drug Interaction Checker',
        module_arogyasos_title: 'Arogya-SOS', module_arogyasos_desc: 'AI Emergency Response',
        module_sonus_title: 'Sonus AI', module_sonus_desc: 'Acoustic Diagnostic System',
        module_vocaltone_title: 'Vocal-Tone AI', module_vocaltone_desc: 'Vocal Biomarker Analysis',
        module_derma_title: 'Dermalens', module_derma_desc: 'AI Skin Health Analyzer',
        module_mycro_title: 'Mycro', module_mycro_desc: 'Gut Microbiome Simulator',
        module_cogni_title: 'Cogni-Pulse', module_cogni_desc: 'Cognitive Decline Detection',
        module_ayur_title: 'Ayurveda AI', module_ayur_desc: 'Medicinal Plant Identifier',
        module_gait_title: 'Gait-Guard', module_gait_desc: 'AI Posture & Gait Analysis',
        module_ehr_title: 'EHR-Summarizer', module_ehr_desc: 'Health Record Interpreter',
        module_mindwell_title: 'MindWell', module_mindwell_desc: 'Empathetic Mental Companion',
        module_visionfit_title: 'Vision-Fit', module_visionfit_desc: 'AI-Powered Physiotherapist',
        module_govschemes_title: 'Govt. Health Schemes', module_govschemes_desc: 'Find relevant schemes near you',
        module_genopredict_title: 'Geno-Predict AI', module_genopredict_desc: 'Genetic Marker Analysis',
        module_hospitalconnect_title: 'Hospital Connect', module_hospitalconnect_desc: 'Streamline Hospital Operations & Patient Care',
        module_aiscribe_title: 'AI-Scribe', module_aiscribe_desc: 'Voice-to-Clinical Notes',
        module_digitaltwin_title: 'Digital Twin Simulator', module_digitaltwin_desc: 'Simulate Lifestyle Changes',
        module_outbreak_title: 'Outbreak Predictor', module_outbreak_desc: 'AI-Powered Epidemic Forecasting'
    },
     // ... other languages ...
     'pa-IN': {
         welcome_subtitle: 'ਭਾਰਤ ਲਈ ਤੁਹਾਡਾ AI ਸਿਹਤ ਈਕੋਸਿਸਟਮ।', select_language_label: 'ਆਪਣੀ ਪਸੰਦੀਦਾ ਭਾਸ਼ਾ ਚੁਣੋ:', email_placeholder: 'ਈਮੇਲ ਪਤਾ', password_placeholder: 'ਪਾਸਵਰਡ', login_button: 'ਲੌਗਇਨ', signup_button: 'ਸਾਈਨ ਅੱਪ', or_divider: 'ਜਾਂ', anonymous_button: 'ਗੁਮਨਾਮ ਜਾਰੀ ਰੱਖੋ', proceed_button: 'ਐਪ ਤੇ ਜਾਓ', health_modules_title: 'ਸਿਹਤ ਮੌਡਿਊਲ', logout_button: 'ਲੌਗਆਉਟ', ask_arogya_placeholder: 'ਆਰੋਗਿਆ ਨੂੰ ਪੁੱਛੋ...', welcome_placeholder_title: 'ਆਰੋਗਿਆ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ', welcome_placeholder_subtitle: 'ਆਪਣੀ ਸਿਹਤ ਯਾਤਰਾ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਖੱਬੇ ਪਾਸੇ ਤੋਂ ਇੱਕ ਮੌਡਿਊਲ ਚੁਣੋ।', auth_success_login: 'ਲੌਗਇਨ ਸਫਲ! ਦਾਖਲ ਹੋ ਰਿਹਾ ਹੈ...', auth_success_signup: 'ਸਾਈਨ ਅੱਪ ਸਫਲ! ਜੀ ਆਇਆਂ ਨੂੰ।', auth_fail: msg => `ਓਪਰੇਸ਼ਨ ਅਸਫਲ: ${msg}`, auth_enter_details: 'ਕਿਰਪਾ ਕਰਕੇ ਈਮੇਲ ਅਤੇ ਪਾਸਵਰਡ ਦੋਵੇਂ ਦਾਖਲ ਕਰੋ।', greeting: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਆਰੋਗਿਆ ਕੋ-ਪਾਇਲਟ ਹਾਂ। ਮੈਂ ਅੱਜ ਤੁਹਾਡੀ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ?', file_read_error: 'ਗਲਤੀ: ਅੱਪਲੋਡ ਕੀਤੀ ਫਾਈਲ ਨੂੰ ਪੜ੍ਹਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ।', drop_invalid_file: type => `ਕਿਰਪਾ ਕਰਕੇ ਇੱਕ ਵੈਧ ${type} ਫਾਈਲ ਸੁੱਟੋ।`, upload_invalid_file: type => `ਗਲਤੀ: ਕਿਰਪਾ ਕਰਕੇ ਇੱਕ ਵੈਧ ${type} ਫਾਈਲ ਅੱਪਲੋਡ ਕਰੋ।`, analysis_loading: 'AI ਤੁਹਾਡੇ ਇਨਪੁਟ ਦਾ ਵਿਸ਼ਲੇਸ਼ਣ ਕਰ ਰਿਹਾ ਹੈ... ਇਸ ਵਿੱਚ ਕੁਝ ਸਮਾਂ ਲੱਗ ਸਕਦਾ ਹੈ।', analysis_error: 'AI ਵਿਸ਼ਲੇਸ਼ਣ ਦੌਰਾਨ ਇੱਕ ਗਲਤੀ ਆਈ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।', upload_first: 'ਕਿਰਪਾ ਕਰਕੇ ਪਹਿਲਾਂ ਘੱਟੋ-ਘੱਟ ਇੱਕ ਰਿਪੋਰਟ ਚਿੱਤਰ ਅੱਪਲੋਡ ਕਰੋ।', upload_audio_first: 'ਕਿਰਪਾ ਕਰਕੇ ਪਹਿਲਾਂ ਇੱਕ ਆਡੀਓ ਫਾਈਲ ਅੱਪਲੋਡ ਕਰੋ।',
         module_future_title: 'ਆਰੋਗਿਆ-ਭਵਿੱਖ', module_future_desc: 'ਭਵਿੱਖਬਾਣੀ ਸਿਹਤ ਪੂਰਵ-ਸੂਚਕ',
         module_wellness_title: 'ਏਆਈ ਤੰਦਰੁਸਤੀ ਯੋਜਨਾਕਾਰ', module_wellness_desc: 'ਗਤੀਸ਼ੀਲ ਏਆਈ ਸਿਹਤ ਯੋਜਨਾ',
         module_healthtrend_title: 'ਹੈਲਥ-ਟ੍ਰੈਂਡ ਏਆਈ', module_healthtrend_desc: 'ਮੈਡੀਕਲ ਰਿਪੋਰਟ ਵਿਸ਼ਲੇਸ਼ਕ',
         module_medsentry_title: 'ਮੇਡ-ਸੈਂਟਰੀ ਏਆਈ', module_medsentry_desc: 'ਦਵਾਈਆਂ ਦੀ ਆਪਸੀ ਪ੍ਰਕਿਰਿਆ ਜਾਂਚਕਰਤਾ',
         module_arogyasos_title: 'ਆਰੋਗਿਆ-ਐਸਓਐਸ', module_arogyasos_desc: 'ਏਆਈ ਐਮਰਜЕНਸੀ ਜਵਾਬ',
         module_sonus_title: 'ਸੋਨਸ ਏਆਈ', module_sonus_desc: 'ਧੁਨੀ ਡਾਇਗਨੌਸਟਿਕ ਸਿਸਟਮ',
         module_vocaltone_title: 'ਵੋਕਲ-ਟੋਨ ਏਆਈ', module_vocaltone_desc: 'ਵੋਕਲ ਬਾਇਓਮਾਰਕਰ ਵਿਸ਼ਲੇਸ਼ਣ',
         module_derma_title: 'ਡਰਮਾਲੈਂਸ', module_derma_desc: 'ਏਆਈ ਚਮੜੀ ਸਿਹਤ ਵਿਸ਼ਲੇਸ਼ਕ',
         module_mycro_title: 'ਮਾਈਕ੍ਰੋ', module_mycro_desc: 'ਗਟ ਮਾਈਕ੍ਰੋਬਾਇਓਮ ਸਿਮੂਲੇਟਰ',
         module_cogni_title: 'ਕੋਗਨੀ-ਪਲਸ', module_cogni_desc: 'ਸੰज्ञानात्मक ਗਿਰਾਵਟ ਦੀ ਪਛਾਣ',
         module_ayur_title: 'ਆਯੁਰਵੇਦ ਏਆਈ', module_ayur_desc: 'ਔਸ਼ਧੀ ਪੌਦਾ ਪਛਾਣਕਰਤਾ',
         module_gait_title: 'ਗੇਟ-ਗਾਰਡ', module_gait_desc: 'ਏਆਈ ਆਸਣ ਅਤੇ ਚਾਲ ਵਿਸ਼ਲੇਸ਼ਣ',
         module_ehr_title: 'ਈਐਚਆਰ-ਸੰਖੇਪਕਾਰ', module_ehr_desc: 'ਸਿਹਤ ਰਿਕਾਰਡ ਦੁਭਾਸ਼ੀਆ',
         module_mindwell_title: 'ਮਾਈਂਡਵੈਲ', module_mindwell_desc: 'ਹਮਦਰਦ ਮਾਨਸਿਕ ਸਾਥੀ',
         module_visionfit_title: 'ਵਿਜ਼ਨ-ਫਿਟ', module_visionfit_desc: 'ਏਆਈ-ਸੰਚਾਲਿਤ ਫਿਜ਼ੀਓਥੈਰੇਪਿਸਟ',
         module_govschemes_title: 'ਸਰਕਾਰੀ ਸਿਹਤ ਯੋਜਨਾਵਾਂ', module_govschemes_desc: 'ਆਪਣੇ ਨੇੜੇ ਦੀਆਂ ਢੁਕਵੀਆਂ ਸਕੀਮਾਂ ਲੱਭੋ',
         module_genopredict_title: 'ਜੀਨੋ-ਪ੍ਰੈਡਿਕਟ ਏਆਈ', module_genopredict_desc: 'ਜੈਨੇਟਿਕ ਮਾਰਕਰ ਵਿਸ਼ਲੇਸ਼ਣ',
         module_hospitalconnect_title: 'ਹਸਪਤਾਲ ਕਨੈਕਟ', module_hospitalconnect_desc: 'ਹਸਪਤਾਲ ਦੇ ਸੰਚਾਲਨ ਅਤੇ ਮਰੀਜ਼ਾਂ ਦੀ ਦੇਖਭਾਲ ਨੂੰ ਸੁਚਾਰੂ ਬਣਾਓ',
         module_aiscribe_title: 'ਏਆਈ-ਸਕ੍ਰਾਈਬ', module_aiscribe_desc: 'ਵੌਇਸ-ਟੂ-ਕਲੀਨਿਕਲ ਨੋਟਸ',
         module_digitaltwin_title: 'ਡਿਜੀਟਲ ਟਵਿਨ ਸਿਮੂਲੇਟਰ', module_digitaltwin_desc: 'ਜੀਵਨਸ਼ੈਲੀ ਤਬਦੀਲੀਆਂ ਦਾ ਸਿਮੂਲੇਸ਼ਨ',
         module_outbreak_title: 'ਮਹਾਮਾਰੀ ਦਾ ਭਵਿੱਖਬਾਣੀ', module_outbreak_desc: 'ਏਆਈ-ਸੰਚਾਲਿਤ ਮਹਾਮਾਰੀ ਦੀ ਭਵਿੱਖਬਾਣੀ'
     }
};

// Updated allModules array - changed gait type to 'image_upload'
const allModules = [
    { id: 'future', icon: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>`, type: 'multi_input' },
    { id: 'wellness', icon: `<path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>`, type: 'multi_input' },
    { id: 'healthtrend', icon: `<path d="M16 11h-2v4h2v-4zm-4 4h-2v-7h2v7zm-4-4H6v4h2v-4zM21 3H3v18h18V3zm-2 16H5V5h14v14z"/>`, type: 'image_upload' },
    { id: 'medsentry', icon: `<path d="M10.5 15.5c.33 0 .65-.08.93-.24l4.28-2.47c1.2-.69 1.2-2.45 0-3.14l-4.28-2.47a2 2 0 00-2-.01l-4.28 2.48c-.5.29-.8.78-.8 1.34v5.12c0 .56.3 1.05.8 1.34l4.28 2.48c.28.16.6.24.94.24z"/>`, type: 'text_input' },
    { id: 'arogyasos', icon: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z"/>`, type: 'no_input' },
    { id: 'sonus', icon: `<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>`, type: 'audio_upload' },
    { id: 'vocaltone', icon: `<path d="M7 3H5v18h2V3zm12 0h-2v18h2V3zm-4 4h-2v10h2V7zm-4 0H9v10h2V7z"/>`, type: 'audio_upload' },
    { id: 'derma', icon: `<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>`, type: 'image_upload' },
    { id: 'mycro', icon: `<path d="M12 2a10 10 0 100 20 10 10 0 000-20zM8 15.5c0 .83.67 1.5 1.5 1.5.42 0 .8-.17 1.06-.44.26.27.64.44 1.06.44.83 0 1.5-.67 1.5-1.5 0-.57-.32-1.05-.76-1.31.32-.23.54-.59.54-1 .01-.82-.66-1.5-1.48-1.5-.72 0-1.31.52-1.46 1.19-.34-.31-.79-.5-1.29-.5C8.93 11.88 8 12.8 8 13.88c0 .35.14.68.38.93-.41.28-.71.7-.71 1.2zm-.5-5c.83 0 1.5-.67 1.5-1.5S8.33 7.5 7.5 7.5 6 8.17 6 9s.67 1.5 1.5 1.5zm9 0c.83 0 1.5-.67 1.5-1.5S17.33 7.5 16.5 7.5 15 8.17 15 9s.67 1.5 1.5 1.5z"/>`, type: 'text_input' },
    { id: 'cogni', icon: `<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>`, type: 'text_input' },
    { id: 'ayur', icon: `<path d="M21.25 4.34l-3.58 3.58c-.8-1.05-1.99-1.92-3.34-2.4V2h-2v3.53c-1.35.48-2.54 1.35-3.34 2.4L5.41 4.34 4 5.75l3.58 3.58C6.53 10.68 6 12.31 6 14c0 3.31 2.69 6 6 6s6-2.69 6-6c0-1.69-.53-3.32-1.43-4.66l3.58-3.58 1.1-1.42-1-1zM12 18c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>`, type: 'image_upload' },
    { id: 'gait', icon: `<path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>`, type: 'image_upload' }, // Corrected type
    { id: 'ehr', icon: `<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>`, type: 'multi_input' },
    { id: 'mindwell', icon: `<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>`, type: 'text_input' },
    { id: 'visionfit', icon: `<path d="M4.5 11H3v2h1.5v-2zM3 20h1.5v-2.05a7.01 7.01 0 01-1.5-1.44V20zm1.5-11H3V7h1.5v2zM8 3.5H6v-2h2v2zm-2 15h2v-2H6v2zm13.5 0H18v-2h1.5v2zm-1.5-15H18v2h1.5V7zm0 11h1.5v-2H18v2zm-6.5-15h2v-2h-2v2zM12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm0-18c4.41 0 8 3.59 8 8s-3.59 8-8 8-8-3.59-8-8 3.59-8 8-8z"/>`, type: 'multi_input' },
    { id: 'govschemes', icon: `<path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>`, type: 'multi_input' },
    { id: 'genopredict', icon: `<path d="M14.5,15.5l1.5,1.5l-1.5,1.5V21h-1v-2.5l-1.5-1.5l1.5-1.5V13h1V15.5z M9.5,15.5l1.5,1.5l-1.5,1.5V21h-1v-2.5l-1.5-1.5 l1.5-1.5V13h1V15.5z M20,8.5c0,0-2-1.9-2-4.5c0-2.2,1.8-4,4-4c0.7,0,1.4,0.2,2,0.5C23.8,0.2,23.2,0,22.5,0C20,0,18,2,18,4.5 C18,7.1,20,8.5,20,8.5z M4.5,0C2,0,0,2,0,4.5C0,7.1,2,8.5,2,8.5C2,8.5,0,7.1,0,4.5C0,2,2,0,4.5,0C5.2,0,5.8,0.2,6.4,0.5 C5.9,0.2,5.2,0,4.5,0z"/>`, type: 'text_input' },
    { id: 'hospitalconnect', icon: `<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>`, type: 'multi_input' },
    { id: 'aiscribe', icon: `<path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z"/>`, type: 'text_input' },
    { id: 'digitaltwin', icon: `<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>`, type: 'multi_input' },
    { id: 'outbreak', icon: `<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>`, type: 'multi_input' }
];

const getTranslation = (key) => {
    const lang = state.selectedLanguage;
    if (translations[lang] && typeof translations[lang][key] !== 'undefined') {
        // Handle function translations specifically
        if (typeof translations[lang][key] === 'function') {
             return translations[lang][key]; // Or handle based on specific function needs
        }
        return translations[lang][key];
    }
    // Fallback to English
    if (translations['en-US'] && typeof translations['en-US'][key] !== 'undefined') {
         if (typeof translations['en-US'][key] === 'function') {
             return translations['en-US'][key]; // Or handle function fallback
         }
        return translations['en-US'][key];
    }
    return key; // Return the key itself if no translation found
};


const initializeAppAndAuth = async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        onAuthStateChanged(auth, user => {
            updateUIForAuthState(user);
        });

        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        }
    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        getEl('auth-message-display').textContent = 'Error initializing application.';
    }
};

const handleAuthentication = async (isLogin) => {
    const emailEl = getEl('auth-email');
    const passwordEl = getEl('auth-password');
    const display = getEl('auth-message-display');

     // Safety check for elements
     if (!emailEl || !passwordEl || !display) {
         console.error("Auth elements not found");
         return;
     }

    const email = emailEl.value;
    const password = passwordEl.value;


    if (!email || !password) {
        display.textContent = getTranslation('auth_enter_details');
        return;
    }
    display.textContent = ''; // Clear previous messages

    try {
        const userCredential = isLogin
            ? await signInWithEmailAndPassword(auth, email, password)
            : await createUserWithEmailAndPassword(auth, email, password);

        // onAuthStateChanged will handle the UI update
         display.textContent = getTranslation(isLogin ? 'auth_success_login' : 'auth_success_signup');


    } catch (error) {
        console.error("Authentication error:", error);
        // Attempt to provide a user-friendly message
        let errorMessage = error.message;
        // Firebase often includes error codes like 'auth/invalid-email'
        if (error.code && error.code.startsWith('auth/')) {
            errorMessage = error.code.replace('auth/', '').replace(/-/g, ' ');
            // Capitalize first letter for better display
            errorMessage = errorMessage.charAt(0).toUpperCase() + errorMessage.slice(1);
        }
        // Use the functional translation if available
        const failMsgFn = getTranslation('auth_fail');
        display.textContent = typeof failMsgFn === 'function' ? failMsgFn(errorMessage) : `Operation failed: ${errorMessage}`;
    }
};


const updateUIForAuthState = (user) => {
     // Ensure elements exist before trying to modify them
     const userIdDisplay = getEl('user-id-display');
     const authFormsContainer = getEl('auth-forms-container');
     const modalProceedButton = getEl('modal-proceed-button');
     const logoutButton = getEl('logout-button');
     const anonymousButton = getEl('anonymous-button');

     if (!userIdDisplay || !authFormsContainer || !modalProceedButton || !logoutButton || !anonymousButton) {
         console.error("One or more UI elements for auth state not found.");
         return;
     }

    if (user) {
        userId = user.uid;
        state.isLoggedIn = true;
        userIdDisplay.textContent = `ID: ${userId.substring(0, 8)}...`;
        authFormsContainer.classList.add('hidden');
        modalProceedButton.classList.remove('hidden');
        logoutButton.classList.remove('hidden');
        anonymousButton.classList.add('hidden');
    } else {
        userId = `anon-${crypto.randomUUID()}`; // Generate new anonymous ID on logout/initial load
        state.isLoggedIn = false;
        userIdDisplay.textContent = `Anonymous`;
        authFormsContainer.classList.remove('hidden');
        modalProceedButton.classList.add('hidden');
        logoutButton.classList.add('hidden');
        anonymousButton.classList.remove('hidden');
        // Also clear any sensitive module content if needed on logout
        mainModuleContent.innerHTML = ''; // Clear module content
        getEl('welcome-placeholder')?.classList.remove('hidden'); // Show welcome message
        state.activeModule = null; // Reset active module
    }
};


const setLanguage = (lang) => {
    state.selectedLanguage = lang;
    document.documentElement.lang = lang.split('-')[0]; // Set lang attribute on <html>

    document.querySelectorAll('[data-translate-key]').forEach(el => {
        const key = el.getAttribute('data-translate-key');
        const translation = getTranslation(key);

        // Skip if translation is a function (needs specific handling elsewhere)
         if (typeof translation === 'function') {
             // console.warn(`Skipping function translation for key: ${key}`);
             return;
         }

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = translation || ''; // Use empty string if translation missing
        } else {
            el.textContent = translation || key; // Show key if translation missing
        }
    });

    // Update module descriptions in the sidebar
    populateModules();

    // Re-render the currently active module with the new language if one is active
    if (state.activeModule) {
        const moduleData = allModules.find(m => m.id === state.activeModule);
        if (moduleData) {
            renderModule(moduleData); // This will re-render the module UI
        }
    }
};


const populateModules = () => {
    const moduleGrid = getEl('module-grid');
     if (!moduleGrid) return; // Exit if grid element not found

    moduleGrid.innerHTML = ''; // Clear existing modules
    allModules.forEach(module => {
        const titleKey = `module_${module.id}_title`;
        const descKey = `module_${module.id}_desc`;
        const title = getTranslation(titleKey);
        const desc = getTranslation(descKey);

        const moduleEl = document.createElement('div');
        moduleEl.className = 'card-3d glass-panel p-4 cursor-pointer flex items-center space-x-4';
        // Add data attribute for easier selection if needed later
        moduleEl.setAttribute('data-module-id', module.id);

        moduleEl.innerHTML = `
            <div class="flex-shrink-0 w-12 h-12 flex items-center justify-center bg-indigo-900/50 text-indigo-300 rounded-xl">
                <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">${module.icon}</svg>
            </div>
            <div>
                <h3 class="font-bold text-lg text-gray-100">${title === titleKey ? module.id : title}</h3>
                <p class="text-sm text-gray-400">${desc === descKey ? 'Description unavailable' : desc}</p>
            </div>
        `;

        moduleEl.addEventListener('click', () => {
            renderModule(module);
            // Close sidebar on mobile after selection
            if (window.innerWidth < 768) {
                const sidebar = getEl('sidebar-modules');
                if (sidebar) sidebar.classList.add('-translate-x-full');
                state.isSidebarOpen = false;
            }
        });
        moduleGrid.appendChild(moduleEl);
    });

    // Re-apply 3D card hover effect to newly added elements
    document.querySelectorAll('.card-3d').forEach(card => {
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            // Use CSS variables for the effect
            card.style.setProperty('--mouse-x', `${x}px`);
            card.style.setProperty('--mouse-y', `${y}px`);
        });
         // Add mouseleave listener to reset perspective? Optional.
         // card.addEventListener('mouseleave', () => {
         //   // Reset styles if needed
         // });
    });
};


const renderModule = (module) => {
    state.activeModule = module.id;
    state.uploadedFiles = []; // Clear uploaded files when switching modules
    const welcomePlaceholder = getEl('welcome-placeholder');
    if (welcomePlaceholder) {
        welcomePlaceholder.classList.add('hidden');
    }

    mainModuleContent.innerHTML = ''; // Clear previous content

    const moduleContainer = document.createElement('div');
    moduleContainer.className = 'w-full max-w-3xl glass-panel p-6 sm:p-8 animate-fade-in-up'; // Adjusted padding

     // Use translated title and description
     const titleKey = `module_${module.id}_title`;
     const descKey = `module_${module.id}_desc`;
     const title = getTranslation(titleKey);
     const desc = getTranslation(descKey);

    moduleContainer.innerHTML = `
        <h3 class="text-2xl sm:text-3xl font-bold mb-3 sm:mb-4 text-center">${title === titleKey ? module.id.toUpperCase() : title}</h3>
        <p class="text-gray-400 mb-5 sm:mb-6 text-center">${desc === descKey ? 'Module description.' : desc}</p>
    `;

    let formContent = ''; // To build the form elements

    // --- Form Content Switch ---
    // (This remains largely the same as provided in your code, ensure cases match allModules)
     switch (module.id) {
         // ... cases for 'arogyasos', 'future', 'wellness', 'medsentry', 'mycro', 'govschemes', 'genopredict', 'cogni' ...
        case 'arogyasos':
            formContent = `/* ... arogyasos form ... */`; break;
        case 'future':
            formContent = `/* ... future form ... */`; break;
        case 'wellness':
             formContent = `/* ... wellness form ... */`; break;
        case 'medsentry':
             formContent = `/* ... medsentry form ... */`; break;
        case 'mycro':
            formContent = `/* ... mycro form ... */`; break;
        case 'govschemes':
            formContent = `/* ... govschemes form ... */`; break;
        case 'genopredict':
             formContent = `/* ... genopredict form ... */`; break;
        case 'cogni':
             formContent = `/* ... cogni form ... */`; break;

        // Image upload modules
         case 'ayur':
         case 'gait': // Added gait here
         case 'healthtrend':
         case 'derma':
             formContent = `
                 ${module.id === 'gait' ? '<p class="text-gray-400 mb-6 text-center">Upload a photo of your posture (e.g., side profile) and describe your concerns for a personalized analysis.</p>' : ''}
                 ${module.id === 'healthtrend' ? '<p class="text-gray-400 mb-6 text-center">Upload a photo of your medical report and select your primary goal for a simplified AI analysis.</p>' : ''}
                 ${module.id === 'derma' ? '<p class="text-gray-400 mb-6 text-center">Upload a clear photo of the affected skin area and describe your concern for a preliminary AI analysis.</p>' : ''}

                 <div id="drop-zone-${module.id}" class="mb-4 flex justify-center items-center w-full h-32 px-6 py-10 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                     <div class="text-center">
                         <svg class="mx-auto h-12 w-12 text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                         <p class="mt-2 text-sm text-gray-400">Click to upload or drag & drop ${module.id === 'gait' ? 'posture photo' : module.id === 'healthtrend' ? 'report photo' : module.id === 'derma' ? 'skin photo' : 'image'}</p>
                         <p class="text-xs text-gray-500">PNG, JPG recommended (Max 10MB)</p>
                     </div>
                 </div>
                 <input id="file-input-${module.id}" type="file" class="hidden" accept="image/*" ${module.id === 'healthtrend' || module.id === 'ayur' ? 'multiple' : ''}>
                 <div id="preview-${module.id}" class="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"></div>

                 ${module.id === 'gait' ? `
                     <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                         <div>
                             <label class="block mb-2 text-sm font-medium text-gray-300">Area of Concern</label>
                             <select id="gait-area" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                                 <option>Overall Posture</option> <option>Walking Pattern (Gait)</option> <option>Back Pain/Slouching</option> <option>Shoulder/Neck Position</option> <option>Hip/Pelvic Tilt</option> <option>Foot/Ankle Issues</option>
                             </select>
                         </div>
                         <div>
                             <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                             <select id="gait-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                                  <option>Correct Posture</option> <option>Reduce Pain</option> <option>Improve Balance & Stability</option> <option>Increase Walking Efficiency</option> <option>Prevent Injury</option>
                             </select>
                         </div>
                     </div>
                     <div class="mb-6">
                         <label class="block mb-2 text-sm font-medium text-gray-300">Describe Your Concerns in Detail</label>
                         <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'My shoulders roll forward...'"></textarea>
                     </div>
                 ` : ''}
                 ${module.id === 'healthtrend' ? `
                     <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                        <div>
                            <label class="block mb-2 text-sm font-medium text-gray-300">Report Type</label>
                            <select id="healthtrend-type" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                                <option>Blood Test Report</option> <option>Urine Test Report</option> <option>X-Ray Report</option> <option>CT Scan Report</option> <option>MRI Report</option> <option>Other Medical Document</option>
                            </select>
                        </div>
                        <div>
                             <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                             <select id="healthtrend-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                                <option>Provide a simple summary</option> <option>Explain specific medical terms</option> <option>Highlight abnormal values</option> <option>Generate questions to ask my doctor</option>
                             </select>
                        </div>
                     </div>
                      <div class="mb-6">
                         <label class="block mb-2 text-sm font-medium text-gray-300">Specific questions or terms (Optional)</label>
                         <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'What does high creatinine mean?'"></textarea>
                     </div>
                 ` : ''}
                  ${module.id === 'derma' ? `
                     <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                         <div>
                             <label class="block mb-2 text-sm font-medium text-gray-300">Primary Concern</label>
                             <select id="derma-concern" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                                 <option>Acne / Pimples</option> <option>Rash / Eczema</option> <option>Mole / Skin Growth</option> <option>Pigmentation / Dark Spots</option> <option>Signs of Aging / Wrinkles</option> <option>General Skin Checkup</option>
                             </select>
                         </div>
                         <div>
                             <label class="block mb-2 text-sm font-medium text-gray-300">Primary Goal</label>
                             <select id="derma-goal" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg">
                                 <option>Identify the issue</option> <option>Reduce Redness / Inflammation</option> <option>Improve Skin Texture</option> <option>Even Out Skin Tone</option> <option>Get Skincare Recommendations</option>
                             </select>
                         </div>
                     </div>
                     <div class="mb-6">
                         <label class="block mb-2 text-sm font-medium text-gray-300">Describe Your Symptoms in Detail</label>
                         <textarea id="notes-input" class="w-full h-24 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="e.g., 'This red, itchy rash appeared...'"></textarea>
                     </div>
                 ` : ''}
                 ${module.id === 'ayur' ? `
                     <div class="mt-6">
                         <label class="block mb-2 text-sm font-medium text-gray-300">Notes (Optional)</label>
                         <input type="text" id="notes-input" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="Add any relevant details or questions...">
                     </div>
                 ` : ''}
             `;
             break;

         // Audio upload modules
         case 'sonus':
         case 'vocaltone':
             formContent = `
                 <div id="drop-zone-${module.id}" class="mb-4 flex justify-center items-center w-full h-32 px-6 py-10 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-white/10 transition-colors">
                     <div class="text-center">
                         <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                         <p class="mt-2 text-sm text-gray-400">Click to upload or drag & drop audio</p>
                         <p class="text-xs text-gray-500">MP3, WAV, M4A, OGG (Max 10MB)</p>
                     </div>
                 </div>
                 <input id="file-input-${module.id}" type="file" class="hidden" accept="audio/*">
                 <div id="preview-${module.id}" class="mt-4"></div>
                 <div class="mt-6">
                     <label class="block mb-2 text-sm font-medium text-gray-300">Notes (Optional)</label>
                     <input type="text" id="notes-input" class="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg" placeholder="e.g., Describe symptoms like 'dry cough' or 'voice sounds hoarse'...">
                 </div>
             `;
             break;

          // ... cases for 'hospitalconnect', 'aiscribe', 'digitaltwin', 'outbreak', 'mindwell', 'ehr', 'visionfit' ...
         case 'hospitalconnect':
             formContent = `/* ... hospitalconnect form ... */`; break;
         case 'aiscribe':
             formContent = `/* ... aiscribe form ... */`; break;
         case 'digitaltwin':
             formContent = `/* ... digitaltwin form ... */`; break;
         case 'outbreak':
             formContent = `/* ... outbreak form ... */`; break;
         case 'mindwell':
              formContent = `/* ... mindwell form ... */`; break;
         case 'ehr':
              formContent = `/* ... ehr form ... */`; break;
          case 'visionfit':
              formContent = `/* ... visionfit form ... */`; break;


        default: // Fallback for simple text or unimplemented modules
            // Check if module type expects text input
             if (module.type === 'text_input' || module.type === 'multi_input' || !module.type) { // Assuming multi_input might still have a primary text area
                formContent = `
                    <div class="mb-6">
                        <label class="block mb-2 text-sm font-medium text-gray-300">Your Query / Details</label>
                        <textarea id="text-input" class="w-full h-40 p-3 bg-gray-900 border border-gray-700 rounded-lg resize-none" placeholder="Please describe your situation or question..."></textarea>
                    </div>`;
            } else {
                 formContent = `<p class="text-center text-gray-400">This module type (${module.type}) has specific input requirements handled elsewhere or is not fully implemented.</p>`;
            }
            break;
    }

    moduleContainer.innerHTML += formContent; // Append the generated form

    // --- Submit Button & Result Div ---
    const submitButton = document.createElement('button');
    submitButton.id = `submit-${module.id}`;
    submitButton.className = 'w-full mt-6 gradient-bg-button text-white font-bold py-3 px-6 sm:px-8 rounded-lg text-lg transition duration-300 ease-in-out hover:scale-105'; // Added hover effect

     // Use translated button text if available
     let buttonText = 'Analyze';
     if (module.id === 'hospitalconnect') buttonText = 'Submit Request';
     else if (module.id === 'arogyasos') buttonText = 'Get Emergency Info';
    submitButton.textContent = getTranslation(`submit_${module.id}_button`) || buttonText; // Example of translating button text

    const resultDiv = document.createElement('div');
    resultDiv.id = `result-${module.id}`;
    resultDiv.className = 'mt-6 text-left w-full flex flex-col items-center justify-center'; // Ensure full width

    moduleContainer.appendChild(submitButton);
    moduleContainer.appendChild(resultDiv);
    mainModuleContent.appendChild(moduleContainer);

    // --- Setup Event Listeners ---
    // Crucially, this needs to be called *after* the elements are added to the DOM
    setupModuleEventListeners(module);
};


// --- Updated setupModuleEventListeners ---
const setupModuleEventListeners = (module) => {
    const submitButton = getEl(`submit-${module.id}`);
    const resultDiv = getEl(`result-${module.id}`);

    if (submitButton && resultDiv) { // Ensure both exist
        submitButton.addEventListener('click', () => {
            // Disable button during processing
            submitButton.disabled = true;
            submitButton.textContent = 'Analyzing...';
            submitButton.classList.add('opacity-75', 'cursor-not-allowed');


            let systemPrompt = `You are Arogya Co-pilot, an AI health expert. Provide a detailed, helpful, and empathetic analysis based on the user's input. The user's preferred language is ${state.selectedLanguage}. Structure your response clearly using paragraphs. **Strictly avoid using any markdown formatting like *, #, or \`\`\`**. The output MUST be plain text suitable for direct display in an HTML div using <br> tags for line breaks. Include necessary disclaimers about not being medical advice and consulting professionals.`;
            let userInput = '';
            let analysisType = module.type || 'text'; // Use type from allModules array

             try { // Wrap the input gathering and validation in a try block

                 switch(module.id) {
                     case 'arogyasos': {
                         const selectedState = getEl('gov-state')?.value;
                         const selectedDistrict = getEl('gov-district')?.value;
                         if (!selectedState || !selectedDistrict || selectedDistrict === 'Select District' || selectedDistrict === '') {
                              resultDiv.innerHTML = `<p class="text-red-400">Please select your state and district.</p>`;
                              throw new Error("Validation failed"); // Throw error to enable button in finally block
                         }
                         loadEmergencyData(selectedState, selectedDistrict, resultDiv)
                              .finally(() => { // Re-enable button after loadEmergencyData finishes (success or fail)
                                  submitButton.disabled = false;
                                  submitButton.textContent = 'Get Emergency Info';
                                  submitButton.classList.remove('opacity-75', 'cursor-not-allowed');
                              });
                         return; // loadEmergencyData handles its own async flow and UI updates
                     }
                     case 'future': {
                         const age = getEl('future-age')?.value;
                         const gender = getEl('future-gender')?.value;
                         const smoking = getEl('future-smoking')?.value;
                         const exercise = getEl('future-exercise')?.value;
                         const notes = getEl('notes-input')?.value;
                          if (!age || !gender || !smoking || exercise === null || exercise === undefined || exercise === '') {
                             resultDiv.innerHTML = `<p class="text-red-400">Please fill in Age, Gender, Smoking Status, and Weekly Exercise.</p>`;
                             throw new Error("Validation failed");
                         }
                         userInput = `Age: ${age}, Gender: ${gender}, Smoking: ${smoking}, Exercise: ${exercise} hours/week. Notes: ${notes || 'None'}`;
                         systemPrompt += ' Analyze the provided health data to forecast potential future health risks (e.g., related to cardiovascular health, diabetes, general longevity based on inputs) and offer actionable, personalized preventive advice (diet, lifestyle, checkups). Keep advice practical for an Indian context if possible.';
                         break; // Analysis type is text (default)
                     }
                      case 'wellness': {
                         const goal = getEl('wellness-goal')?.value;
                         const diet = getEl('wellness-diet')?.value;
                         const conditions = getEl('wellness-conditions')?.value;
                         const wellnessNotes = getEl('notes-input')?.value;
                          if (!goal || !diet || !conditions) {
                             resultDiv.innerHTML = `<p class="text-red-400">Please fill in Primary Goal, Current Diet, and Existing Health Conditions (enter 'None' if applicable).</p>`;
                              throw new Error("Validation failed");
                         }
                         userInput = `Goal: ${goal}, Current Diet: ${diet}, Existing Conditions: ${conditions}. Notes: ${wellnessNotes || 'None'}`;
                         systemPrompt += ' Create a personalized wellness plan including specific diet suggestions (mentioning food types common in India if relevant), exercise routines (type, frequency, duration), stress management techniques, and sleep hygiene tips based on the user\'s goals, diet, and conditions. Make the plan actionable and easy to follow.';
                         break; // Analysis type is text (default)
                     }
                      case 'medsentry': {
                         const goal = getEl('medsentry-goal')?.value;
                         const medications = getEl('text-input')?.value;
                          if (!medications || medications.trim() === '') {
                             resultDiv.innerHTML = `<p class="text-red-400">Please list at least one medication.</p>`;
                              throw new Error("Validation failed");
                         }
                         userInput = `Goal: "${goal}". Medications listed (one per line):\n${medications}`;
                         systemPrompt += ` You are Med-Sentry AI. Based on the user's goal ("${goal}") and the list of medications provided, give a clear analysis. For interactions, state potential risks and severity simply. For side effects, list common ones. For alternatives, suggest generics. For explanations, describe purpose simply. ALWAYS include a prominent disclaimer: 'This is AI-generated information, NOT medical advice. Consult your doctor or pharmacist before making any changes to your medication.'`;
                         break; // Analysis type is text (default)
                     }

                     case 'healthtrend': {
                          if (state.uploadedFiles.length === 0) {
                             resultDiv.innerHTML = `<p class="text-red-400">${getTranslation('upload_first')}</p>`;
                             throw new Error("Validation failed");
                         }
                         const reportType = getEl('healthtrend-type')?.value;
                         const goal = getEl('healthtrend-goal')?.value;
                         const notes = getEl('notes-input')?.value;
                         userInput = `Report Type: ${reportType}. Primary Goal: ${goal}. Specific questions/focus: ${notes || 'None'}`;
                         systemPrompt += ` You are Health-Trend AI. Analyze the uploaded medical report image(s). Assume it's a '${reportType}'. Address the user's goal: '${goal}'. If summarizing, be concise. If explaining terms, be clear. If highlighting abnormal values, explain their potential significance simply. If generating questions, make them relevant for a doctor. Prominently state: 'This AI analysis is for informational purposes only and is NOT a medical diagnosis. Consult your doctor for interpretation and advice.'`;
                         analysisType = 'image'; // Set type for API call
                         break;
                     }
                      case 'ayur': {
                          if (state.uploadedFiles.length === 0) {
                             resultDiv.innerHTML = `<p class="text-red-400">${getTranslation('upload_first')}</p>`;
                              throw new Error("Validation failed");
                         }
                         userInput = getEl('notes-input')?.value || `Identify the plant in the image(s).`;
                         systemPrompt += ` You are Ayurveda AI. Identify the medicinal plant in the uploaded image(s), considering user notes: '${userInput}'. Provide its common and botanical names, traditional Ayurvedic uses (e.g., for dosha balance, specific conditions), typical preparation methods, potential benefits based on traditional knowledge, and crucial precautions/contraindications. Add a disclaimer: 'Information based on traditional knowledge, not medical advice. Consult an Ayurvedic practitioner or doctor before use.'`;
                         analysisType = 'image'; // Set type for API call
                         break;
                     }
                      case 'gait': {
                          if (state.uploadedFiles.length === 0) {
                             resultDiv.innerHTML = `<p class="text-red-400">Please upload a posture photo for analysis.</p>`;
                             throw new Error("Validation failed");
                         }
                         const area = getEl('gait-area')?.value || 'Not specified';
                         const goal = getEl('gait-goal')?.value || 'Not specified';
                         const notes = getEl('notes-input')?.value || '';
                         userInput = `Area of Concern: ${area}, Primary Goal: ${goal}. Detailed description: ${notes || 'None'}`;
                         systemPrompt += ` You are Gait-Guard AI. Analyze the uploaded posture/gait photo based on the user's concern ('${area}'), goal ('${goal}'), and notes. Identify potential postural deviations (e.g., forward head, rounded shoulders, pelvic tilt) or gait issues visible. Suggest 2-3 simple corrective exercises or stretches with clear instructions (reps/duration). Add a disclaimer: 'This is a preliminary AI analysis, not a diagnosis. Consult a physical therapist or doctor for professional assessment and guidance.'`;
                         analysisType = 'image'; // Set type for API call
                         break;
                     }
                     case 'sonus':
                     case 'vocaltone': {
                          if (state.uploadedFiles.length === 0) {
                             resultDiv.innerHTML = `<p class="text-red-400">${getTranslation('upload_audio_first')}</p>`;
                              throw new Error("Validation failed");
                         }
                         const notes = getEl('notes-input')?.value || '';
                         userInput = `User notes: ${notes || 'No specific notes provided.'}`;
                         const moduleName = module.id === 'sonus' ? 'Sonus AI (Acoustic Diagnostic System)' : 'Vocal-Tone AI (Vocal Biomarker Analysis)';
                         systemPrompt += ` You are ${moduleName}. Analyze the uploaded audio file, considering user notes: '${userInput}'. For Sonus: Listen for cough type (dry/wet), frequency, breathing sounds (wheezing, crackles) and suggest potential respiratory insights (e.g., sounds like a dry cough, possible wheezing). For Vocal-Tone: Analyze pitch variation, speech rate, pauses, clarity for potential indicators (e.g., monotone speech might suggest fatigue, rapid speech could indicate anxiety). Provide preliminary observations ONLY. Add a strong disclaimer: 'This AI analysis is experimental, NOT a medical diagnosis. Acoustic/vocal patterns have many causes. Consult a doctor for any health concerns.'`;
                         analysisType = 'audio'; // Set type for API call
                         break;
                     }
                      case 'derma': {
                          if (state.uploadedFiles.length === 0) {
                             resultDiv.innerHTML = `<p class="text-red-400">Please upload a photo of the skin area for analysis.</p>`;
                             throw new Error("Validation failed");
                         }
                         const concern = getEl('derma-concern')?.value || 'Not specified';
                         const goal = getEl('derma-goal')?.value || 'Not specified';
                         const notes = getEl('notes-input')?.value || '';
                         userInput = `Primary Concern: ${concern}, Primary Goal: ${goal}. Detailed description: ${notes || 'None'}`;
                         systemPrompt += ` You are Dermalens AI. Analyze the uploaded skin photo based on the user's concern ('${concern}'), goal ('${goal}'), and description. Describe visual characteristics observed (color, texture, shape, distribution). Suggest 1-2 possible *categories* of conditions (e.g., inflammatory, fungal, benign growth - avoid specific diagnoses) based *only* on visual patterns. Offer general skincare advice relevant to the goal (e.g., for redness: gentle cleanser, moisturizer). Add a clear disclaimer: 'AI analysis based on image ONLY. This is NOT a diagnosis. Skin conditions require examination by a dermatologist.'`;
                         analysisType = 'image'; // Set type for API call
                         break;
                     }
                      // ... [Include other cases like mindwell, govschemes, hospitalconnect, digitaltwin, outbreak, visionfit, ehr, genopredict, cogni, mycro, ensuring they have input validation and throw errors similarly] ...
                      case 'mindwell': {
                        const concern = getEl('mindwell-concern')?.value;
                        const goal = getEl('mindwell-goal')?.value;
                        const notes = getEl('notes-input')?.value;
                        if (!concern || !goal || !notes) {
                            resultDiv.innerHTML = `<p class="text-red-400">Please select a concern, goal, and describe your situation.</p>`;
                            throw new Error("Validation failed");
                        }
                        userInput = `Primary Concern: ${concern}, Primary Goal: ${goal}. Detailed description: ${notes}`;
                        systemPrompt += ` You are MindWell, an empathetic AI mental health companion. Respond supportively to the user's concern ('${concern}') and goal ('${goal}'). Validate their feelings based on their description. Offer 1-2 gentle coping strategies or mindfulness techniques relevant to their situation (e.g., deep breathing for anxiety, journaling for low mood). Keep responses kind and encouraging. Crucially, if the description contains keywords suggesting immediate crisis, self-harm, or severe distress, gently interrupt the supportive response and strongly advise seeking professional help immediately, providing the AASRA helpline number (+91-9820466726). Otherwise, conclude with a reminder: 'I'm here to listen, but I'm an AI and cannot provide therapy or medical advice. Please consult a qualified mental health professional for diagnosis and treatment.'`;
                        break; // Type is text
                    }
                    case 'ehr': {
                        const ehrGoal = getEl('ehr-goal')?.value;
                        const ehrText = getEl('text-input')?.value;
                        if (!ehrGoal || !ehrText || ehrText.trim() === '') {
                             resultDiv.innerHTML = `<p class="text-red-400">Please select a goal and paste the EHR text.</p>`;
                             throw new Error("Validation failed");
                        }
                        userInput = `Summarization Goal: ${ehrGoal}\n\nEHR Text:\n${ehrText}`;
                        systemPrompt += ` You are EHR-Summarizer. Based on the provided goal ('${ehrGoal}') and EHR text, perform the requested action. Ensure the output is simplified for patient understanding. For summaries, be brief. For key findings, list them clearly. For medications, include dosage if available. For treatment plans, outline steps. For questions, make them specific to the EHR text. Include the disclaimer: 'AI summary based on provided text. Verify details and consult your doctor.'`;
                        break; // Type is text
                    }
                     // ... [Add remaining cases with validation] ...


                    default: { // Handle text_input modules without specific cases above
                         const textInputEl = getEl('text-input');
                         if (textInputEl) {
                             userInput = textInputEl.value;
                             if (!userInput || userInput.trim() === '') {
                                 resultDiv.innerHTML = `<p class="text-red-400">Please enter your query or details.</p>`;
                                 throw new Error("Validation failed");
                             }
                         } else {
                              // Should not happen if module type is text_input, but as a fallback:
                              resultDiv.innerHTML = `<p class="text-red-400">Input field not found for this module.</p>`;
                              throw new Error("Validation failed");
                         }
                         // No specific prompt addition for generic text modules needed here
                         break;
                    }
                } // End switch

                // If validation passed, call the API
                callGeminiAPI(systemPrompt, userInput, resultDiv, analysisType)
                    .finally(() => { // Re-enable button after API call finishes
                        submitButton.disabled = false;
                        // Restore original button text (consider storing it)
                         let originalButtonText = 'Analyze';
                         if (module.id === 'hospitalconnect') originalButtonText = 'Submit Request';
                         else if (module.id === 'arogyasos') originalButtonText = 'Get Emergency Info';
                        submitButton.textContent = getTranslation(`submit_${module.id}_button`) || originalButtonText;
                        submitButton.classList.remove('opacity-75', 'cursor-not-allowed');
                    });

            } catch (error) { // Catch validation errors
                 if (error.message === "Validation failed") {
                     // Re-enable button immediately if validation failed
                     submitButton.disabled = false;
                      let originalButtonText = 'Analyze';
                     if (module.id === 'hospitalconnect') originalButtonText = 'Submit Request';
                     else if (module.id === 'arogyasos') originalButtonText = 'Get Emergency Info';
                     submitButton.textContent = getTranslation(`submit_${module.id}_button`) || originalButtonText;
                     submitButton.classList.remove('opacity-75', 'cursor-not-allowed');
                 } else {
                     // Log unexpected errors during input gathering
                     console.error("Error during input processing:", error);
                     resultDiv.innerHTML = `<p class="text-red-400">An unexpected error occurred before analysis.</p>`;
                      // Also re-enable button here
                      submitButton.disabled = false;
                      let originalButtonText = 'Analyze';
                      if (module.id === 'hospitalconnect') originalButtonText = 'Submit Request';
                      else if (module.id === 'arogyasos') originalButtonText = 'Get Emergency Info';
                      submitButton.textContent = getTranslation(`submit_${module.id}_button`) || originalButtonText;
                      submitButton.classList.remove('opacity-75', 'cursor-not-allowed');
                 }
            }

        }); // End click listener
    } // End if(submitButton && resultDiv)

    // --- File Upload Logic (remains the same as Part 1's setupModuleEventListeners) ---
     const dropZone = getEl(`drop-zone-${module.id}`);
     const fileInput = getEl(`file-input-${module.id}`);
     const previewContainer = getEl(`preview-${module.id}`);

     if (dropZone && fileInput && previewContainer) {
         let fileType = 'image'; // Default
         if (module.id === 'sonus' || module.id === 'vocaltone') {
             fileType = 'audio';
         }
         // Gait uses 'image' based on the corrected allModules array and logic

         dropZone.addEventListener('click', () => fileInput.click());
         // Allow multiple images only for specific modules
         fileInput.multiple = (module.id === 'healthtrend' || module.id === 'ayur');

         fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files, previewContainer, fileType));

         dropZone.addEventListener('dragover', (e) => {
             e.preventDefault();
             dropZone.classList.add('bg-white/10');
         });
         dropZone.addEventListener('dragleave', () => {
             dropZone.classList.remove('bg-white/10');
         });
         dropZone.addEventListener('drop', (e) => {
             e.preventDefault();
             dropZone.classList.remove('bg-white/10');
             handleFileUpload(e.dataTransfer.files, previewContainer, fileType);
         });
     }
  // --- State/District Dropdown Logic (Added safety checks) ---
    if (module.id === 'govschemes' || module.id === 'hospitalconnect' || module.id === 'outbreak' || module.id === 'arogyasos') {
        const indianStates = {
            "Andaman and Nicobar Islands": ["Nicobar", "North and Middle Andaman", "South Andaman"],
            "Andhra Pradesh": ["Anantapur", "Chittoor", "East Godavari", "Guntur", "Krishna", "Kurnool", "Prakasam", "Sri Potti Sriramulu Nellore", "Srikakulam", "Visakhapatnam", "Vizianagaram", "West Godavari", "YSR Kadapa"],
            "Arunachal Pradesh": ["Tawang", "West Kameng", "East Kameng", "Papum Pare", "Kurung Kumey", "Kra Daadi", "Lower Subansiri", "Upper Subansiri", "West Siang", "East Siang", "Siang", "Upper Siang", "Lower Siang", "Lower Dibang Valley", "Dibang Valley", "Anjaw", "Lohit", "Namsai", "Changlang", "Tirap", "Longding"],
            "Assam": ["Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup", "Kamrup Metropolitan", "Karbi Anglong", "Karimganj", "Kokrajhar", "Lakhimpur", "Majuli", "Morigaon", "Nagaon", "Nalbari", "Sivasagar", "Sonitpur", "South Salmara-Mankachar", "Tinsukia", "Udalguri", "West Karbi Anglong"],
            "Bihar": ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran"],
            "Chandigarh": ["Chandigarh"],
            "Chhattisgarh": ["Balod", "Baloda Bazar", "Balrampur", "Bastar", "Bemetara", "Bijapur", "Bilaspur", "Dantewada", "Dhamtari", "Durg", "Gariaband", "Janjgir-Champa", "Jashpur", "Kanker", "Kabirdham", "Kondagaon", "Korba", "Koriya", "Mahasamund", "Mungeli", "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sukma", "Surajpur", "Surguja"],
            "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu", "Dadra and Nagar Haveli"],
            "Delhi": ["Central Delhi", "East Delhi", "New Delhi", "North Delhi", "North East Delhi", "North West Delhi", "Shahdara", "South Delhi", "South East Delhi", "South West Delhi", "West Delhi"],
            "Goa": ["North Goa", "South Goa"],
            "Gujarat": ["Ahmedabad", "Amreli", "Anand", "Aravalli", "Banaskantha", "Bharuch", "Bhavnagar", "Botad", "Chhota Udaipur", "Dahod", "Dang", "Devbhoomi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar", "Junagadh", "Kheda", "Kutch", "Mahisagar", "Mehsana", "Morbi", "Narmada", "Navsari", "Panchmahal", "Patan", "Porbandar", "Rajkot", "Sabarkantha", "Surat", "Surendranagar", "Tapi", "Vadodara", "Valsad"],
            "Haryana": ["Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad", "Gurugram", "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal", "Kurukshetra", "Mahendragarh", "Nuh", "Palwal", "Panchkula", "Panipat", "Rewari", "Rohtak", "Sirsa", "Sonipat", "Yamunanagar"],
            "Himachal Pradesh": ["Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu", "Lahaul and Spiti", "Mandi", "Shimla", "Sirmaur", "Solan", "Una"],
            "Jammu and Kashmir": ["Anantnag", "Bandipora", "Baramulla", "Budgam", "Doda", "Ganderbal", "Jammu", "Kathua", "Kishtwar", "Kulgam", "Kupwara", "Poonch", "Pulwama", "Rajouri", "Ramban", "Reasi", "Samba", "Shopian", "Srinagar", "Udhampur"],
            "Jharkhand": ["Bokaro", "Chatra", "Deoghar", "Dhanbad", "Dumka", "East Singhbhum", "Garhwa", "Giridih", "Godda", "Gumla", "Hazaribagh", "Jamtara", "Khunti", "Koderma", "Latehar", "Lohardaga", "Pakur", "Palamu", "Ramgarh", "Ranchi", "Sahebganj", "Seraikela Kharsawan", "Simdega", "West Singhbhum"],
            "Karnataka": ["Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban", "Bidar", "Chamarajanagar", "Chikkaballapur", "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad", "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal", "Mandya", "Mysuru", "Raichur", "Ramanagara", "Shivamogga", "Tumakuru", "Udupi", "Uttara Kannada", "Vijayapura", "Yadgir"],
            "Kerala": ["Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam", "Kottayam", "Kozhikode", "Malappuram", "Palakkad", "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad"],
            "Ladakh": ["Kargil", "Leh"],
            "Lakshadweep": ["Lakshadweep"],
            "Madhya Pradesh": ["Agar Malwa", "Alirajpur", "Anuppur", "Ashoknagar", "Balaghat", "Barwani", "Betul", "Bhind", "Bhopal", "Burhanpur", "Chhatarpur", "Chhindwara", "Damoh", "Datia", "Dewas", "Dhar", "Dindori", "Guna", "Gwalior", "Harda", "Hoshangabad", "Indore", "Jabalpur", "Jhabua", "Katni", "Khandwa", "Khargone", "Mandla", "Mandsaur", "Morena", "Narsinghpur", "Neemuch", "Panna", "Raisen", "Rajgarh", "Ratlam", "Rewa", "Sagar", "Satna", "Sehore", "Seoni", "Shahdol", "Shajapur", "Sheopur", "Shivpuri", "Sidhi", "Singrauli", "Tikamgarh", "Ujjain", "Umaria", "Vidisha"],
            "Maharashtra": ["Ahmednagar", "Akola", "Amravati", "Aurangabad", "Beed", "Bhandara", "Buldhana", "Chandrapur", "Dhule", "Gadchiroli", "Gondia", "Hingoli", "Jalgaon", "Jalna", "Kolhapur", "Latur", "Mumbai City", "Mumbai Suburban", "Nagpur", "Nanded", "Nandurbar", "Nashik", "Osmanabad", "Palghar", "Parbhani", "Pune", "Raigad", "Ratnagiri", "Sangli", "Satara", "Sindhudurg", "Solapur", "Thane", "Wardha", "Washim", "Yavatmal"],
            "Manipur": ["Bishnupur", "Chandel", "Churachandpur", "Imphal East", "Imphal West", "Jiribam", "Kakching", "Kamjong", "Kangpokpi", "Noney", "Pherzawl", "Senapati", "Tamenglong", "Tengnoupal", "Thoubal", "Ukhrul"],
            "Meghalaya": ["East Garo Hills", "East Jaintia Hills", "East Khasi Hills", "North Garo Hills", "Ri Bhoi", "South Garo Hills", "South West Garo Hills", "South West Khasi Hills", "West Garo Hills", "West Jaintia Hills", "West Khasi Hills"],
            "Mizoram": ["Aizawl", "Champhai", "Hnahthial", "Khawzawl", "Kolasib", "Lawngtlai", "Lunglei", "Mamit", "Saiha", "Saitual", "Serchhip"],
            "Nagaland": ["Dimapur", "Kiphire", "Kohima", "Longleng", "Mokokchung", "Mon", "Peren", "Phek", "Tuensang", "Wokha", "Zunheboto"],
            "Odisha": ["Angul", "Balangir", "Balasore", "Bargarh", "Bhadrak", "Boudh", "Cuttack", "Deogarh", "Dhenkanal", "Gajapati", "Ganjam", "Jagatsinghpur", "Jajpur", "Jharsuguda", "Kalahandi", "Kandhamal", "Kendrapara", "Keonjhar", "Khordha", "Koraput", "Malkangiri", "Mayurbhanj", "Nabarangpur", "Nayagarh", "Nuapada", "Puri", "Rayagada", "Sambalpur", "Subarnapur", "Sundargarh"],
            "Puducherry": ["Karaikal", "Mahe", "Puducherry", "Yanam"],
            "Punjab": ["Amritsar", "Barnala", "Bathinda", "Faridkot", "Fatehgarh Sahib", "Fazilka", "Ferozepur", "Gurdaspur", "Hoshiarpur", "Jalandhar", "Kapurthala", "Ludhiana", "Mansa", "Moga", "Mohali", "Muktsar", "Pathankot", "Patiala", "Rupnagar", "Sangrur", "Shaheed Bhagat Singh Nagar", "Tarn Taran"],
            "Rajasthan": ["Ajmer", "Alwar", "Banswara", "Baran", "Barmer", "Bharatpur", "Bhilwara", "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa", "Dholpur", "Dungarpur", "Hanumangarh", "Jaipur", "Jaisalmer", "Jalore", "Jhalawar", "Jhunjhunu", "Jodhpur", "Karauli", "Kota", "Nagaur", "Pali", "Pratapgarh", "Rajsamand", "Sawai Madhopur", "Sikar", "Sirohi", "Sri Ganganagar", "Tonk", "Udaipur"],
            "Sikkim": ["East Sikkim", "North Sikkim", "South Sikkim", "West Sikkim"],
            "Tamil Nadu": ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram", "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli", "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar"],
            "Telangana": ["Adilabad", "Bhadradri Kothagudem", "Hyderabad", "Jagtial", "Jangaon", "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar", "Khammam", "Komaram Bheem", "Mahabubabad", "Mahabubnagar", "Mancherial", "Medak", "Medchal-Malkajgiri", "Mulugu", "Nagarkurnool", "Nalgonda", "Narayanpet", "Nirmal", "Nizamabad", "Peddapalli", "Rajanna Sircilla", "Rangareddy", "Sangareddy", "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy", "Warangal Rural", "Warangal Urban", "Yadadri Bhuvanagiri"],
            "Tripura": ["Dhalai", "Gomati", "Khowai", "North Tripura", "Sepahijala", "South Tripura", "Unakoti", "West Tripura"],
            "Uttar Pradesh": ["Agra", "Aligarh", "Prayagraj", "Ambedkar Nagar", "Amethi", "Amroha", "Auraiya", "Azamgarh", "Baghpat", "Bahraich", "Ballia", "Balrampur", "Banda", "Barabanki", "Bareilly", "Basti", "Bhadohi", "Bijnor", "Badaun", "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah", "Etawah", "Ayodhya", "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar", "Ghaziabad", "Ghazipur", "Gonda", "Gorakhpur", "Hamirpur", "Hapur", "Hardoi", "Hathras", "Jalaun", "Jaunpur", "Jhansi", "Kannauj", "Kanpur Dehat", "Kanpur Nagar", "Kasganj", "Kaushambi", "Kushinagar", "Lakhimpur Kheri", "Lalitpur", "Lucknow", "Maharajganj", "Mahoba", "Mainpuri", "Mathura", "Mau", "Meerut", "Mirzapur", "Moradabad", "Muzaffarnagar", "Pilibhit", "Pratapgarh", "Rae Bareli", "Rampur", "Saharanpur", "Sambhal", "Sant Kabir Nagar", "Shahjahanpur", "Shamli", "Shravasti", "Siddharthnagar", "Sitapur", "Sonbhadra", "Sultanpur", "Unnao", "Varanasi"],
            "Uttarakhand": ["Almora", "Bageshwar", "Chamoli", "Champawat", "Dehradun", "Haridwar", "Nainital", "Pauri Garhwal", "Pithoragarh", "Rudraprayag", "Tehri Garhwal", "Udham Singh Nagar", "Uttarkashi"],
            "West Bengal": ["Alipurduar", "Bankura", "Birbhum", "Cooch Behar", "Dakshin Dinajpur", "Darjeeling", "Hooghly", "Howrah", "Jalpaiguri", "Jhargram", "Kalimpong", "Kolkata", "Malda", "Murshidabad", "Nadia", "North 24 Parganas", "Paschim Bardhaman", "Paschim Medinipur", "Purba Bardhaman", "Purba Medinipur", "Purulia", "South 24 Parganas", "Uttar Dinajpur"]
        };

        const stateSelect = getEl('gov-state');
        const districtSelect = getEl('gov-district');

        // Check if elements exist before proceeding
        if (stateSelect && districtSelect) {
             // Clear existing options except maybe a placeholder if needed
            stateSelect.innerHTML = '<option value="">Select State</option>'; // Add a default placeholder

            Object.keys(indianStates).sort().forEach(stateName => { // Sort states alphabetically
                const option = document.createElement('option');
                option.value = stateName;
                option.textContent = stateName;
                stateSelect.appendChild(option);
            });

            const populateDistricts = () => {
                const selectedState = stateSelect.value;
                districtSelect.innerHTML = '<option value="">Select District</option>'; // Reset with placeholder
                districtSelect.disabled = true; // Disable initially

                if (selectedState && indianStates[selectedState]) {
                    indianStates[selectedState].sort().forEach(districtName => { // Sort districts
                        const option = document.createElement('option');
                        option.value = districtName;
                        option.textContent = districtName;
                        districtSelect.appendChild(option);
                    });
                     districtSelect.disabled = false; // Enable if state has districts
                }
                 // Special handling for Hospital Connect's hospital dropdown reset
                if (module.id === 'hospitalconnect') {
                    const hospitalSelect = getEl('hospital-select');
                    if (hospitalSelect) {
                         hospitalSelect.innerHTML = '<option value="">Please select a district first</option>'; // Add value=""
                         hospitalSelect.disabled = true;
                    }
                }
            };

            stateSelect.addEventListener('change', populateDistricts);
            // Don't call populateDistricts() here initially, let the placeholder show
            // populateDistricts();
        } else {
            console.error("State or District select element not found for module:", module.id);
        }
    } // End State/District Logic Check


    // --- Hospital Connect Specific Logic ---
    if (module.id === 'hospitalconnect') {
        const serviceSelect = getEl('hospital-service');
        const appointmentDateGroup = getEl('appointment-date-time-group');
        const emergencyLocationGroup = getEl('emergency-location-group');
        const districtSelect = getEl('gov-district'); // Already defined above, but get reference again
        const hospitalSelect = getEl('hospital-select');

        // Check if elements exist
        if (serviceSelect && appointmentDateGroup && emergencyLocationGroup && districtSelect && hospitalSelect) {
             const populateHospitals = async (district) => {
                hospitalSelect.innerHTML = ''; // Clear previous options
                hospitalSelect.disabled = true;
                hospitalSelect.innerHTML = '<option value="">Loading hospitals...</option>'; // Loading state

                if (!district || district === 'Select District' || district === '') {
                    hospitalSelect.innerHTML = '<option value="">Please select a district first</option>';
                    return;
                }

                 // --- Mock Hospital Data ---
                 // Simulate slight delay like an API call
                 await new Promise(resolve => setTimeout(resolve, 300));

                 try {
                     // In a real app, you'd fetch this from a database/API based on the district
                     const mockHospitals = [
                         `District Government Hospital, ${district}`, `Apollo Hospital, ${district}`,
                         `Max Healthcare, ${district}`, `Fortis Hospital, ${district}`,
                         `Manipal Hospital, ${district}`, `Care Hospital, ${district}`,
                         `Community Health Centre, ${district}`, `ESI Hospital, ${district}`
                     ].sort(); // Sort alphabetically

                     hospitalSelect.innerHTML = '<option value="">Select Hospital</option>'; // Add placeholder first
                     mockHospitals.forEach(hospitalName => {
                         const option = document.createElement('option');
                         option.value = hospitalName; // Use name as value for simplicity here
                         option.textContent = hospitalName;
                         hospitalSelect.appendChild(option);
                     });
                     hospitalSelect.disabled = false;
                 } catch (error) {
                      console.error("Error fetching/populating hospitals:", error);
                      hospitalSelect.innerHTML = '<option value="">Error loading hospitals</option>';
                 }
                // --- End Mock Data ---
             };

             // Ensure districtSelect exists before adding listener
             if (districtSelect) {
                // Add listener to district select to populate hospitals when it changes
                 districtSelect.addEventListener('change', (e) => {
                     // Get the selected district value
                     const selectedDistrict = e.target.value;
                     // Call populateHospitals with the selected district
                     populateHospitals(selectedDistrict);
                 });
             } else {
                 console.error("District select not found for Hospital Connect");
             }


            const toggleVisibility = () => {
                const selectedService = serviceSelect.value;
                 // Toggle based on the *absence* of the 'hidden' class for better control
                appointmentDateGroup.classList.toggle('hidden', selectedService !== 'Appointment Booking');
                emergencyLocationGroup.classList.toggle('hidden', selectedService !== 'Ambulance Request');
            };

            serviceSelect.addEventListener('change', toggleVisibility);
            toggleVisibility(); // Initial call to set correct visibility
        } else {
             console.error("One or more elements for Hospital Connect not found.");
        }
    } // End Hospital Connect Logic


    // --- AI-Scribe Specific Logic ---
    if (module.id === 'aiscribe' && recognition) {
        const scribeMicButton = getEl('scribe-mic-button');
        const scribeMicLabel = getEl('scribe-mic-label');
        const textInput = getEl('text-input'); // This is the output textarea for aiscribe

        if (scribeMicButton && scribeMicLabel && textInput) {
            scribeMicButton.addEventListener('click', () => {
                 if (state.isRecording) {
                    try {
                        recognition.stop(); // Recognition itself handles state change via onend/onerror
                    } catch(e){
                         console.warn("Recognition already stopped?", e);
                         // Manually reset state if stop() fails unexpectedly
                          scribeMicButton.classList.remove('recording');
                          scribeMicLabel.textContent = 'Start Scribing';
                          state.isRecording = false;
                    }
                 } else {
                     try {
                        recognition.lang = state.selectedLanguage;
                        recognition.start();
                        // state.isRecording = true; // Set state in onstart
                     } catch (error) {
                          console.error("Error starting recognition:", error);
                          // Potentially update UI to show error
                          scribeMicButton.classList.remove('recording');
                          scribeMicLabel.textContent = 'Error Starting';
                           if(textInput) textInput.placeholder = `Error starting mic: ${error.message}`;
                          state.isRecording = false;
                     }
                 }
            });

            recognition.onstart = () => {
                // Check if aiscribe is *still* the active module when recognition starts
                if(state.activeModule === 'aiscribe') {
                    scribeMicButton?.classList.add('recording'); // Use optional chaining
                    if (scribeMicLabel) scribeMicLabel.textContent = 'Listening...';
                    state.isRecording = true;
                    if (textInput) {
                        textInput.value = ''; // Clear previous transcription
                        textInput.placeholder = 'Listening... Speak now.';
                    }
                 } else {
                    // If module changed before recognition started, try to stop it.
                    try { recognition.stop(); } catch(e) { console.warn("Could not stop recognition on module change"); }
                 }
            };

            recognition.onend = () => {
                 // Always update state and UI regardless of active module,
                 // as the recording session has ended.
                scribeMicButton?.classList.remove('recording'); // Safety check
                if(scribeMicLabel) scribeMicLabel.textContent = 'Start Scribing';
                state.isRecording = false; // Ensure state is reset
                 if(textInput) textInput.placeholder = 'Your clinical notes will appear here...';

                // If aiscribe is active AND we have a transcript, trigger analysis
                if(state.activeModule === 'aiscribe' && textInput && textInput.value.trim() !== '') {
                    // Find the submit button for aiscribe and click it
                    const aiscribeSubmitButton = getEl('submit-aiscribe');
                    if (aiscribeSubmitButton && !aiscribeSubmitButton.disabled) { // Check if not already processing
                         console.log("Transcription ended, triggering analysis...");
                         aiscribeSubmitButton.click(); // This will trigger the main API call logic
                    }
                }
            };

            recognition.onerror = (event) => {
                 console.error('Scribe recognition error:', event.error, event.message);
                scribeMicButton?.classList.remove('recording');
                if(scribeMicLabel) scribeMicLabel.textContent = 'Mic Error';
                state.isRecording = false; // Ensure state is reset
                 if(textInput) textInput.placeholder = `Mic Error: ${event.error}. Please check permissions or try again.`;
                // Optionally display error message in resultDiv as well
                const resultDiv = getEl(`result-${module.id}`);
                if (resultDiv) resultDiv.innerHTML = `<p class="text-red-400">Speech recognition error: ${event.error}. Please ensure microphone access is allowed.</p>`;
            };

            recognition.onresult = (event) => {
                // Ensure aiscribe is still active and textInput exists
                if(state.activeModule === 'aiscribe' && textInput) {
                    let transcript = '';
                    // Concatenate final results
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            transcript += event.results[i][0].transcript + ' '; // Add space between final segments
                        }
                        // Optionally add interim results for live feedback (more complex)
                        // else { interimTranscript += event.results[i][0].transcript;}
                    }
                     // Update textarea with final transcript collected so far
                    textInput.value += transcript.trim() + ' '; // Append and add space
                    // Analysis is triggered in onend after speech stops
                 }
            };
        } else {
             console.error("Mic button, label, or text input not found for AI-Scribe.");
        }
    } // End AI Scribe logic

    // --- Starter Button Logic (Generic) ---
    const starterModules = ['medsentry', 'genopredict']; // Add 'cogni', 'mindwell' if they get starters
    if (starterModules.includes(module.id)) {
        const startersContainer = getEl(`${module.id}-starters`);
        const textInput = getEl('text-input'); // Assuming standard ID 'text-input'

        if (startersContainer && textInput) {
            startersContainer.addEventListener('click', (e) => {
                // Ensure the click is directly on a button with the correct class
                if (e.target.tagName === 'BUTTON' && e.target.classList.contains('starter-btn')) {
                    const starterText = e.target.textContent.trim(); // Trim whitespace

                    // Specific logic for MedSentry starters
                    if (module.id === 'medsentry') {
                        const goalSelect = getEl('medsentry-goal');
                        if (!goalSelect) return; // Exit if goal select isn't found

                        if (starterText.match(/can i take (.+) with (.+)\?/i)) {
                            const match = starterText.match(/can i take (.+) with (.+)\?/i);
                            const drug1 = match[1].trim();
                            const drug2 = match[2].trim();
                            textInput.value = `${drug1}\n${drug2}`;
                            goalSelect.value = 'Check for potential drug interactions';
                        } else if (starterText.match(/what are the side effects of (.+)\?/i)) {
                            const match = starterText.match(/what are the side effects of (.+)\?/i);
                            textInput.value = match[1].trim();
                            goalSelect.value = 'List common side effects for a medication';
                        } else if (starterText.match(/is there a generic for (.+)\?/i)) {
                             const match = starterText.match(/is there a generic for (.+)\?/i);
                             textInput.value = match[1].trim();
                             goalSelect.value = 'Find potential cheaper alternatives (generics)';
                        } else {
                             // Default case if starter doesn't match patterns
                             textInput.value = starterText;
                             // Maybe set a default goal like 'Get explanation'?
                             // goalSelect.value = 'Get a simple explanation of what a drug is for';
                        }
                    } else {
                        // Default behavior for other modules (like GenoPredict)
                        textInput.value = starterText;
                    }
                    textInput.focus(); // Focus the input field after setting value
                }
            });
        }
    } // End Starter Button Logic


}; // ========== END of setupModuleEventListeners ==========


// --- API Call Logic --- (Remains the same as Part 1, repeated for completeness if needed)
const callGeminiAPI = async (systemPrompt, textInput, resultDisplay, type) => { /* ... Function content ... */ };

// --- File Handling Logic --- (Remains the same as Part 1, repeated for completeness if needed)
const handleFileUpload = (files, previewContainer, expectedType) => { /* ... Function content ... */ };

// --- Chat Message Display --- (Remains the same)
const displayChatMessage = (message, container) => { /* ... Function content ... */ };

// --- Fetch with Retry --- (Remains the same)
async function fetchWithRetry(url, options, retries = 3, delay = 1000) { /* ... Function content ... */ };

// --- Three.js Background Animation --- (Remains the same)
function initThreeJS() { /* ... Function content ... */ };
const animate = () => { /* ... Function content ... */ };

// --- DOMContentLoaded Event Listener --- (Remains the same)
window.addEventListener('DOMContentLoaded', () => {
    initializeAppAndAuth();
    // Only init ThreeJS if the canvas exists
    if (getEl('threejs-canvas')) {
        initThreeJS();
        animate();
    }


    const langSelect = getEl('language-select');
    const dashboardLangSelect = getEl('dashboard-language-select');

    // Add safety checks for language selectors
    if (langSelect && dashboardLangSelect) {
        langSelect.addEventListener('change', (e) => {
            setLanguage(e.target.value);
            dashboardLangSelect.value = e.target.value; // Sync dropdowns
        });
        dashboardLangSelect.addEventListener('change', (e) => {
            setLanguage(e.target.value);
            langSelect.value = e.target.value; // Sync dropdowns
        });
        // Set initial language based on modal select
        setLanguage(langSelect.value);
    } else {
        console.warn("Language select dropdowns not found.");
        setLanguage('en-US'); // Default to English if selectors are missing
    }


    // Auth buttons
    getEl('login-button')?.addEventListener('click', () => handleAuthentication(true));
    getEl('signup-button')?.addEventListener('click', () => handleAuthentication(false));
    getEl('anonymous-button')?.addEventListener('click', () => {
         // This UI logic might be better handled within updateUIForAuthState(null)
         // but keeping it here for consistency with original code
         getEl('auth-forms-container')?.classList.add('hidden');
         getEl('modal-proceed-button')?.classList.remove('hidden');
         getEl('anonymous-button')?.classList.add('hidden');
         userId = `anon-${crypto.randomUUID()}`; // Generate ID
         getEl('user-id-display').textContent = `Anonymous`; // Update display
         // No need to call updateUIForAuthState here as it's not a real auth change
    });
    getEl('logout-button')?.addEventListener('click', async () => {
         try {
             await signOut(auth);
             // onAuthStateChanged will handle UI updates
         } catch (error) {
              console.error("Sign out error:", error);
         }
    });

    // Proceed button
    getEl('modal-proceed-button')?.addEventListener('click', () => {
        welcomeAuthModal?.classList.add('opacity-0', 'pointer-events-none');
        appWrapper?.classList.remove('hidden');
        // Use timeout to allow CSS transition for modal fade-out
        setTimeout(() => {
            appWrapper?.classList.remove('opacity-0'); // Fade in app
             // Animate in other elements
             getEl('sidebar-modules')?.classList.remove('-translate-x-full');
             getEl('header-content')?.classList.remove('-translate-y-full');
             arogyaAssistantToggle?.classList.remove('scale-0');
             state.isSidebarOpen = true; // Assume sidebar starts open on desktop
              if (window.innerWidth < 768) { // If mobile, maybe keep it closed initially
                  getEl('sidebar-modules')?.classList.add('-translate-x-full');
                  state.isSidebarOpen = false;
              }
        }, 300); // Shorter delay might feel snappier
    });

    // Sidebar toggle
    getEl('toggle-sidebar-button')?.addEventListener('click', () => {
        getEl('sidebar-modules')?.classList.toggle('-translate-x-full');
        state.isSidebarOpen = !state.isSidebarOpen;
    });

    // Assistant Panel Toggle
    arogyaAssistantToggle?.addEventListener('click', () => {
        arogyaAssistantPanel?.classList.remove('translate-x-full');
        arogyaAssistantToggle?.classList.add('scale-0'); // Hide button when panel open
    });
    getEl('close-assistant-panel')?.addEventListener('click', () => {
        arogyaAssistantPanel?.classList.add('translate-x-full');
        arogyaAssistantToggle?.classList.remove('scale-0'); // Show button when panel closed
    });

    // Chat Input Handling
    const handleChatInput = async () => {
        const text = chatInput?.value.trim();
        if (!text || !chatWindow) return; // Exit if no text or chat window

        displayChatMessage({ sender: 'user', text }, chatWindow);
        chatInput.value = ''; // Clear input
        chatInput.disabled = true; // Disable input during AI response
        const micButton = getEl('mic-button');
        if(micButton) micButton.disabled = true;


        // Simple Gemini call for chat
        const systemPrompt = `You are Arogya Co-pilot, a friendly AI health assistant. Respond concisely in ${state.selectedLanguage}. Avoid markdown.`;
         try {
            const textResponse = await callGeminiAPIChat(systemPrompt, text);
            displayChatMessage({ sender: 'ai', text: textResponse || "Sorry, I couldn't process that." }, chatWindow);
         } catch (error) {
              console.error("Chat API error:", error);
              displayChatMessage({ sender: 'ai', text: "An error occurred fetching response." }, chatWindow);
         } finally {
             chatInput.disabled = false; // Re-enable input
             if(micButton) micButton.disabled = false;
             chatInput.focus(); // Focus input for next message
         }
    };


    chatInput?.addEventListener('keydown', (e) => {
        // Check if Enter key is pressed without Shift key
        if (e.key === 'Enter' && !e.shiftKey) {
             e.preventDefault(); // Prevent default newline behavior
            handleChatInput();
        }
    });

    // Mic Button for Chat (if recognition is available)
    if (recognition) {
        const micButton = getEl('mic-button');
        if (micButton) {
            micButton.addEventListener('click', () => {
                if (state.isRecording) {
                    try { recognition.stop(); } catch(e){ console.warn("Chat mic stop error", e); state.isRecording = false; micButton.classList.remove('recording'); } // Force state reset
                } else {
                     try {
                        recognition.lang = state.selectedLanguage;
                        recognition.start();
                     } catch(error){
                          console.error("Chat mic start error:", error);
                          micButton.classList.remove('recording'); // Ensure UI reset on error
                     }
                }
            });

             // Use different handlers than aiscribe to avoid conflicts
            recognition.addEventListener('start', () => {
                 // Only add recording class if the assistant panel is likely the target
                 if (!state.activeModule || state.activeModule !== 'aiscribe') {
                     micButton?.classList.add('recording');
                     state.isRecording = true;
                 }
            });
             recognition.addEventListener('end', () => {
                 micButton?.classList.remove('recording');
                 state.isRecording = false;
            });
             recognition.addEventListener('error', (e) => {
                 console.error('Chat speech recognition error:', e.error);
                 micButton?.classList.remove('recording');
                 state.isRecording = false;
                 // Maybe show error in chat?
                 // displayChatMessage({ sender: 'ai', text: `Mic error: ${e.error}` }, chatWindow);
            });
             recognition.addEventListener('result', (event) => {
                 // Only process if not currently using aiscribe module
                 if (state.activeModule !== 'aiscribe') {
                    let transcript = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            transcript += event.results[i][0].transcript;
                        }
                    }
                     if (chatInput && transcript) {
                         chatInput.value = transcript; // Put result in input
                         handleChatInput(); // Send the message
                     }
                 }
            });
        }
    } else {
        // Hide mic button if SpeechRecognition is not supported
        getEl('mic-button')?.classList.add('hidden');
    }

    // Speak Button Delegation (remains the same)
    document.body.addEventListener('click', (e) => {
        const speakButton = e.target.closest('.speak-btn');
        if (speakButton) {
            const textToSpeak = speakButton.dataset.speakText;
            if (textToSpeak) {
                 speak(textToSpeak, speakButton);
            }
        }
    });


    // Mouse move for threejs (if initialized)
    if (renderer) {
        document.addEventListener('mousemove', (e) => {
            // Normalize mouse position
            mouseX = (e.clientX / window.innerWidth) * 2 - 1;
            mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
            // The animation loop will use these - simplified the calculation
        });

         window.addEventListener('resize', () => {
             if (camera && renderer) {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
             }
         });
    }

}); // End DOMContentLoaded


// --- Simplified Gemini call for CHAT ---
const callGeminiAPIChat = async (systemPrompt, textInput) => {
    const apiKey = "AIzaSyCbPOQM8vN7pou3lupqEd-1MfTFGnA61UM"; // Replace with your Gemini API Key
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`; // Use 1.5 Flash
    const payload = {
        contents: [{ role: "user", parts: [{ text: textInput }] }], // Use user role
        systemInstruction: { parts: [{ text: systemPrompt }] },
         generationConfig: {
            responseMimeType: "text/plain", // Request plain text
             // Adjust chat-specific settings if needed
             // temperature: 0.8,
        }
    };
    try {
        const response = await fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

         // More robust checking for chat response
         if (result.candidates && result.candidates.length > 0 &&
             result.candidates[0].content && result.candidates[0].content.parts &&
             result.candidates[0].content.parts.length > 0 && result.candidates[0].content.parts[0].text)
         {
             // Check finish reason for safety etc.
             const finishReason = result.candidates[0].finishReason;
             if (finishReason && finishReason !== "STOP") {
                 console.warn("Chat API finished with reason:", finishReason);
                  if (finishReason === "SAFETY") return "My safety settings prevented me from generating a response to that.";
                  // Handle other reasons if necessary
             }
             return result.candidates[0].content.parts[0].text;
         } else if (result.promptFeedback) {
             console.error("Chat Prompt feedback:", result.promptFeedback);
             return `I couldn't process that due to content restrictions (${result.promptFeedback.blockReason}).`;
         } else {
              console.error("Invalid chat response structure:", result);
             return "Sorry, I received an unexpected response.";
         }
    } catch (error) {
        console.error("Chat API Fetch Error:", error);
        return "An error occurred while trying to reach the AI assistant. Please try again later.";
    }
};


// --- Emergency Data Loading --- (remains the same)
async function loadEmergencyData(state, district, container) { /* ... Function content ... */ };

// Ensure ThreeJS objects are imported if using modules outside the main script tag
// e.g. import * as THREE from 'three'; (if installed via npm)
// Or ensure the global THREE object is available from the CDN script.
