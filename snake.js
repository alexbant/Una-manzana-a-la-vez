(() => {
  "use strict";

  const GRID_SIZE = 24;
  const STORAGE_KEY = "manzanita-snake-best-v1";
  const SPEEDS = { relaxed: 175, classic: 125, fast: 85 };
  const SPEED_HINTS = {
    relaxed: "Una partida a buen ritmo.",
    classic: "El equilibrio perfecto.",
    fast: "¡Para quienes buscan emoción!"
  };
  const canvas = document.querySelector("#game-canvas");
  const context = canvas.getContext("2d");
  const canvasWrap = document.querySelector("#canvas-wrap");
  const overlay = document.querySelector("#game-overlay");
  const overlayEmoji = document.querySelector("#overlay-emoji");
  const overlayTitle = document.querySelector("#overlay-title");
  const overlayCopy = document.querySelector("#overlay-copy");
  const startButton = document.querySelector("#start-button");
  const startButtonIcon = document.querySelector("#start-button-icon");
  const startButtonLabel = document.querySelector("#start-button-label");
  const pauseButton = document.querySelector("#pause-button");
  const statusPill = document.querySelector("#status-pill");
  const statusLabel = document.querySelector("#status-label");
  const speedSelect = document.querySelector("#speed-select");
  const soundButton = document.querySelector("#sound-button");
  const toast = document.querySelector("#toast");

  let snake = [];
  let apple = null;
  let goldenApple = null;
  let direction = { x: 1, y: 0 };
  let queuedDirection = { x: 1, y: 0 };
  let state = "ready";
  let score = 0;
  let bestScore = loadBest();
  let applesEaten = 0;
  let lastTick = 0;
  let animationFrame = 0;
  let goldenTimeout = 0;
  let toastTimeout = 0;
  let touchStart = null;
  let audioContext = null;
  let soundEnabled = true;
  let cellSize = canvas.width / GRID_SIZE;

  function loadBest() {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isSafeInteger(saved) && saved > 0 ? saved : 0;
    } catch (error) {
      console.warn("No se pudo cargar el récord guardado.", error);
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem(STORAGE_KEY, String(bestScore));
    } catch (error) {
      console.warn("No se pudo guardar el récord.", error);
      showToast("No se pudo guardar el récord en este navegador.");
    }
  }

  function updateStats() {
    document.querySelector("#score").textContent = score;
    document.querySelector("#best-score").textContent = bestScore;
    document.querySelector("#level").textContent = Math.floor(applesEaten / 5) + 1;
  }

  function setStatus(nextState) {
    state = nextState;
    statusPill.classList.toggle("is-running", state === "running");
    statusPill.classList.toggle("is-paused", state === "paused");
    statusPill.classList.toggle("is-over", state === "over");
    const labels = { ready: "LISTA PARA JUGAR", running: "¡EN MARCHA!", paused: "EN PAUSA", over: "FIN DE LA PARTIDA" };
    statusLabel.textContent = labels[state];
    pauseButton.disabled = state === "ready" || state === "over";
    pauseButton.setAttribute("aria-label", state === "paused" ? "Reanudar juego" : "Pausar juego");
    pauseButton.innerHTML = state === "paused"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
  }

  function showOverlay(kind) {
    const content = {
      ready: { emoji: "🍏", title: "¿Lista para jugar?", copy: "Recoge las manzanas y procura no chocar.", button: "EMPEZAR", icon: "▶" },
      paused: { emoji: "☁️", title: "Tómate tu tiempo", copy: "La partida está en pausa. Todo sigue aquí.", button: "CONTINUAR", icon: "▶" },
      over: { emoji: "🌷", title: score ? "¡Qué buena partida!" : "¡Casi lo tienes!", copy: `Conseguiste ${score} ${score === 1 ? "manzana" : "manzanas"}. ¿Jugamos otra?`, button: "JUGAR OTRA VEZ", icon: "↻" }
    }[kind];
    overlayEmoji.textContent = content.emoji;
    overlayTitle.textContent = content.title;
    overlayCopy.textContent = content.copy;
    startButtonLabel.textContent = content.button;
    startButtonIcon.textContent = content.icon;
    overlay.classList.remove("is-hidden");
  }

  function hideOverlay() {
    overlay.classList.add("is-hidden");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function playTone(frequency, duration = 0.09, type = "sine") {
    if (!soundEnabled) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.065, audioContext.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      console.warn("No se pudo reproducir el sonido.", error);
      soundEnabled = false;
      soundButton.setAttribute("aria-pressed", "false");
      soundButton.setAttribute("aria-label", "Activar sonido");
    }
  }

  function occupied(x, y) {
    return snake.some((segment) => segment.x === x && segment.y === y) ||
      (goldenApple && goldenApple.x === x && goldenApple.y === y);
  }

  function spawnAtRandomCell() {
    const freeCells = [];
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (!occupied(x, y) && (!apple || apple.x !== x || apple.y !== y)) freeCells.push({ x, y });
      }
    }
    return freeCells.length ? freeCells[Math.floor(Math.random() * freeCells.length)] : null;
  }

  function spawnApple() {
    apple = spawnAtRandomCell();
    if (!apple) endGame(true);
  }

  function maybeSpawnGoldenApple() {
    if (goldenApple || applesEaten === 0 || applesEaten % 5 !== 0) return;
    goldenApple = spawnAtRandomCell();
    if (!goldenApple) return;
    window.clearTimeout(goldenTimeout);
    goldenTimeout = window.setTimeout(() => {
      goldenApple = null;
      if (state !== "ready" && state !== "over") draw();
    }, 6500);
    showToast("¡Apareció una manzana dorada!");
  }

  function resetGame() {
    window.cancelAnimationFrame(animationFrame);
    window.clearTimeout(goldenTimeout);
    goldenApple = null;
    snake = [
      { x: 11, y: 12 },
      { x: 10, y: 12 },
      { x: 9, y: 12 }
    ];
    direction = { x: 1, y: 0 };
    queuedDirection = { x: 1, y: 0 };
    score = 0;
    applesEaten = 0;
    lastTick = 0;
    setStatus("ready");
    spawnApple();
    updateStats();
    showOverlay("ready");
    draw();
  }

  function startGame() {
    if (state === "running") return;
    if (state === "over") resetGame();
    setStatus("running");
    hideOverlay();
    lastTick = 0;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(gameLoop);
  }

  function togglePause() {
    if (state === "running") {
      window.cancelAnimationFrame(animationFrame);
      setStatus("paused");
      showOverlay("paused");
      draw();
    } else if (state === "paused") {
      setStatus("running");
      hideOverlay();
      lastTick = 0;
      animationFrame = window.requestAnimationFrame(gameLoop);
    }
  }

  function endGame(won = false) {
    window.cancelAnimationFrame(animationFrame);
    window.clearTimeout(goldenTimeout);
    goldenApple = null;
    setStatus("over");
    if (score > bestScore) {
      bestScore = score;
      saveBest();
      showToast("¡Nuevo récord personal!");
    }
    updateStats();
    showOverlay("over");
    playTone(won ? 660 : 185, 0.28, "triangle");
    draw();
  }

  function changeDirection(next) {
    if (state === "over" || state === "paused") return;
    if (next.x === -direction.x && next.y === -direction.y) return;
    if (next.x === -queuedDirection.x && next.y === -queuedDirection.y) return;
    queuedDirection = next;
    if (state === "ready") startGame();
  }

  function step() {
    direction = queuedDirection;
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
    const ateApple = apple && head.x === apple.x && head.y === apple.y;
    const ateGolden = goldenApple && head.x === goldenApple.x && head.y === goldenApple.y;
    const willGrow = ateApple || ateGolden;
    const hitsWall = head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE;
    const bodyToCheck = willGrow ? snake : snake.slice(0, -1);
    const hitsBody = bodyToCheck.some((segment) => segment.x === head.x && segment.y === head.y);

    if (hitsWall || hitsBody) {
      endGame();
      return;
    }

    snake.unshift(head);
    if (ateApple) {
      score += 1;
      applesEaten += 1;
      playTone(540, 0.08);
      spawnApple();
      maybeSpawnGoldenApple();
      updateStats();
    } else if (ateGolden) {
      score += 5;
      goldenApple = null;
      window.clearTimeout(goldenTimeout);
      playTone(880, 0.17, "triangle");
      showToast("+5 puntos. ¡Qué suerte!");
      spawnApple();
      updateStats();
    } else {
      snake.pop();
    }
    draw();
  }

  function gameLoop(timestamp) {
    if (state !== "running") return;
    if (!lastTick) lastTick = timestamp;
    const interval = Math.max(48, SPEEDS[speedSelect.value] - Math.floor(applesEaten / 5) * 7);
    if (timestamp - lastTick >= interval) {
      step();
      lastTick = timestamp;
    }
    if (state === "running") animationFrame = window.requestAnimationFrame(gameLoop);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  function drawApple(position, golden, time) {
    if (!position) return;
    const centerX = (position.x + 0.5) * cellSize;
    const centerY = (position.y + 0.52) * cellSize;
    const radius = cellSize * (golden ? 0.35 : 0.32);
    const pulse = golden ? 1 + Math.sin(time / 130) * 0.07 : 1;

    context.save();
    context.translate(centerX, centerY);
    context.scale(pulse, pulse);
    context.shadowColor = golden ? "rgba(221, 178, 80, .45)" : "rgba(213, 139, 122, .28)";
    context.shadowBlur = golden ? 15 : 8;
    context.fillStyle = golden ? "#edc66f" : "#e8a69a";
    context.beginPath();
    context.arc(-radius * 0.32, 0, radius * 0.7, 0, Math.PI * 2);
    context.arc(radius * 0.32, 0, radius * 0.7, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = golden ? "#d7aa4e" : "#d18b81";
    context.beginPath();
    context.ellipse(0, radius * 0.53, radius * 0.57, radius * 0.28, 0, 0, Math.PI);
    context.fill();
    context.strokeStyle = "#8eaa83";
    context.lineWidth = Math.max(2, cellSize * 0.07);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(0, -radius * 0.83);
    context.quadraticCurveTo(radius * 0.04, -radius * 1.35, radius * 0.42, -radius * 1.34);
    context.stroke();
    context.fillStyle = "#a9c99f";
    context.beginPath();
    context.ellipse(radius * 0.47, -radius * 1.12, radius * 0.28, radius * 0.13, -0.45, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function draw(time = 0) {
    const size = canvas.width;
    context.clearRect(0, 0, size, size);
    context.fillStyle = "#edf5ef";
    context.fillRect(0, 0, size, size);

    context.strokeStyle = "rgba(139, 172, 146, .11)";
    context.lineWidth = 1;
    for (let i = 1; i < GRID_SIZE; i += 1) {
      const coordinate = i * cellSize;
      context.beginPath();
      context.moveTo(coordinate, 0);
      context.lineTo(coordinate, size);
      context.moveTo(0, coordinate);
      context.lineTo(size, coordinate);
      context.stroke();
    }

    drawApple(apple, false, time);
    drawApple(goldenApple, true, time);

    snake.forEach((segment, index) => {
      const padding = cellSize * 0.095;
      const x = segment.x * cellSize + padding;
      const y = segment.y * cellSize + padding;
      const segmentSize = cellSize - padding * 2;
      const head = index === 0;
      context.save();
      context.shadowColor = head ? "rgba(87, 141, 109, .18)" : "transparent";
      context.shadowBlur = head ? 8 : 0;
      roundedRect(context, x, y, segmentSize, segmentSize, cellSize * (head ? 0.31 : 0.27));
      context.fillStyle = head ? "#78ad8b" : `hsl(${142 + Math.min(index * 1.1, 14)}, 34%, ${68 - Math.min(index * 0.12, 5)}%)`;
      context.fill();
      context.shadowBlur = 0;
      if (head) drawFace(segment.x, segment.y);
      context.restore();
    });
  }

  function drawFace(x, y) {
    const centerX = (x + 0.5) * cellSize;
    const centerY = (y + 0.5) * cellSize;
    const eyeOffset = cellSize * 0.14;
    const eyeRadius = Math.max(1.8, cellSize * 0.055);
    let eyes;
    if (direction.x === 1) eyes = [[centerX + eyeOffset, centerY - eyeOffset], [centerX + eyeOffset, centerY + eyeOffset]];
    else if (direction.x === -1) eyes = [[centerX - eyeOffset, centerY - eyeOffset], [centerX - eyeOffset, centerY + eyeOffset]];
    else if (direction.y === 1) eyes = [[centerX - eyeOffset, centerY + eyeOffset], [centerX + eyeOffset, centerY + eyeOffset]];
    else eyes = [[centerX - eyeOffset, centerY - eyeOffset], [centerX + eyeOffset, centerY - eyeOffset]];
    context.fillStyle = "#fffdf6";
    eyes.forEach(([eyeX, eyeY]) => {
      context.beginPath();
      context.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2);
      context.fill();
    });
  }

  function resizeCanvas() {
    const bounds = canvasWrap.getBoundingClientRect();
    if (!bounds.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingSize = Math.round(bounds.width * dpr);
    canvas.width = backingSize;
    canvas.height = backingSize;
    cellSize = backingSize / GRID_SIZE;
    draw();
  }

  function applyDirectionName(name) {
    const directions = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 }
    };
    if (directions[name]) changeDirection(directions[name]);
  }

  startButton.addEventListener("click", startGame);
  pauseButton.addEventListener("click", togglePause);
  document.querySelector("#restart-button").addEventListener("click", () => {
    resetGame();
    startGame();
    showToast("¡Nueva partida! Buena suerte.");
  });
  speedSelect.addEventListener("change", () => {
    document.querySelector("#speed-hint").textContent = SPEED_HINTS[speedSelect.value];
    showToast(`Velocidad: ${speedSelect.options[speedSelect.selectedIndex].text}`);
  });
  soundButton.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundButton.setAttribute("aria-pressed", String(soundEnabled));
    soundButton.setAttribute("aria-label", soundEnabled ? "Desactivar sonido" : "Activar sonido");
    if (soundEnabled) playTone(600, 0.08);
  });
  document.querySelectorAll(".touch-controls button").forEach((button) => {
    button.addEventListener("click", () => applyDirectionName(button.dataset.direction));
  });
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const keyDirections = {
      ArrowUp: "up", w: "up",
      ArrowDown: "down", s: "down",
      ArrowLeft: "left", a: "left",
      ArrowRight: "right", d: "right"
    };
    const directionName = keyDirections[event.key] || keyDirections[event.key.toLowerCase()];
    if (directionName) {
      event.preventDefault();
      applyDirectionName(directionName);
    } else if (event.code === "Space") {
      event.preventDefault();
      if (state === "ready" || state === "over") startGame();
      else togglePause();
    } else if (event.key.toLowerCase() === "p") {
      togglePause();
    }
  });
  canvas.addEventListener("touchstart", (event) => {
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
    if (Math.abs(dx) > Math.abs(dy)) applyDirectionName(dx > 0 ? "right" : "left");
    else applyDirectionName(dy > 0 ? "down" : "up");
  }, { passive: true });

  document.querySelector("#speed-hint").textContent = SPEED_HINTS[speedSelect.value];
  updateStats();
  setStatus("ready");
  resetGame();
  if ("ResizeObserver" in window) {
    new ResizeObserver(resizeCanvas).observe(canvasWrap);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }
  resizeCanvas();
})();