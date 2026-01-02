(() => {
  "use strict";

  // Movement slide cooldown (ms)
  const MOVE_COOLDOWN_MS = 140;

  // Grid + world settings
  const TILE_SIZE = 72;              // doubled tile size (larger squares)
  const TILE_INSET = 0.01;           // 1% padding per side inside each tile (very tight)
  const ENTITY_SIZE = TILE_SIZE * (1 - TILE_INSET * 2);
  const GRID_WIDTH = 6;
  const GRID_HEIGHT = 5;

  // Enemies
  const ENEMY_SPAWN_MS = 550;
  const MAX_ENEMIES = 10;

  // Reward flash settings
  const FLASH_POINTS_REQUIRED = 5;
  const FLASH_WINDOW_MS = 3600000;   // 1 hour window
  const FLASH_DURATION_MS = 150;
  const FLASH_SCALE = 0.55;

  // Asset lists (must exist in /images)
  const PLAYER_TEXTURE_KEY = "player";
  const FLASH_IMAGES = ["flash1.png", "flash2.png", "flash3.png"];

  const inputState = { moveQueue: [], attackQueue: [] };

  // ===== Slide / Gesture Controls (thumb-drag) =====
  function directionFromDelta(dx, dy, deadZone = 12) {
    const mag = Math.hypot(dx, dy);
    if (mag < deadZone) return null;

    const angle = Math.atan2(dy, dx); // screen-space: +y down
    const oct = Math.round((8 * angle) / (2 * Math.PI) + 8) % 8;

    const dirs = [
      [1, 0],   // E
      [1, 1],   // SE
      [0, 1],   // S
      [-1, 1],  // SW
      [-1, 0],  // W
      [-1, -1], // NW
      [0, -1],  // N
      [1, -1],  // NE
    ];
    return dirs[oct];
  }

  function bindSlidePad(padEl, queue, opts = {}) {
    const deadZone = Number.isFinite(opts.deadZone) ? opts.deadZone : 12;
    const cooldownMs = Number.isFinite(opts.cooldownMs) ? opts.cooldownMs : 0;

    let active = false;
    let lastDir = null;
    let rect = null;
    let lastEmitAt = 0;
    let pointerId = null;

    const computeAndMaybeEmit = (clientX, clientY, force = false) => {
      if (!rect) return;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const dx = clientX - cx;
      const dy = clientY - cy;

      const dir = directionFromDelta(dx, dy, deadZone);
      if (!dir) return;

      const [x, y] = dir;
      const key = `${x},${y}`;

      const now = performance.now();
      const cooldownOk = force || cooldownMs <= 0 || (now - lastEmitAt) >= cooldownMs;

      if (key !== lastDir && cooldownOk) {
        queue.push({ dx: x, dy: y });
        lastDir = key;
        lastEmitAt = now;
      }
    };

    const onDown = (e) => {
      e.preventDefault();
      rect = padEl.getBoundingClientRect();
      active = true;
      lastDir = null;
      lastEmitAt = 0;
      pointerId = e.pointerId;

      try { padEl.setPointerCapture(pointerId); } catch (_) {}

      computeAndMaybeEmit(e.clientX, e.clientY, true);
    };

    const onMove = (e) => {
      if (!active) return;
      e.preventDefault();
      if (pointerId !== null && e.pointerId !== pointerId) return;
      computeAndMaybeEmit(e.clientX, e.clientY, false);
    };

    const stop = () => {
      active = false;
      lastDir = null;
      rect = null;
      try {
        if (pointerId !== null) padEl.releasePointerCapture(pointerId);
      } catch (_) {}
      pointerId = null;
    };

    padEl.addEventListener("pointerdown", onDown, { passive: false, capture: true });
    padEl.addEventListener("pointermove", onMove, { passive: false, capture: true });

    padEl.addEventListener("pointerup", stop, { passive: true, capture: true });
    padEl.addEventListener("pointercancel", stop, { passive: true, capture: true });
    padEl.addEventListener("lostpointercapture", stop, { passive: true, capture: true });
  }
  // ================================================

  // Prevent browser scroll/zoom gestures interfering with controls
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  // Bind slide controls to pads (movement + attack)
  const movePad = document.getElementById("movePad");
  const attackPad = document.getElementById("attackPad");

  if (movePad) bindSlidePad(movePad, inputState.moveQueue, { cooldownMs: MOVE_COOLDOWN_MS });
  if (attackPad) bindSlidePad(attackPad, inputState.attackQueue);

  // Restart buttons (top-right hidden by CSS; overlay used on death)
  const restartBtn = document.getElementById("restart");
  if (restartBtn) {
    restartBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      window.location.reload();
    }, { passive: false });
  }

  const restartOverlayBtn = document.getElementById("restartOverlay");
  if (restartOverlayBtn) {
    restartOverlayBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      window.location.reload();
    }, { passive: false });
  }

  const statusEl = document.getElementById("status");
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const cellKey = (x, y) => `${x},${y}`;
  const isAdjacent = (dx, dy) => (dx !== 0 || dy !== 0) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1;

  const keyForImagePath = (path) => {
    const base = path.split("/").pop().split(".")[0];
    return `flash_${base}`;
  };

  class MainScene extends Phaser.Scene {
    constructor() {
      super("main");

      this.player = null;
      this.playerSprite = null;
      this.playerCell = { x: 0, y: 0 };

      this.enemies = new Map();

      this.points = 0;
      this.startTime = 0;
      this.dead = false;

      this.pointTimes = []; // timestamps used for reward flash window

      this.attackFlash = null;
      this.centerFlash = null;

      this.flashKeys = [];

      this.highPoints = 0;
    }

    preload() {
      // GitHub Pages safe path
      this.load.setPath("./images/");

      // Core sprites
      this.load.image(PLAYER_TEXTURE_KEY, "flash2.png");
      this.load.image("enemy_fly", "fly.png");

      // Lilies
      this.load.image("lily1", "lily1.png");
      this.load.image("lily2", "lily2.png");
      this.load.image("lily3", "lily3.png");

      // Surface asset load failures
      this.load.on("loaderror", (file) => {
        const el = document.getElementById("status");
        if (el) {
          el.style.display = "block";
          el.textContent = "ASSET LOAD ERROR: " + file.key + " (" + (file.src || file.url || "") + ")";
        }
      });

      // Flash images
      this.flashKeys = [];
      for (const p of FLASH_IMAGES) {
        const k = keyForImagePath(p);
        this.flashKeys.push(k);
        this.load.image(k, p);
      }
    }

    create() {
      // Layers
      this.bgLayer = this.add.layer().setDepth(0);
      this.decorLayer = this.add.layer().setDepth(5);
      this.entityLayer = this.add.layer().setDepth(25);
      this.fxLayer = this.add.layer().setDepth(50);

      this.children.sort("depth");
      this.children.bringToTop(this.entityLayer);
      this.children.bringToTop(this.fxLayer);

      // Resize + fit
      this.scale.resize(window.innerWidth, window.innerHeight);
      this.scale.on("resize", (gameSize) => {
        this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
        this.fitWorldToScreen(gameSize.width, gameSize.height);
      });

      this.fitWorldToScreen(window.innerWidth, window.innerHeight);

      // Decor
      this.buildDecor();

      // Start position
      this.playerCell = { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) };

      const px = this.cellToWorldX(this.playerCell.x);
      const py = this.cellToWorldY(this.playerCell.y);

      // Player container + sprite
      this.player = this.add.container(px, py);
      this.playerSprite = this.add.image(0, 0, PLAYER_TEXTURE_KEY);
      this.player.add(this.playerSprite);
      this.updatePlayerSpriteTexture(PLAYER_TEXTURE_KEY);

      // Attack flash line
      this.attackFlash = this.add.graphics();
      this.fxLayer.add(this.attackFlash);
      this.attackFlash.setDepth(1000);

      // Center flash (hidden)
      const firstKey = this.flashKeys[0] || PLAYER_TEXTURE_KEY;
      this.centerFlash = this.add.image(this.player.x, this.player.y, firstKey);
      this.centerFlash.setVisible(false);
      this.centerFlash.setDepth(9999);
      this.centerFlash.setScrollFactor(1);
      this.centerFlash.setOrigin(0.5, 0.5);

      // State init
      this.points = 0;
      this.startTime = performance.now();
      this.dead = false;
      this.pointTimes = [];

      this.loadHighScore();
      this.updateHighScoreUI();
      this.hideGameOverOverlay();

      setStatus(this.statusLine());

      // Spawner
      this.time.addEvent({
        delay: ENEMY_SPAWN_MS,
        loop: true,
        callback: () => { if (!this.dead) this.spawnEnemyEdge(); }
      });
    }

    // --- UI / scoring ---

    statusLine(extra = "") {
      const t = ((performance.now() - this.startTime) / 1000).toFixed(1);

      const line1 = `Points: ${this.points}`;
      const line2 = `Time: ${t}s`;
      const line3 = extra ? `${extra}` : "";

      return `${line1}\n${line2}\n${line3}`;
    }

    loadHighScore() {
      const hp = parseInt(localStorage.getItem("nf_highPoints") || "0", 10);
      this.highPoints = Number.isFinite(hp) ? hp : 0;
    }

    saveHighScore(points) {
      this.highPoints = points;
      try { localStorage.setItem("nf_highPoints", String(points)); } catch (_) {}
      this.updateHighScoreUI();
    }

    isNewHighScore(points) {
      return points > this.highPoints;
    }

    updateHighScoreUI() {
      const el = document.getElementById("highScore");
      if (!el) return;
      el.style.display = "block";
      el.textContent = `High: ${this.highPoints}`;
    }

    showGameOverOverlay(points, isNewHigh) {
      const wrap = document.getElementById("gameOver");
      const textEl = document.getElementById("gameOverText");
      if (!wrap || !textEl) return;

      const badge = isNewHigh ? "\nNEW HIGH SCORE" : "";
      wrap.style.display = "block";
      textEl.textContent = `Game Over\nPoints: ${points}${badge}`;

      const overlayRestart = document.getElementById("restartOverlay");
      if (overlayRestart) overlayRestart.style.display = "inline-flex";
    }

    hideGameOverOverlay() {
      const wrap = document.getElementById("gameOver");
      const textEl = document.getElementById("gameOverText");
      if (wrap) wrap.style.display = "none";
      if (textEl) textEl.textContent = "";
      const overlayRestart = document.getElementById("restartOverlay");
      if (overlayRestart) overlayRestart.style.display = "none";
    }

    // --- World helpers ---

    fitWorldToScreen(w, h) {
      const s = Math.min(w / (GRID_WIDTH * TILE_SIZE), h / (GRID_HEIGHT * TILE_SIZE));
      const cam = this.cameras.main;
      cam.setZoom(s);
      cam.centerOn((GRID_WIDTH * TILE_SIZE) / 2, (GRID_HEIGHT * TILE_SIZE) / 2);
    }

    cellToWorldX(cx) { return cx * TILE_SIZE + TILE_SIZE / 2; }
    cellToWorldY(cy) { return cy * TILE_SIZE + TILE_SIZE / 2; }

    // --- Decor ---

    buildDecor() {
      if (this.decorLayer) this.decorLayer.removeAll(true);

      const lilyKeys = ["lily1", "lily2", "lily3"];
      const target = TILE_SIZE * 0.95;

      for (let yy = 1; yy < GRID_HEIGHT - 1; yy++) {
        for (let xx = 1; xx < GRID_WIDTH - 1; xx++) {
          const key = lilyKeys[Math.floor(Math.random() * lilyKeys.length)];
          const lx = this.cellToWorldX(xx);
          const ly = this.cellToWorldY(yy);

          const pad = this.add.container(lx, ly);
          const sprite = this.add.image(0, 0, key);
          pad.add(sprite);

          // Cover+crop to fill tile
          if (this.textures.exists(key)) {
            if (sprite.setCrop) sprite.setCrop();

            const tex = this.textures.get(key);
            const srcImg = (tex && tex.getSourceImage) ? tex.getSourceImage() : null;
            const texW = (srcImg && srcImg.width) ? srcImg.width : (sprite.width || 1);
            const texH = (srcImg && srcImg.height) ? srcImg.height : (sprite.height || 1);

            const sCover = Math.max(target / texW, target / texH);
            sprite.setScale(sCover);

            const cropW = target / sCover;
            const cropH = target / sCover;
            const cx = (texW - cropW) / 2;
            const cy = (texH - cropH) / 2;
            if (sprite.setCrop) sprite.setCrop(cx, cy, cropW, cropH);
          }

          sprite.setAlpha(0.95);
          pad.setRotation((Math.random() - 0.5) * 0.12);
          if (Math.random() < 0.25) sprite.setFlipX(true);

          pad.setDepth(0);
          this.decorLayer.add(pad);
        }
      }
    }

    // --- Spawning / death ---

    spawnEnemyEdge() {
      if (this.enemies.size >= MAX_ENEMIES) return;

      for (let tries = 0; tries < 70; tries++) {
        const side = Phaser.Math.Between(0, 3);
        let x, y;

        if (side === 0) { x = Phaser.Math.Between(0, GRID_WIDTH - 1); y = 0; }
        else if (side === 1) { x = GRID_WIDTH - 1; y = Phaser.Math.Between(0, GRID_HEIGHT - 1); }
        else if (side === 2) { x = Phaser.Math.Between(0, GRID_WIDTH - 1); y = GRID_HEIGHT - 1; }
        else { x = 0; y = Phaser.Math.Between(0, GRID_HEIGHT - 1); }

        if (x === this.playerCell.x && y === this.playerCell.y) continue;

        const k = cellKey(x, y);
        if (this.enemies.has(k)) continue;

        const ex = this.cellToWorldX(x);
        const ey = this.cellToWorldY(y);

        const enemy = this.add.container(ex, ey);
        const enemySprite = this.add.image(0, 0, "enemy_fly");

        // Cover+crop inside tile
        if (this.textures.exists("enemy_fly")) {
          if (enemySprite.setCrop) enemySprite.setCrop();

          const tex = this.textures.get("enemy_fly");
          const srcImg = (tex && tex.getSourceImage) ? tex.getSourceImage() : null;
          const texW = (srcImg && srcImg.width) ? srcImg.width : (enemySprite.width || 1);
          const texH = (srcImg && srcImg.height) ? srcImg.height : (enemySprite.height || 1);

          const targetW = ENTITY_SIZE;
          const targetH = ENTITY_SIZE;

          const sCover = Math.max(targetW / texW, targetH / texH);
          enemySprite.setScale(sCover);

          const cropW = targetW / sCover;
          const cropH = targetH / sCover;
          const cropX = (texW - cropW) / 2;
          const cropY = (texH - cropH) / 2;

          if (enemySprite.setCrop) enemySprite.setCrop(cropX, cropY, cropW, cropH);
        }

        enemy.add(enemySprite);

        this.enemies.set(k, enemy);
        setStatus(this.statusLine());
        return;
      }
    }

    die(reason) {
      this.dead = true;

      const isNewHigh = this.isNewHighScore(this.points);
      if (isNewHigh) this.saveHighScore(this.points);

      setStatus(this.statusLine(`DEAD: ${reason}. Tap Restart.`));
      this.showGameOverOverlay(this.points, isNewHigh);

      if (this.playerSprite && this.playerSprite.setTint) this.playerSprite.setTint(0x3b4b5c);
      if (this.playerSprite && this.playerSprite.setAlpha) this.playerSprite.setAlpha(0.85);
    }

    // --- Movement / attack ---

    tryMove(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      const nx = clamp(this.playerCell.x + dx, 0, GRID_WIDTH - 1);
      const ny = clamp(this.playerCell.y + dy, 0, GRID_HEIGHT - 1);
      if (nx === this.playerCell.x && ny === this.playerCell.y) return;

      const k = cellKey(nx, ny);
      if (this.enemies.has(k)) {
        this.playerCell = { x: nx, y: ny };
        this.player.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
        this.die("stepped onto enemy");
        return;
      }

      this.playerCell = { x: nx, y: ny };
      this.player.setPosition(this.cellToWorldX(nx), this.cellToWorldY(ny));
      setStatus(this.statusLine());
    }

    triggerInhale() {
      if (!this.player) return;

      if (!this._inhaleState) this._inhaleState = { s: 1 };

      if (this._inhaleTween) {
        try { this._inhaleTween.stop(); } catch (_) {}
        try { this._inhaleTween.remove(); } catch (_) {}
        this._inhaleTween = null;
      }

      this._inhaleState.s = 1;
      this.player.setScale(1);

      this.children.bringToTop(this.player);

      const scene = this;
      this._inhaleTween = this.tweens.add({
        targets: this._inhaleState,
        s: 1.12,
        duration: 90,
        ease: "Quad.out",
        yoyo: true,
        hold: 10,
        onUpdate() {
          if (scene.player) scene.player.setScale(scene._inhaleState.s);
        },
        onComplete() {
          scene._inhaleState.s = 1;
          if (scene.player) scene.player.setScale(1);
          scene._inhaleTween = null;
        }
      });
    }

    animateEnemyDeath(enemy) {
      if (!enemy || !enemy.scene) return;
      if (enemy._dying) return;
      enemy._dying = true;

      const px = this.player ? this.player.x : enemy.x;
      const py = this.player ? this.player.y : enemy.y;

      enemy.setDepth(50);

      const scene = this;
      scene.tweens.add({
        targets: enemy,
        scale: 1.15,
        duration: 70,
        ease: "Quad.out",
        onComplete() {
          scene.tweens.add({
            targets: enemy,
            x: px,
            y: py,
            scale: 0,
            alpha: 0,
            duration: 160,
            ease: "Quad.in",
            onComplete() { enemy.destroy(); }
          });
        }
      });

      scene.triggerInhale();
    }

    playAttackFlash(dx, dy) {
      const x0 = this.cellToWorldX(this.playerCell.x);
      const y0 = this.cellToWorldY(this.playerCell.y);
      const x1 = x0 + dx * TILE_SIZE * 0.95;
      const y1 = y0 + dy * TILE_SIZE * 0.95;

      this.attackFlash.clear();
      this.attackFlash.alpha = 1;
      this.attackFlash.lineStyle(6, 0xf7f2a0, 1);
      this.attackFlash.lineBetween(x0, y0, x1, y1);

      this.tweens.add({
        targets: this.attackFlash,
        alpha: 0,
        duration: 55,
        onComplete: () => {
          this.attackFlash.clear();
          this.attackFlash.alpha = 1;
        }
      });
    }

    updatePlayerSpriteTexture(key) {
      if (!this.playerSprite || !key) return;
      if (!this.textures.exists(key)) return;

      if (this.playerSprite.setCrop) this.playerSprite.setCrop();

      const tex = this.textures.get(key);
      const src = (tex && tex.getSourceImage) ? tex.getSourceImage() : null;
      const texW = (src && src.width) ? src.width : (this.playerSprite.width || 1);
      const texH = (src && src.height) ? src.height : (this.playerSprite.height || 1);

      this.playerSprite.setTexture(key);

      const targetW = ENTITY_SIZE;
      const targetH = ENTITY_SIZE;

      const sCover = Math.max(targetW / texW, targetH / texH);
      this.playerSprite.setScale(sCover);

      const cropW = targetW / sCover;
      const cropH = targetH / sCover;
      const cropX = (texW - cropW) / 2;
      const cropY = (texH - cropH) / 2;

      if (this.playerSprite.setCrop) this.playerSprite.setCrop(cropX, cropY, cropW, cropH);
    }

    flashRandomImage() {
      if (!this.flashKeys.length || !this.centerFlash) return;

      const key = Phaser.Utils.Array.GetRandom(this.flashKeys);

      // Adopt new texture for the player
      this.updatePlayerSpriteTexture(key);

      const worldW = GRID_WIDTH * TILE_SIZE;
      const worldH = GRID_HEIGHT * TILE_SIZE;
      const minDim = Math.min(worldW, worldH);
      const target = minDim * FLASH_SCALE;

      this.centerFlash.setTexture(key);
      this.centerFlash.setPosition(this.player.x, this.player.y);
      this.centerFlash.setVisible(true);
      this.centerFlash.setAlpha(0.98);

      const w = this.centerFlash.width || 1;
      const h = this.centerFlash.height || 1;
      const s = target / Math.max(w, h);
      this.centerFlash.setScale(s * 0.90);

      this.tweens.add({
        targets: this.centerFlash,
        scale: s,
        duration: 30,
        ease: "Quad.out"
      });

      this.time.delayedCall(FLASH_DURATION_MS, () => {
        if (this.centerFlash) this.centerFlash.setVisible(false);
      });
    }

    recordPointAndMaybeFlash() {
      const now = performance.now();
      this.pointTimes.push(now);

      const cutoff = now - FLASH_WINDOW_MS;
      while (this.pointTimes.length && this.pointTimes[0] < cutoff) this.pointTimes.shift();

      if (this.pointTimes.length >= FLASH_POINTS_REQUIRED) {
        this.pointTimes = [];
        this.flashRandomImage();
      }
    }

    tryAttack(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      this.playAttackFlash(dx, dy);

      const tx = this.playerCell.x + dx;
      const ty = this.playerCell.y + dy;
      if (tx < 0 || tx >= GRID_WIDTH || ty < 0 || ty >= GRID_HEIGHT) {
        setStatus(this.statusLine("edge"));
        return;
      }

      const k = cellKey(tx, ty);
      const enemy = this.enemies.get(k);
      if (enemy) {
        this.enemies.delete(k);
        this.animateEnemyDeath(enemy);

        this.points += 1;
        this.recordPointAndMaybeFlash();

        setStatus(this.statusLine("HIT"));
      } else {
        setStatus(this.statusLine("miss"));
      }
    }

    update() {
      if (!this.dead && inputState.moveQueue.length) {
        const { dx, dy } = inputState.moveQueue.shift();
        this.tryMove(dx, dy);
      }
      if (!this.dead && inputState.attackQueue.length) {
        const { dx, dy } = inputState.attackQueue.shift();
        this.tryAttack(dx, dy);
      }
    }
  }

  const config = {
    type: Phaser.AUTO,
    parent: "game",
    transparent: true,
    width: window.innerWidth,
    height: window.innerHeight,
    scene: [MainScene],
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }
  };

  window.addEventListener("resize", () => {
    try {
      const game = Phaser.GAMES[0];
      if (game && game.scale) game.scale.resize(window.innerWidth, window.innerHeight);
    } catch (_) {}
  });

  new Phaser.Game(config);
})();
