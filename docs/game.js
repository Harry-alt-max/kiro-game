'use strict';

// --- Constants ---------------------------------------------------------------
const constants = {
  CANVAS_WIDTH: 480,
  CANVAS_HEIGHT: 640,
  LANE_WIDTH: 160,
  laneCenter(lane) {
    return lane * 160 + 80;
  },
  BASE_SPEED: 200,
  SCORE_SPEED_INCREMENT: 20,   // speed added per level-up
  SCORE_PER_LEVEL: 100,        // score needed per level
  MAX_SPEED: 800,              // raised ceiling for score-based scaling
  SPAWN_INTERVAL_INIT: 1800,
  SPAWN_INTERVAL_MIN: 500,
  COIN_SPAWN_INTERVAL_INIT: 1200,
  PLAYER_WIDTH: 60,
  PLAYER_HEIGHT: 80,
  OBSTACLE_WIDTH: 70,
  OBSTACLE_HEIGHT: 60,
  COIN_RADIUS: 18,
  HITBOX_INSET: 8,
  BEST_SCORE_KEY: 'runnerBestScore',
};

// --- Best Score (localStorage) -----------------------------------------------
const bestScore = {
  get() {
    const val = parseInt(localStorage.getItem(constants.BEST_SCORE_KEY), 10);
    return isNaN(val) ? 0 : val;
  },
  update(score) {
    const current = this.get();
    if (score > current) {
      localStorage.setItem(constants.BEST_SCORE_KEY, String(score));
      return true;
    }
    return false;
  },
};

// --- Level helpers -----------------------------------------------------------
function levelFromScore(score) {
  return Math.floor(score / constants.SCORE_PER_LEVEL) + 1;
}

function speedFromScore(score) {
  const level = levelFromScore(score);
  return Math.min(
    constants.MAX_SPEED,
    constants.BASE_SPEED + (level - 1) * constants.SCORE_SPEED_INCREMENT
  );
}

function spawnIntervalFromScore(score) {
  const level = levelFromScore(score);
  return Math.max(
    constants.SPAWN_INTERVAL_MIN,
    constants.SPAWN_INTERVAL_INIT - (level - 1) * 100
  );
}

// --- State -------------------------------------------------------------------
let state = {};

function resetState() {
  state = {
    phase: 'idle',
    speed: constants.BASE_SPEED,
    time: 0,
    score: 0,
    lastLevel: 1,              // track level-ups for flash notice
    levelUpFlash: 0,           // countdown ms for level-up flash
    obstacles: [],
    coins: [],
    spawnTimer: 0,
    coinTimer: 0,
    player: {
      lane: 1,
      x: constants.laneCenter(1),
      y: 480,
      width: constants.PLAYER_WIDTH,
      height: constants.PLAYER_HEIGHT,
      moving: false,
      targetX: constants.laneCenter(1),
      moveSpeed: 600,
    },
  };
}

resetState();

// --- Canvas Setup ------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;

if (!ctx) {
  const msg = document.createElement('p');
  msg.textContent = '您的瀏覽器不支援此遊戲';
  msg.style.cssText = 'color:#fff;text-align:center;padding:20px;font-size:18px;';
  const container = document.getElementById('game-container');
  if (container) {
    container.innerHTML = '';
    container.appendChild(msg);
  } else {
    document.body.innerHTML = '';
    document.body.appendChild(msg);
  }
  throw new Error('Canvas 2D context not available');
}

// --- Collision Utilities -----------------------------------------------------
function rectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right ||
           a.bottom < b.top || a.top > b.bottom);
}

function getHitbox(obj, inset) {
  const w = obj.width !== undefined ? obj.width : obj.radius * 2;
  const h = obj.height !== undefined ? obj.height : obj.radius * 2;
  return {
    left:   obj.x - w / 2 + inset,
    right:  obj.x + w / 2 - inset,
    top:    obj.y - h / 2 + inset,
    bottom: obj.y + h / 2 - inset,
  };
}

// --- Player ------------------------------------------------------------------
const Player = {
  handleInput(key) {
    if (key === 'ArrowLeft' || key === 'left') {
      state.player.lane = Math.max(0, state.player.lane - 1);
    } else if (key === 'ArrowRight' || key === 'right') {
      state.player.lane = Math.min(2, state.player.lane + 1);
    } else {
      return;
    }
    state.player.targetX = constants.laneCenter(state.player.lane);
    state.player.moving = true;
  },

  update(dt) {
    const p = state.player;
    const diff = p.targetX - p.x;
    if (Math.abs(diff) < 1) {
      p.x = p.targetX;
      p.moving = false;
    } else {
      const step = p.moveSpeed * dt / 1000;
      p.x += diff > 0 ? Math.min(step, diff) : Math.max(-step, diff);
    }
  },
};

// --- Spawn Manager -----------------------------------------------------------
const spawnManager = {
  spawnObstacles() {
    const lanes = [0, 1, 2];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    const count = Math.random() < 0.6 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      state.obstacles.push({
        lane: lanes[i],
        x: constants.laneCenter(lanes[i]),
        y: -constants.OBSTACLE_HEIGHT / 2,
        width: constants.OBSTACLE_WIDTH,
        height: constants.OBSTACLE_HEIGHT,
      });
    }
  },

  update(dt) {
    const spawnInterval = spawnIntervalFromScore(state.score);

    state.spawnTimer += dt;
    if (state.spawnTimer >= spawnInterval) {
      this.spawnObstacles();
      state.spawnTimer = 0;
    }

    state.coinTimer += dt;
    if (state.coinTimer >= constants.COIN_SPAWN_INTERVAL_INIT) {
      const lane = Math.floor(Math.random() * 3);
      state.coins.push({
        lane,
        x: constants.laneCenter(lane),
        y: -constants.COIN_RADIUS,
        radius: constants.COIN_RADIUS,
        collected: false,
      });
      state.coinTimer = 0;
    }
  },
};

// --- Collision ---------------------------------------------------------------
const collision = {
  check() {
    const playerHitbox = getHitbox(state.player, constants.HITBOX_INSET);

    for (const obs of state.obstacles) {
      const obsHitbox = getHitbox(obs, constants.HITBOX_INSET);
      if (rectsOverlap(playerHitbox, obsHitbox)) {
        state.phase = 'gameover';
        ui.show('gameover');
        return;
      }
    }

    for (const coin of state.coins) {
      if (coin.collected) continue;
      const coinObj = {
        x: coin.x,
        y: coin.y,
        width: coin.radius * 2,
        height: coin.radius * 2,
      };
      const coinHitbox = getHitbox(coinObj, 0);
      if (rectsOverlap(playerHitbox, coinHitbox)) {
        coin.collected = true;
        state.score += 10;
        ui.updateScore();
      }
    }
  },
};

// --- Renderer ----------------------------------------------------------------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const renderer = {
  draw() {
    const W = constants.CANVAS_WIDTH;
    const H = constants.CANVAS_HEIGHT;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#2a2a3e';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(i * 160, 0, 160, H);
    }

    ctx.strokeStyle = '#444';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 160, 0);
      ctx.lineTo(i * 160, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const coin of state.coins) {
      if (coin.collected) continue;
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(coin.x, coin.y, coin.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const obs of state.obstacles) {
      ctx.fillStyle = '#e74c3c';
      roundRect(
        obs.x - obs.width / 2,
        obs.y - obs.height / 2,
        obs.width,
        obs.height,
        6
      );
      ctx.fill();
    }

    const p = state.player;
    ctx.fillStyle = '#4a90d9';
    roundRect(
      p.x - p.width / 2,
      p.y - p.height / 2,
      p.width,
      p.height,
      8
    );
    ctx.fill();

    // Level-up flash overlay
    if (state.levelUpFlash > 0) {
      const alpha = state.levelUpFlash / 1200;
      ctx.save();
      ctx.globalAlpha = alpha * 0.35;
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha * 1.5);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LEVEL ' + levelFromScore(state.score) + '  ▲ 加速！', W / 2, H / 2);
      ctx.restore();
    }
  },
};

// --- UI ----------------------------------------------------------------------
const ui = {
  show(phase) {
    const startScreen    = document.getElementById('start-screen');
    const gameoverScreen = document.getElementById('gameover-screen');
    const hud            = document.getElementById('hud');
    const touchControls  = document.getElementById('touch-controls');

    startScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    if (hud) hud.style.display = 'none';
    if (touchControls) touchControls.classList.add('hidden');

    if (phase === 'idle') {
      startScreen.classList.remove('hidden');
      const startBest = document.getElementById('start-best');
      if (startBest) startBest.textContent = '歷史最高分：' + bestScore.get();
    } else if (phase === 'playing') {
      if (hud) hud.style.display = '';
      if (touchControls) touchControls.classList.remove('hidden');
      this.updateScore();
    } else if (phase === 'gameover') {
      const isNewBest = bestScore.update(state.score);

      const finalScore   = document.getElementById('final-score');
      const newBestLabel = document.getElementById('new-best');
      const gameoverBest = document.getElementById('gameover-best');
      const gameoverLevel = document.getElementById('gameover-level');

      if (finalScore)    finalScore.textContent    = '最終分數：' + state.score;
      if (gameoverBest)  gameoverBest.textContent  = '歷史最高分：' + bestScore.get();
      if (gameoverLevel) gameoverLevel.textContent = '到達等級：Lv.' + levelFromScore(state.score);

      if (newBestLabel) {
        if (isNewBest) {
          newBestLabel.classList.remove('hidden');
        } else {
          newBestLabel.classList.add('hidden');
        }
      }

      gameoverScreen.classList.remove('hidden');
    }
  },

  updateScore() {
    const scoreDisplay = document.getElementById('score-display');
    if (scoreDisplay) scoreDisplay.textContent = '分數：' + state.score;
    const bestDisplay = document.getElementById('best-display');
    if (bestDisplay) bestDisplay.textContent = '最高：' + bestScore.get();
    const levelDisplay = document.getElementById('level-display');
    if (levelDisplay) levelDisplay.textContent = 'Lv.' + levelFromScore(state.score);
  },
};

// --- Main Update -------------------------------------------------------------
function update(dt) {
  state.time += dt / 1000;

  // Score-based speed
  state.speed = speedFromScore(state.score);

  // Detect level-up
  const currentLevel = levelFromScore(state.score);
  if (currentLevel > state.lastLevel) {
    state.lastLevel = currentLevel;
    state.levelUpFlash = 1200; // flash for 1.2s
  }
  if (state.levelUpFlash > 0) {
    state.levelUpFlash = Math.max(0, state.levelUpFlash - dt);
  }

  Player.update(dt);

  const moveAmount = state.speed * dt / 1000;
  for (const obs of state.obstacles) {
    obs.y += moveAmount;
  }
  state.obstacles = state.obstacles.filter(obs => obs.y < constants.CANVAS_HEIGHT + obs.height);

  for (const coin of state.coins) {
    coin.y += moveAmount;
  }
  state.coins = state.coins.filter(
    coin => !coin.collected && coin.y < constants.CANVAS_HEIGHT + coin.radius
  );

  spawnManager.update(dt);
  collision.check();
}

// --- Game Loop ---------------------------------------------------------------
let lastTimestamp = null;

function loop(timestamp) {
  if (lastTimestamp === null) lastTimestamp = timestamp;
  let dt = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  if (dt > 50) dt = 50;

  if (state.phase === 'playing') {
    update(dt);
  }

  renderer.draw();
  requestAnimationFrame(loop);
}

// --- Keyboard Input ----------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (state.phase === 'playing') {
    Player.handleInput(e.key);
  }
});

// --- Touch Swipe Input -------------------------------------------------------
let touchStartX = null;
const SWIPE_THRESHOLD = 30;

canvas.addEventListener('touchstart', (e) => {
  if (state.phase !== 'playing') return;
  touchStartX = e.changedTouches[0].clientX;
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (state.phase !== 'playing' || touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) >= SWIPE_THRESHOLD) {
    Player.handleInput(dx < 0 ? 'left' : 'right');
  }
  touchStartX = null;
}, { passive: true });

// --- Touch Button Input ------------------------------------------------------
const btnLeft  = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');

if (btnLeft) {
  btnLeft.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.phase === 'playing') Player.handleInput('left');
  }, { passive: false });
  btnLeft.addEventListener('click', () => {
    if (state.phase === 'playing') Player.handleInput('left');
  });
}

if (btnRight) {
  btnRight.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.phase === 'playing') Player.handleInput('right');
  }, { passive: false });
  btnRight.addEventListener('click', () => {
    if (state.phase === 'playing') Player.handleInput('right');
  });
}

// --- Button Events -----------------------------------------------------------
document.getElementById('start-btn').addEventListener('click', () => {
  resetState();
  state.phase = 'playing';
  ui.show('playing');
});

document.getElementById('restart-btn').addEventListener('click', () => {
  resetState();
  state.phase = 'playing';
  ui.show('playing');
});

// --- Init --------------------------------------------------------------------
ui.show('idle');
requestAnimationFrame(loop);
