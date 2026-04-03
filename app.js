document.addEventListener("DOMContentLoaded", () => {
    // ---- DOM Elements ----
    const scoreDisplay = document.getElementById("score-display");
    const targetNameDisplay = document.getElementById("target-name");
    const targetCountryDisplay = document.getElementById("target-country");
    const timerFill = document.getElementById("timer-bar-fill");
    const timerContainer = document.getElementById("terminal-timer-element");
    
    const typingInput = document.getElementById("typing-input");
    const typingOverlay = document.getElementById("typing-overlay");
    
    const gameOverPanel = document.getElementById("game-over-panel");
    const activeTerminal = document.getElementById("active-terminal");
    const explosionContainer = document.getElementById("explosion-container");
    const toggleMapBtn = document.getElementById("toggle-map-btn");
    
    // Start Screen Elements
    const startScreen = document.getElementById("start-screen");
    const classicModeBtn = document.getElementById("classic-mode-btn");
    const survivalModeBtn = document.getElementById("survival-mode-btn");
    const classicBestDisplay = document.getElementById("classic-best-display");
    const survivalBestDisplay = document.getElementById("survival-best-display");

    // Game Over Elements
    const statTotalTime = document.getElementById("stat-total-time");
    const statFastestHack = document.getElementById("stat-fastest-hack");
    const statTotalTargets = document.getElementById("stat-total-targets");
    const finalScore = document.getElementById("title-score");
    const historyBody = document.getElementById("attack-history-body");
    const restartBtn = document.getElementById("restart-btn");
    const newRecordBadge = document.getElementById("new-record-badge");
    
    // HUD Mode Elements
    const hudTime = document.getElementById("hud-time");
    const hudRightLabel = document.getElementById("hud-right-label");
    const hudRightModule = document.getElementById("hud-right");
    const hudClassicProgress = document.getElementById("hud-classic-progress");
    const hudCitiesLeft = document.getElementById("hud-cities-left");

    // ---- Core State ----
    let score = 0;
    let isGameOver = false;
    let currentTarget = null;
    let targetMarker = null;
    let isTransitioning = false;
    let previousInputVal = "";

    // Sort State for history table
    let currentSortCol = null;
    let currentSortDir = 1; // 1 = asc, -1 = desc
    let isFirstTarget = false;
    
    // Mode State
    let gameMode = null; // 'classic' | 'survival'
    
    // Classic Mode State
    const CLASSIC_CITY_COUNT = 20;
    let citiesRemaining = 0;
    let citiesCleared = 0;
    // Mission Timing Constants
    const baseTime = 6000; // 6.0 seconds typing window as requested
    const SURVIVAL_START_MS = 60000;
    const SURVIVAL_TIME_PER_CITY_MS = 6000;
    const SURVIVAL_TYPO_PENALTY_MS = 500;

    // Per-City Timer State
    let currentTime = 10000;
    let timerInterval = null;
    let clockInterval = null;

    // Engine Tracking
    let gameStartTime = 0;
    let classicRunStartTime = 0;
    let globalTimeMs = 0;
    let globalCountdownInterval = null;
    let attackHistory = [];
    let currentAttack = { name: "", startTime: 0, typos: [] };
    let availableCities = [];
    let permanentMarkers = [];

    // ---- Intelligence Database ----
    const cityDatabase = window.cityDatabase || [];

    // ---- High Score Helpers ----
    function saveHighScore(mode, value) {
        localStorage.setItem(`geotyper_${mode}_best`, String(value));
    }

    function loadHighScore(mode) {
        const val = localStorage.getItem(`geotyper_${mode}_best`);
        return val !== null ? parseFloat(val) : null;
    }

    function formatTime(ms) {
        const totalSec = Math.floor(ms / 1000);
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        return `${mins}:${secs}`;
    }

    function formatSeconds(totalSec) {
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        return `${mins}:${secs}`;
    }

    function updateBestDisplays() {
        const classicBest = loadHighScore('classic');
        if (classicBest !== null) {
            classicBestDisplay.textContent = `HIGHSCORE: ${Math.floor(classicBest).toLocaleString()}`;
        } else {
            classicBestDisplay.textContent = `HIGHSCORE: 0`;
        }

        const survivalBest = loadHighScore('survival');
        if (survivalBest !== null) {
            survivalBestDisplay.textContent = `BEST TIME: ${formatSeconds(survivalBest)}`;
        } else {
            survivalBestDisplay.textContent = `BEST TIME: 0:00`;
        }
    }

    // ---- Initialize Map ----
    const map = L.map('map-viz', { zoomControl: false, attributionControl: false, interactive: false }).setView([20.0, 0.0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    const tacticalIconHTML = `
        <div class="tactical-wrapper">
            <div class="tactical-corners"></div>
            <div class="radar-pulse"></div>
            <div class="tactical-center">+</div>
        </div>`;

    function createTargetIcon() {
        return L.divIcon({
            className: 'custom-leaflet-icon',
            html: tacticalIconHTML,
            iconSize: [60, 60],
            iconAnchor: [30, 30]
        });
    }

    // ---- Survival: Global Countdown ----
    function startGlobalCountdown() {
        stopGlobalCountdown();
        globalCountdownInterval = setInterval(() => {
            globalTimeMs -= 50;
            updateSurvivalClock();
            if (globalTimeMs <= 0) {
                globalTimeMs = 0;
                updateSurvivalClock();
                stopGlobalCountdown();
                triggerEndScreen('timeout');
            }
        }, 50);
    }

    function stopGlobalCountdown() {
        if (globalCountdownInterval) {
            clearInterval(globalCountdownInterval);
            globalCountdownInterval = null;
        }
    }

    function updateSurvivalClock() {
        const totalSec = globalTimeMs / 1000;
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(Math.floor(totalSec % 60)).padStart(2, '0');
        hudTime.textContent = `${mins}:${secs}`;

        const isDanger = globalTimeMs <= 15000;
        const isWarning = globalTimeMs <= 30000 && !isDanger;

        // Reset classes
        hudTime.classList.remove('warning', 'danger');
        hudRightLabel.classList.remove('warning', 'danger');
        hudRightModule.classList.remove('warning', 'danger');

        if (isDanger) {
            hudTime.classList.add('danger');
            hudRightLabel.classList.add('danger');
            hudRightModule.classList.add('danger');
        } else if (isWarning) {
            hudTime.classList.add('warning');
            hudRightLabel.classList.add('warning');
            hudRightModule.classList.add('warning');
        }
    }

    // ---- HUD Mode Setup ----
    function configureHUDForMode(mode) {
        // Reset all mode-specific classes first
        hudTime.classList.remove('warning', 'danger', 'survival-clock');
        hudRightLabel.classList.remove('warning', 'danger', 'survival-label');
        hudRightModule.classList.remove('warning', 'danger');

        if (mode === 'classic') {
            hudRightLabel.textContent = 'CITY';
            hudRightLabel.className = 'hud-label';
            hudTime.className = 'hud-value';
            hudTime.textContent = `1 / ${CLASSIC_CITY_COUNT}`;
            hudClassicProgress.classList.add('hidden');
            hudCitiesLeft.classList.add('hidden');
        } else if (mode === 'survival') {
            hudRightLabel.textContent = 'UPTIME';
            hudRightLabel.className = 'hud-label survival-label';
            hudTime.className = 'hud-value survival-clock';
            hudTime.textContent = '01:00';
            hudClassicProgress.classList.add('hidden');
            hudCitiesLeft.classList.add('hidden');
        }
    }

    function updateClassicHUD() {
        const current = citiesCleared + 1;
        const total = CLASSIC_CITY_COUNT;
        hudTime.textContent = `${Math.min(current, total)} / ${total}`;
    }

    // ---- Game Loop: Pick Target ----
    function pickNextTarget() {
        // Classic mode: check if run is done before picking next
        if (gameMode === 'classic' && citiesRemaining <= 0) {
            triggerEndScreen('completed');
            return;
        }

        isTransitioning = true;
        clearInterval(timerInterval);
        
        targetNameDisplay.textContent = "ACQUIRING...";
        targetCountryDisplay.textContent = "Moving to coordinates...";
        typingInput.value = "";
        previousInputVal = "";
        typingInput.disabled = true;
        typingOverlay.innerHTML = ""; 
        timerFill.style.opacity = "0";

        if (targetMarker) {
            map.removeLayer(targetMarker);
            targetMarker = null;
        }

        // Replenish pool if empty
        if (availableCities.length === 0) {
            availableCities = [...cityDatabase];
        }
        
        const oldTarget = currentTarget;
        const randomIndex = Math.floor(Math.random() * availableCities.length);
        currentTarget = availableCities.splice(randomIndex, 1)[0];
        
        // Draw hack-route from old target
        if (oldTarget) {
            const pathColor = oldTarget.pathColor || '#4ade80';
            const flightPath = L.polyline([[oldTarget.lat, oldTarget.lng], [currentTarget.lat, currentTarget.lng]], {
                color: pathColor, weight: 2, className: 'hack-route-line'
            }).addTo(map);
            permanentMarkers.push(flightPath);
        }

        const zoomLevel = 5 + Math.floor(Math.random() * 3);
        map.flyTo([currentTarget.lat, currentTarget.lng], zoomLevel, { animate: true, duration: 1.5 });

        setTimeout(() => {
            if (isGameOver) return;
            
            targetMarker = L.marker([currentTarget.lat, currentTarget.lng], {
                icon: createTargetIcon()
            }).addTo(map);

            targetNameDisplay.textContent = currentTarget.name;
            targetCountryDisplay.textContent = currentTarget.country;
            
            typingInput.value = "";
            typingInput.disabled = false;
            updateTypingOverlay("");
            
            anime({
                targets: '#typing-overlay span',
                translateY: [-20, 0],
                opacity: [0, 1],
                delay: anime.stagger(50),
                easing: 'easeOutQuad',
                duration: 400,
                complete: () => { typingInput.focus(); }
            });

            // Initialize Telemetry
            currentAttack = { 
                index: attackHistory.length + 1,
                name: currentTarget.name, 
                startTime: Date.now(), 
                typos: [], 
                keystrokeLog: [] 
            };

            // Standardized 6.0s per city (Competition Balance)
            currentTime = baseTime;
            
            timerFill.style.opacity = "1";
            updateTimerBar();

            // First Strike: Start timers on first keypress
            if (!isFirstTarget) {
                startTimer();
                // Survival: start global countdown on first target activation
                if (gameMode === 'survival') {
                    startGlobalCountdown();
                }
            }
            isTransitioning = false;
        }, 1600);
    }

    // ---- Per-City Timer ----
    function startTimer() {
        updateTimerBar();
        timerInterval = setInterval(() => {
            currentTime -= 50; 
            updateTimerBar();

            if (currentTime <= 0) {
                clearInterval(timerInterval);
                handleCityTimeout();
            }
        }, 50);
    }

    function handleCityTimeout() {
        if (!currentTarget) return;

        // Record the failed city with score=0 and accuracy=0
        if (!currentAttack.failed) {
            currentAttack.failed = true;
            currentAttack.hackTime = baseTime;
            currentAttack.score = 0;
            currentAttack.accuracy = 0; // Forced 0% for timeout
            currentAttack.index = attackHistory.length + 1;
            attackHistory.push(currentAttack);

            // Survival: timeout penalty (-5 seconds)
            if (gameMode === 'survival') {
                globalTimeMs = Math.max(0, globalTimeMs - 5000);
                triggerFloatingFeedback('-5s', true, 'penalty-text');
                updateSurvivalClock();
            }
        }

        // Drop a fatal red dot on the map with label
        const fatalMarker = L.marker([currentTarget.lat, currentTarget.lng], {
            icon: L.divIcon({ 
                className: 'custom-leaflet-icon', 
                html: `
                    <div class="secured-node-container">
                        <div class="secured-node-label" style="color: #ef4444">${currentTarget.name}</div>
                        <div class="secured-node node-fatal"></div>
                    </div>
                `, 
                iconSize: [60, 40], 
                iconAnchor: [30, 35] 
            })
        }).addTo(map);
        currentTarget.pathColor = '#ef4444';
        permanentMarkers.push(fatalMarker);

        if (gameMode === 'classic') {
            // Classic: timeout is game over — end the run immediately
            triggerEndScreen('timeout');
        } else if (gameMode === 'survival') {
            // Survival: per-city timeout just moves on — global clock is the real killer
            pickNextTarget();
        }
    }

    function updateTimerBar() {
        const percentage = (currentTime / baseTime) * 100;
        timerFill.style.width = `${Math.max(0, percentage)}%`;

        if (percentage < 30) {
            if (!timerFill.classList.contains("health-warning")) timerFill.classList.add("health-warning");
        } else {
            timerFill.classList.remove("health-warning");
        }
    }

    function applyPenalty(wrongChar) {
        currentAttack.typos.push(wrongChar); 

        // Survival: typo drains global clock
        if (gameMode === 'survival') {
            globalTimeMs = Math.max(0, globalTimeMs - SURVIVAL_TYPO_PENALTY_MS);
            updateSurvivalClock();
        }

        anime({
            targets: timerContainer,
            translateX: [0, -15, 15, -10, 10, -5, 5, 0],
            duration: 400,
            easing: 'easeInOutSine'
        });
        anime({
            targets: timerFill,
            backgroundColor: ['#ef4444', '#38bdf8'],
            duration: 500,
            easing: 'easeOutExpo'
        });
    }

    // ---- Typing Engine ----
    typingInput.addEventListener("input", (e) => {
        if (isGameOver || isTransitioning || !currentTarget) return;

        // First Strike activation
        if (isFirstTarget) {
            isFirstTarget = false;
            gameStartTime = Date.now();
            if (gameMode === 'classic') classicRunStartTime = Date.now();
            currentAttack.startTime = Date.now();
            clockInterval = setInterval(updateElapsedClock, 1000);
            startTimer();
            if (gameMode === 'survival') {
                startGlobalCountdown();
            }
        }
        
        const inputVal = e.target.value.toUpperCase();
        const targetString = currentTarget.name.toUpperCase();

        if (inputVal.length > targetString.length) {
            e.target.value = inputVal.substring(0, targetString.length);
            return;
        }

        if (inputVal.length > previousInputVal.length) {
            const newestIndex = inputVal.length - 1;
            const typedChar = inputVal[newestIndex];
            const expectedChar = targetString[newestIndex];

            if (typedChar === expectedChar) {
                currentAttack.keystrokeLog.push({ char: typedChar, correct: true });
            } else {
                currentAttack.keystrokeLog.push({ char: typedChar, correct: false });
                applyPenalty(typedChar);
            }
        }
        previousInputVal = inputVal;
        updateTypingOverlay(inputVal);

        if (inputVal === targetString) {
            handleTargetCompleted();
        }
    });

    function updateTypingOverlay(inputVal) {
        if (!currentTarget) {
            typingOverlay.innerHTML = "";
            return;
        }

        const targetString = currentTarget.name.toUpperCase();
        let html = "";

        for (let i = 0; i < targetString.length; i++) {
            const expectedChar = targetString[i];
            const typedChar = inputVal[i];

            if (typedChar === undefined) {
                html += `<span class="typed-pending">${expectedChar === " " ? "&nbsp;" : expectedChar}</span>`;
            } else if (typedChar === expectedChar) {
                html += `<span class="typed-correct">${expectedChar === " " ? "&nbsp;" : expectedChar}</span>`;
            } else {
                html += `<span class="typed-wrong">${typedChar === " " ? "&nbsp;" : typedChar}</span>`;
            }
        }
        typingOverlay.innerHTML = html;
    }

    // ---- Scoring & Stats ----
    let displayScore = 0; // for rolling counter
    function animateScoreDisplay(targetValue) {
        const obj = { val: displayScore };
        anime({
            targets: obj,
            val: targetValue,
            round: 1,
            easing: 'easeOutQuad',
            duration: 600,
            update: () => {
                displayScore = obj.val;
                scoreDisplay.textContent = displayScore;
            }
        });
    }

    // ---- Elapsed Clock (for display during gameplay) ----
    function updateElapsedClock() {
        // Only used for Classic elapsed time display (optional background tracking)
        // Survival clock is driven by globalTimeMs
    }

    // ---- City Completed ----
    function handleTargetCompleted() {
        clearInterval(timerInterval);
        
        const durationMs = Date.now() - currentAttack.startTime;
        const remainingMs = Math.max(0, currentTime); // time left on city bar

        // Scoring
        // Scoring logic (Intelligence + Efficiency)
        const lengthPoints = currentTarget.name.length * 20; // 20 pts per character (Intelligence Bonus)
        const speedPoints = Math.max(0, (baseTime - durationMs) / 20); // Each 20ms saved is 1 point (Efficiency Bonus)
        const accuracyMult = currentAttack.typos.length === 0 ? 1.5 : Math.max(0.4, 1 - (currentAttack.typos.length * 0.15));
        const roundScore = Math.floor((lengthPoints + speedPoints) * accuracyMult);
        score += roundScore;
        animateScoreDisplay(score);

        // Telemetry: store score and per-word accuracy on the record
        currentAttack.hackTime = durationMs;
        currentAttack.score = roundScore;
        const correctKeys = currentAttack.keystrokeLog.filter(k => k.correct).length;
        const totalKeys = currentAttack.keystrokeLog.length;
        currentAttack.accuracy = totalKeys === 0 ? 0 : (correctKeys / totalKeys) * 100;
        attackHistory.push(currentAttack);

        // Map marker
        let nodeClass = 'secured-node';
        let routeColor = '#4ade80';
        if (currentAttack.typos.length > 0) {
            nodeClass = 'secured-node node-warning';
            routeColor = '#f59e0b';
        }
        currentTarget.pathColor = routeColor;

        const securedMarker = L.marker([currentTarget.lat, currentTarget.lng], {
            icon: L.divIcon({ 
                className: 'custom-leaflet-icon', 
                html: `
                    <div class="secured-node-container">
                        <div class="secured-node-label" style="color: ${routeColor}">${currentTarget.name}</div>
                        <div class="${nodeClass}"></div>
                    </div>
                `, 
                iconSize: [60, 40], 
                iconAnchor: [30, 35] 
            })
        }).addTo(map);
        permanentMarkers.push(securedMarker);

        // Mode-specific feedback
        if (gameMode === 'survival') {
            const hasTypos = currentAttack.typos.length > 0;
            const bonusMs = Math.floor(currentTime * (hasTypos ? 0.5 : 1.0));
            const floatingClass = hasTypos ? 'survival-warning-text' : 'survival-text';
            
            globalTimeMs += bonusMs;
            updateSurvivalClock();
            
            // Show TIME as the primary floating RPG text
            triggerFloatingFeedback(`+${(bonusMs / 1000).toFixed(1)}s`, true, floatingClass);
        } else if (gameMode === 'classic') {
            citiesCleared++;
            citiesRemaining--;
            updateClassicHUD();
            
            // Show SCORE as the primary floating RPG text
            triggerFloatingFeedback(`+${roundScore}`, false);
        }

        // --- HUD Feedback Juice ---
        const statusClass = currentAttack.typos.length === 0 ? 'status-success' : 'status-warning';
        const modules = document.querySelectorAll('.hud-module');
        const terminal = document.getElementById('active-terminal');
        
        // Pulse ALL modules and terminal
        modules.forEach(m => {
            m.classList.remove('status-success', 'status-warning');
            m.classList.add(statusClass);
        });
        terminal.classList.remove('status-success', 'status-warning');
        terminal.classList.add(statusClass);

        // FADE ALL BACK TO DEFAULT after 1.5s
        setTimeout(() => {
            modules.forEach(m => {
                m.classList.remove('status-success', 'status-warning');
            });
            terminal.classList.remove('status-success', 'status-warning');
        }, 1500);

        triggerExplosion();
        triggerTextExplosion();
        
        pickNextTarget();
    }

    // ---- Animations ----
    function triggerExplosion() {
        if (!targetMarker) return;
        const point = map.latLngToContainerPoint([currentTarget.lat, currentTarget.lng]);
        
        const particleCount = 40;
        const particles = [];
        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement("div");
            p.classList.add("particle");
            p.style.left = `${point.x}px`;
            p.style.top = `${point.y}px`;
            explosionContainer.appendChild(p);
            particles.push(p);
        }

        anime({
            targets: particles,
            translateX: () => anime.random(-150, 150),
            translateY: () => anime.random(-150, 150),
            scale: [1, 0],
            opacity: [1, 0],
            easing: 'easeOutExpo',
            duration: 1000,
            complete: () => { particles.forEach(p => p.remove()); }
        });
    }

    function triggerTextExplosion() {
        const clone = document.createElement("div");
        clone.innerHTML = typingOverlay.innerHTML;
        clone.className = "typing-overlay text-explosion-container";
        
        const rect = typingOverlay.getBoundingClientRect();
        clone.style.position = "absolute";
        clone.style.top = `${rect.top}px`;
        clone.style.left = `${rect.left}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.pointerEvents = "none";
        clone.style.zIndex = "100";
        document.body.appendChild(clone);

        const spans = clone.querySelectorAll("span");
        anime({
            targets: spans,
            translateX: () => anime.random(-150, 150),
            translateY: () => anime.random(-50, -250),
            rotate: () => anime.random(-90, 90),
            opacity: [1, 0],
            easing: 'easeOutExpo',
            duration: 1200,
            complete: () => { clone.remove(); }
        });
    }

    function triggerFloatingFeedback(text, isSurvival, customClass) {
        const rect = activeTerminal.getBoundingClientRect();
        const fct = document.createElement("div");
        fct.classList.add("floating-score-text");
        if (isSurvival) fct.classList.add("survival-text");
        if (customClass) fct.classList.add(customClass);
        
        fct.textContent = text;
        fct.style.left = `${rect.left + rect.width / 2}px`;
        fct.style.top = `${rect.top}px`;
        explosionContainer.appendChild(fct);

        anime.timeline()
        .add({
            targets: fct,
            translateX: '-50%',
            translateY: [-20, -150],
            opacity: [0, 1],
            scale: [0.5, 1.4],
            easing: 'easeOutElastic(1.2, .5)',
            duration: 800
        })
        .add({
            targets: fct,
            translateX: '-50%',
            translateY: [-150, -300],
            opacity: [1, 0],
            scale: [1.4, 0.9],
            easing: 'easeInSine',
            duration: 500,
            complete: () => fct.remove()
        });

        anime({
            targets: activeTerminal,
            scale: [1, 1.05, 1],
            duration: 400,
            easing: 'easeOutQuad'
        });
    }

    // ---- Game State Transitions ----
    function startGame(mode) {
        gameMode = mode;
        isGameOver = false;
        currentTarget = null;
        score = 0;
        attackHistory = [];
        citiesCleared = 0;

        permanentMarkers.forEach(m => map.removeLayer(m));
        permanentMarkers = [];
        
        gameStartTime = null;
        isFirstTarget = true;
        clearInterval(clockInterval);
        clearInterval(timerInterval);
        stopGlobalCountdown();

        scoreDisplay.textContent = '0';
        timerFill.style.width = `100%`;
        timerFill.classList.remove("health-warning");
        
        gameOverPanel.classList.add("hidden");
        gameOverPanel.classList.remove("minimized-panel");
        if (toggleMapBtn) toggleMapBtn.innerHTML = `VIEW MAP <span style="font-family: monospace;">[ _ ]</span>`;
        
        activeTerminal.classList.remove("hidden");
        document.getElementById("top-hud").classList.remove("hidden");
        historyBody.innerHTML = "";

        // Reset HUD States
        const modules = document.querySelectorAll('.hud-module');
        const terminal = document.getElementById('active-terminal');
        modules.forEach(m => m.classList.remove('status-success', 'status-warning'));
        terminal.classList.remove('status-success', 'status-warning');

        // Mode-specific setup
        if (mode === 'classic') {
            citiesRemaining = CLASSIC_CITY_COUNT;
            // Take exactly 20 random cities from the database
            const shuffled = [...cityDatabase].sort(() => Math.random() - 0.5);
            availableCities = shuffled.slice(0, CLASSIC_CITY_COUNT);
            configureHUDForMode('classic');
        } else if (mode === 'survival') {
            globalTimeMs = SURVIVAL_START_MS;
            availableCities = [...cityDatabase].sort(() => Math.random() - 0.5);
            configureHUDForMode('survival');
            updateSurvivalClock();
        }

        pickNextTarget();
    }

    function triggerEndScreen(reason) {
        // Prevent double-trigger
        if (isGameOver) return;
        isGameOver = true;

        clearInterval(timerInterval);
        clearInterval(clockInterval);
        stopGlobalCountdown();
        
        typingInput.disabled = true;
        activeTerminal.classList.add("hidden");
        document.getElementById("top-hud").classList.add("hidden");
        if (targetMarker && targetMarker.getElement()) {
            targetMarker.getElement().style.filter = "grayscale(1)";
        }

        // Ensure no attacks are logged while transitioning (prevents double-tap bugs)
        if (isTransitioning) {
            currentTarget = null; 
        }

        // ---- Capture last active attack if unfinished (Death Word) ----
        // We only include this in Classic mode, as it's the "mission-ending" failure event.
        // In Survival, we discard the final death-word to keep your endurance stats clean.
        if (gameMode === 'classic' && currentTarget && currentAttack && !attackHistory.find(a => a.name === currentTarget.name)) {
            currentAttack.failed = true;
            currentAttack.hackTime = baseTime;
            currentAttack.score = 0;
            currentAttack.accuracy = 0; // Forced 0% for all mission failures
            currentAttack.index = attackHistory.length + 1;
            attackHistory.push(currentAttack);
        }

        // ---- Render End Screen ----
        const titleScoreEl = document.getElementById("title-score");
        const goScoreLabel = document.getElementById("go-score-label");
        const massiveScore = titleScoreEl;

        let isNewRecord = false;

        if (gameMode === 'classic') {
            // Classic: user now wants SCORE as the massive hero metric
            const totalRunMs = Date.now() - (classicRunStartTime || gameStartTime || Date.now());
            const totalSec = Math.floor(totalRunMs / 1000);
            
            massiveScore.className = 'massive-score';
            titleScoreEl.textContent = score.toLocaleString();
            
            if (reason === 'completed') {
                massiveScore.style.color = '';     // clear fail styling
                massiveScore.style.textShadow = '';
                goScoreLabel.textContent = 'FINAL REWARD';

                const prevBest = loadHighScore('classic');
                // Higher is better for Score
                if (prevBest === null || score > prevBest) {
                    saveHighScore('classic', score);
                    isNewRecord = true;
                }
            } else {
                // Timed out before finishing
                massiveScore.style.color = 'var(--danger)';
                massiveScore.style.textShadow = '0 0 25px rgba(239,68,68,0.6)';
                goScoreLabel.textContent = 'SIGNAL LOST';
            }

            // First stat: Time Played
            statTotalTime.closest('.metric-box').querySelector('.metric-label').textContent = 'TIME PLAYED';
            statTotalTime.textContent = formatSeconds(totalSec);
        } else if (gameMode === 'survival') {
            // Survival: time survived is the hero metric
            const totalAlive = gameStartTime ? Math.floor((Date.now() - gameStartTime) / 1000) : 0;
            
            // Top Massive Display: Survival Time (Green)
            massiveScore.className = 'massive-score';
            massiveScore.textContent = formatTime(totalAlive * 1000);
            massiveScore.style.color = 'var(--type-correct)';
            goScoreLabel.textContent = 'TIME SURVIVED';
            
            // Sub-stat Box 1: Reward Score (points)
            statTotalTime.closest('.metric-box').querySelector('.metric-label').textContent = 'REWARD SCORE';
            statTotalTime.textContent = score.toLocaleString();

            const prevBest = loadHighScore('survival');
            if (prevBest === null || totalAlive > prevBest) {
                saveHighScore('survival', totalAlive);
                isNewRecord = true;
            }
        }

        // Accuracy: Factor in ALL city targets attempted
        let totalCharsAttempted = 0;
        let totalErrorsMade = 0;
        
        attackHistory.forEach(a => {
            totalCharsAttempted += a.name.length;
            
            if (a.failed) {
                // If the mission failed on this city, it counts as 0% accuracy
                totalErrorsMade += a.name.length;
            } else {
                totalErrorsMade += a.typos.length;
            }
        });
        
        const accuracyPct = attackHistory.length === 0 ? 0 : Math.max(0, ((totalCharsAttempted - totalErrorsMade) / totalCharsAttempted) * 100);
        statFastestHack.textContent = `${accuracyPct.toFixed(1)}%`;
        const clearedCount = attackHistory.filter(a => !a.failed).length;
        if (gameMode === 'classic') {
            document.getElementById("stat-total-targets").textContent = `${clearedCount} / ${CLASSIC_CITY_COUNT}`;
        } else {
            document.getElementById("stat-total-targets").textContent = clearedCount;
        }

        // New Record Badge
        if (isNewRecord) {
            newRecordBadge.classList.remove('hidden');
            anime({
                targets: newRecordBadge,
                scale: [0.5, 1],
                opacity: [0, 1],
                easing: 'easeOutElastic(1, .5)',
                duration: 800,
                delay: 400
            });
        } else {
            newRecordBadge.classList.add('hidden');
        }

        // Reset sort state and render table fresh
        currentSortCol = null;
        currentSortDir = 1;
        renderHistoryTable();

        gameOverPanel.classList.remove("hidden");
    }

    // ---- History Table Render + Sort ----
    function renderHistoryTable() {
        let data = [...attackHistory];

        if (currentSortCol) {
            data.sort((a, b) => {
                let aVal = a[currentSortCol];
                let bVal = b[currentSortCol];
                // Treat undefined/null as worst case for sorting
                if (aVal === undefined || aVal === null) aVal = currentSortDir === 1 ? Infinity : -Infinity;
                if (bVal === undefined || bVal === null) bVal = currentSortDir === 1 ? Infinity : -Infinity;
                if (typeof aVal === 'string') aVal = aVal.toLowerCase();
                if (typeof bVal === 'string') bVal = bVal.toLowerCase();
                if (aVal < bVal) return -1 * currentSortDir;
                if (aVal > bVal) return 1 * currentSortDir;
                return 0;
            });
        } else {
            // Default: reverse chronological (most recent first)
            data.reverse();
        }

        historyBody.innerHTML = "";
        data.forEach(attack => {
            const hackSec = (attack.hackTime / 1000).toFixed(2);
            const rowStyle = attack.failed ? 'color: var(--danger); opacity: 0.7;' : '';

            // Keystroke ribbon HTML
            let typoHTML = '';
            if (attack.keystrokeLog && attack.keystrokeLog.length === 0) {
                typoHTML = `<span class="ribbon-tag ribbon-wrong" style="font-size: 0.9rem;">[ TIMEOUT ]</span>`;
            } else if (attack.keystrokeLog) {
                typoHTML = attack.keystrokeLog.map(k => {
                    if (k.correct) return `<span class="ribbon-tag ribbon-correct">${k.char === " " ? "&nbsp;" : k.char}</span>`;
                    return `<span class="ribbon-tag ribbon-wrong">${k.char === " " ? "&nbsp;" : k.char}</span>`;
                }).join('');
            }

            const timeVal = attack.failed ? 'TIMEOUT' : `${hackSec}s`;
            const scoreVal = attack.failed
                ? `<span style="color:var(--danger); opacity:0.6">0</span>`
                : `<span style="color:var(--type-correct)">+${attack.score ?? '--'}</span>`;
            
            const accVal = `${(attack.accuracy ?? 0).toFixed(1)}%`;

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td style="${rowStyle}; opacity: 0.5; font-size: 0.75rem;">${attack.index}</td>
                <td style="${rowStyle}">${attack.name}</td>
                <td style="${rowStyle}">${timeVal}</td>
                <td>${scoreVal}</td>
                <td style="${rowStyle}">${accVal}</td>
                <td>${typoHTML}</td>
            `;
            historyBody.appendChild(tr);
        });

        // Update sort indicator arrows on headers
        document.querySelectorAll('.history-table th.sortable').forEach(th => {
            const indicator = th.querySelector('.sort-indicator');
            th.classList.remove('sort-asc', 'sort-desc');
            if (indicator) indicator.textContent = '↕';
            if (th.dataset.col === currentSortCol) {
                const dir = currentSortDir === 1 ? 'sort-asc' : 'sort-desc';
                th.classList.add(dir);
                if (indicator) indicator.textContent = currentSortDir === 1 ? '↑' : '↓';
            }
        });
    }

    // Wire up sortable column headers (static headers in HTML)
    document.querySelectorAll('.history-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (currentSortCol === col) {
                currentSortDir *= -1; // Toggle direction
            } else {
                currentSortCol = col;
                currentSortDir = 1; // New column: default ascending
            }
            renderHistoryTable();
        });
    });

    // ---- Button Listeners ----
    restartBtn.addEventListener("click", () => {
        gameOverPanel.classList.add("hidden");
        
        permanentMarkers.forEach(m => map.removeLayer(m));
        permanentMarkers = [];
        if (targetMarker) {
            map.removeLayer(targetMarker);
            targetMarker = null;
        }
        
        map.flyTo([20.0, 0.0], 2, { animate: true, duration: 2.0 });
        updateBestDisplays();
        startScreen.classList.remove("hidden");
    });

    if (toggleMapBtn) {
        toggleMapBtn.addEventListener("click", () => {
            gameOverPanel.classList.toggle("minimized-panel");
            if (gameOverPanel.classList.contains("minimized-panel")) {
                toggleMapBtn.innerHTML = `SHOW STATS <span style="font-family: monospace;">[ &uarr; ]</span>`;
            } else {
                toggleMapBtn.innerHTML = `VIEW MAP <span style="font-family: monospace;">[ _ ]</span>`;
            }
        });
    }

    if (classicModeBtn) {
        classicModeBtn.addEventListener("click", () => {
            startScreen.classList.add("hidden");
            startGame('classic');
        });
    }

    if (survivalModeBtn) {
        survivalModeBtn.addEventListener("click", () => {
            startScreen.classList.add("hidden");
            startGame('survival');
        });
    }

    document.addEventListener("click", () => {
        if (!isGameOver && !isTransitioning && currentTarget) typingInput.focus();
    });

    // ---- Tab Visibility/Pause Logic ----
    let globalPauseStart = 0;
    document.addEventListener("visibilitychange", () => {
        if (isGameOver) return;

        if (document.hidden) {
            // Store when we paused
            globalPauseStart = Date.now();
            // Stop the countdowns so they don't drift or hit zero while invisible
            stopGlobalCountdown();
        } else {
            if (globalPauseStart > 0) {
                const pauseDuration = Date.now() - globalPauseStart;
                
                // Shift all starting timestamps forward by the pause duration
                if (gameStartTime) gameStartTime += pauseDuration;
                if (classicRunStartTime) classicRunStartTime += pauseDuration;
                if (currentAttack && currentAttack.startTime) {
                    currentAttack.startTime += pauseDuration;
                }

                // Restore Survival mission ticker if active
                if (gameMode === 'survival' && !isTransitioning) {
                    startGlobalCountdown();
                }
                
                globalPauseStart = 0;
            }
        }
    });

    // ---- Initialize: Show Best Scores on Start Screen ----
    updateBestDisplays();
});
