(() => {
  // Movement slide cooldown (ms)
  const MOVE_COOLDOWN_MS = 140;

  const TILE = 72; // doubled tile size (larger squares)
  const TILE_INSET = 0.01; // 1% padding per side inside each tile (very tight)
  const ENTITY_SIZE = TILE * (1 - TILE_INSET * 2); // size of sprites/enemies inside a tile // doubled tile size (larger squares)
  const GRID_W = 6; // 13 -> remove 2 rows (13x11) then halve columns -> 6 // 13 -> remove 2 rows (13x11) then halve columns -> 6
  const GRID_H = 5; // 13 -> 11 -> halve rows -> 5 // 13 -> 11 -> halve rows -> 5
  const ENEMY_SPAWN_MS = 550;
  const MAX_ENEMIES = 10;

  // Reward flash settings
  const FLASH_KILLS_REQUIRED = 5;
  const FLASH_WINDOW_MS = 3600000; // 1 hour window (effectively no time limit)
  const FLASH_DURATION_MS = 150;   // ~9 frames at 60Hz (50% longer)   // ~6 frames at 60Hz
  const FLASH_SCALE = 0.55;

  // Put your images in /images and list them here.
  const INITIAL_PLAYER_KEY = "flash_flash2";

  const FLASH_IMAGES = [
    "flash1.png",
    "flash2.png",
    "flash3.png"
  ];

  const WORLD_W = GRID_W * TILE;
  const WORLD_H = GRID_H * TILE;

  const inputState = { moveQueue: [], attackQueue: [] };

    // ===== Audio (SFX) =====
  const WALK_SFX = ["boq_walk1", "boq_walk2", "boq_walk3"];
  const ATTACK_SFX = ["boq_attack1", "boq_attack2", "boq_attack3"];
  const GOT_SFX = ["boq_got1", "boq_got2", "boq_got3", "boq_got4", "boq_got5"];

  const SFX_VOL_WALK = 0.35;
  const SFX_VOL_ATTACK = 0.45;
  const SFX_VOL_GOT = 0.55;

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }



// ===== Slide / Gesture Controls (thumb-drag) =====
function directionFromDelta(dx, dy, deadZone = 12) {
  const mag = Math.hypot(dx, dy);
  if (mag < deadZone) return null;

  const angle = Math.atan2(dy, dx); // screen-space: +y down
  const oct = Math.round((8 * angle) / (2 * Math.PI) + 8) % 8;

  // 8-direction map (dx, dy)
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

    // Immediate action on down
    computeAndMaybeEmit(e.clientX, e.clientY, true);
  };

  const onMove = (e) => {
    if (!active) return;
    e.preventDefault();
    if (pointerId !== null && e.pointerId !== pointerId) return;
    computeAndMaybeEmit(e.clientX, e.clientY, false);
  };

  const stop = (e) => {
    active = false;
    lastDir = null;
    rect = null;
    try {
      if (pointerId !== null) padEl.releasePointerCapture(pointerId);
    } catch (_) {}
    pointerId = null;
  };

  // Capture-phase to receive events even when starting on child buttons.
  padEl.addEventListener("pointerdown", onDown, { passive: false, capture: true });
  padEl.addEventListener("pointermove", onMove, { passive: false, capture: true });

  padEl.addEventListener("pointerup", stop, { passive: true, capture: true });
  padEl.addEventListener("pointercancel", stop, { passive: true, capture: true });
  padEl.addEventListener("lostpointercapture", stop, { passive: true, capture: true });
}
// ================================================


  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
// Bind slide controls to pads (movement + attack)
const movePad = document.getElementById("movePad");
const attackPad = document.getElementById("attackPad");

if (movePad) {
  // Move pad: slide enabled with small delay between moves (easier control)
  bindSlidePad(movePad, inputState.moveQueue, { cooldownMs: MOVE_COOLDOWN_MS });
}
const attackBtn = document.getElementById("attackBtn");
if (attackBtn) {
  attackBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    inputState.attackQueue.push({ dx: 0, dy: 0 }); // direction ignored anyway
  }, { passive: false });
}



  document.getElementById("restart").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    window.location.reload();
  }, { passive: false });

  
  const restartOverlayBtn = document.getElementById("restartOverlay");
  if (restartOverlayBtn) {
    restartOverlayBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      window.location.reload();
    }, { passive: false });
  }

const statusEl = document.getElementById("status");
  const setStatus = (t) => statusEl.textContent = t;

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
      this.playerCell = { x: 0, y: 0 };
      this.enemies = new Map();
      this.kills = 0;
      this.startTime = 0;
      this.dead = false;

      
      this.hideGameOverOverlay();
      this.attackFlash = null;

      this.killTimes = [];
      this.centerFlash = null;
      this.flashGrowTween = null;
      this.flashKeys = []; // rebuilt from FLASH_IMAGES every load
    }

    preload() {
      this.load.setPath(""); // root-relative paths now

      // --- SFX (chicken "bock" sounds) ---
      const loadSfx = (key) => {
        this.load.audio(key, [
          `audio/${key}.m4a`
        ]);
      };

      [...WALK_SFX, ...ATTACK_SFX, ...GOT_SFX].forEach(loadSfx);

      this.load.setPath("images");
      // Player sprite (must exist at images/flash2.png)
      this.load.image("player", "flash2.png");

      // Enemy sprite
      this.load.image("enemy_fly", "fly.png");

      // Lily pads
      this.load.image("lily1", "lily1.png");
      this.load.image("lily2", "lily2.png");
      this.load.image("lily3", "lily3.png");



      // Surface asset load failures (common issue on GitHub Pages due to path/case)
      this.load.on('loaderror', function (file) {
        const el = document.getElementById('status');
        if (el) { el.style.display = "block"; el.textContent = "ASSET LOAD ERROR: " + file.key + " (" + (file.src || file.url || "") + ")"; }
      });

      this.flashKeys = []; // rebuilt from FLASH_IMAGES every load
      for (const p of FLASH_IMAGES) {
        const k = keyForImagePath(p);
        this.flashKeys.push(k);
        this.load.image(k, p);
      }
    }
    buildDecor() {
      // Clear prior decor (if any)
      if (this.decorLayer) this.decorLayer.removeAll(true);

      var lilyKeys = ["lily1", "lily2", "lily3"];
      var count = 0;

      // Use TILE as the authoritative tile size; the camera zoom handles viewport fitting.
      var target = TILE * 0.95;

      for (var yy = 1; yy < GRID_H - 1; yy++) {
        for (var xx = 1; xx < GRID_W - 1; xx++) {
          var key = lilyKeys[Math.floor(Math.random() * lilyKeys.length)];
          var lx = this.cellToWorldX(xx);
          var ly = this.cellToWorldY(yy);

          // Parent/child pattern: container at cell center + child sprite at (0,0)
          var pad = this.add.container(lx, ly);
          pad.setDepth(-10);
var sprite = this.add.image(0, 0, key);
          pad.add(sprite);

          // Cover+crop to fill a square tile (same approach as enemy sprite sizing)
          if (this.textures.exists(key)) {
            if (sprite.setCrop) sprite.setCrop();

            var tex = this.textures.get(key);
            var srcImg = (tex && tex.getSourceImage) ? tex.getSourceImage() : null;
            var texW = (srcImg && srcImg.width) ? srcImg.width : (sprite.width || 1);
            var texH = (srcImg && srcImg.height) ? srcImg.height : (sprite.height || 1);

            var sCover = Math.max(target / texW, target / texH);
            sprite.setScale(sCover);

            var cropW = target / sCover;
            var cropH = target / sCover;
            var cx = (texW - cropW) / 2;
            var cy = (texH - cropH) / 2;
            if (sprite.setCrop) sprite.setCrop(cx, cy, cropW, cropH);
          }

          sprite.setAlpha(0.95);
          pad.setRotation((Math.random() - 0.5) * 0.12);
          if (Math.random() < 0.25) sprite.setFlipX(true);

          pad.setDepth(0);
          // Lily pads stay in the main display list (depth-based ordering)
          // if (this.decorLayer) this.decorLayer.add(pad);
          count++;
        }
      }
    }



    create() {
      // Render layers (best-practice ordering)
      // bgLayer: reserved (water handled by CSS), decorLayer: lilies, entityLayer: player/enemies, fxLayer: flashes/anim FX
      this.bgLayer = this.add.layer();
      this.bgLayer.setDepth(0);
      this.decorLayer = this.add.layer();
      this.decorLayer.setDepth(5);
      this.entityLayer = this.add.layer();
      this.entityLayer.setDepth(25);
      this.fxLayer = this.add.layer();
      this.fxLayer.setDepth(50);


      // Ensure depth ordering is applied consistently across mobile browsers
      this.children.sort("depth");
      this.children.bringToTop(this.entityLayer);
      this.children.bringToTop(this.fxLayer);
this.scale.resize(window.innerWidth, window.innerHeight);
      this.scale.on("resize", (gameSize) => {
        this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
        this.fitWorldToScreen(gameSize.width, gameSize.height);
      });

      this.fitWorldToScreen(window.innerWidth, window.innerHeight);
      this.buildDecor();

      // Grid disabled
      this.playerCell = { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) };

      // Player logical object (container) with a child sprite.
      const px = this.cellToWorldX(this.playerCell.x);
      const py = this.cellToWorldY(this.playerCell.y);

      this.player = this.add.container(px, py);

      // Player visual (image inside container)
      this.playerSprite = this.add.image(0, 0, INITIAL_PLAYER_KEY);
      this.player.add(this.playerSprite);

      // Apply initial cover+crop
      this.updatePlayerSpriteTexture(INITIAL_PLAYER_KEY);

this.attackFlash = this.add.graphics();

      
      if (this.fxLayer) this.fxLayer.add(this.attackFlash);
      this.attackFlash.setDepth(1000);
// Center flash image (hidden)
      const firstKey = this.flashKeys[0] || null;
      this.centerFlash = this.add.image(this.player.x, this.player.y, firstKey);
      this.centerFlash.setVisible(false);
      this.centerFlash.setDepth(9999);

      
      // Ensure flash is WORLD-SPACE (moves with camera) and centered on its texture
      this.centerFlash.setScrollFactor(1);
      this.centerFlash.setOrigin(0.5, 0.5);
this.kills = 0;
      this.startTime = performance.now();
      
      this.loadHighScore();
      this.updateHighScoreUI();
      this.hideGameOverOverlay();
this.dead = false;
      setStatus(this.statusLine());
      this.input.once("pointerdown", () => {
        const ctx = this.sound && this.sound.context;
        if (ctx && ctx.state === "suspended") ctx.resume();
      });


      this.time.addEvent({
        delay: ENEMY_SPAWN_MS,
        loop: true,
        callback: () => { if (!this.dead) this.spawnEnemyEdge(); }
      });

      // Flash initial sprite to indicate starting character image
      // initial flash disabled (function removed)

    }

    fitWorldToScreen(w, h) {
      const s = Math.min(w / (GRID_W * TILE), h / (GRID_H * TILE));
      const cam = this.cameras.main;
      cam.setZoom(s);
      cam.centerOn((GRID_W * TILE) / 2, (GRID_H * TILE) / 2);
    }

    drawGrid() { /* disabled */ }

    cellToWorldX(cx) { return cx * TILE + TILE / 2; }
    cellToWorldY(cy) { return cy * TILE + TILE / 2; }

    jumpPlayerTo(nx, ny) {
      const now = performance.now();
      const canPlayWalk = !this._lastWalkSfxAt || (now - this._lastWalkSfxAt) >= 80;
      if (canPlayWalk) {
        this._lastWalkSfxAt = now;
        this.playRandomSfx(WALK_SFX, { volume: SFX_VOL_WALK });
      }


      const startX = this.player.x;
      const startY = this.player.y;
      const endX = this.cellToWorldX(nx);
      const endY = this.cellToWorldY(ny);
      const jumpHeight = 18; // visual arc height
      const duration = 140; // ms, snappy but readable
      // prevent input during jump
      this.isPlayerMoving = true;
      this.tweens.add({
        targets: this.player,
        x: endX,
        y: endY,
        duration,
        ease: 'Linear',
        onUpdate: tween => {
            const t = tween.progress;
            const arc = Math.sin(Math.PI * t) * jumpHeight;
            this.player.y = Phaser.Math.Linear(startY, endY, t) - arc;
        },
        onComplete: () => {
            this.player.setPosition(endX, endY);
            this.isPlayerMoving = false;
        }
      });
    }

    spawnFloatingScoreText(text) {
      if (!this.player) return;
      const x = this.player.x;
      const y = this.player.y;
      const t = this.add.text(x, y, String(text), {
        fontFamily: '"Comic Sans MS", "Trebuchet MS", system-ui, sans-serif',
        fontSize: "30px",
        fontStyle: "900",
        color: "#f7f2a0",      // light fill
        stroke: "#0b0f14",     // dark outline
        strokeThickness: 7,
        shadow: {
          offsetX: 0,
          offsetY: 2,
          color: "#000000",
          blur: 6,
          fill: true
        }
      });
      t.setOrigin(0.5, 0.5);
      t.setDepth(99999);
      t.setScrollFactor(1);
      
      // Pop + rise + fade
      t.setScale(0.6);
      t.setAlpha(0.0);
      this.tweens.add({
        targets: t,
        alpha: 1,
        scale: 1.2,
        duration: 120,
        ease: "Back.out"
      });
      this.tweens.add({
        targets: t,
        y: y - 56,
        alpha: 0,
        scale: 1.45,
        duration: 560,
        ease: "Quad.in",
        delay: 60,
        onComplete: () => t.destroy()
      });
    }


    


    statusLine(extra = "") {


          const t = ((performance.now() - this.startTime) / 1000).toFixed(1);


          const kps = (this.kills / Math.max(0.001, (performance.now() - this.startTime) / 1000)).toFixed(2);


          const line1 = `BoqBoqs!: ${this.kills}`;


          const line3 = extra ? `${extra}` : "";


          return `${line1}\n${line3}`;


        }

    loadHighScore() {
      const hk = parseInt(localStorage.getItem("nf_highKills") || "0", 10);
      const hkp = parseFloat(localStorage.getItem("nf_highKps") || "0");
      this.highKills = isFinite(hk) ? hk : 0;
      this.highKps = isFinite(hkp) ? hkp : 0;
    }

    saveHighScore(kills, kps) {
      this.highKills = kills;
      this.highKps = kps;
      try {
        localStorage.setItem("nf_highKills", String(kills));
        localStorage.setItem("nf_highKps", String(kps));
      } catch (_) {}
      this.updateHighScoreUI();
    }

    isNewHighScore(kills, kps) {
      if (kills > this.highKills) return true;
      if (kills < this.highKills) return false;
      return kps > this.highKps;
    }

    updateHighScoreUI() {
      const el = document.getElementById("highScore");
      if (!el) return;
      el.style.display = "block";
      el.textContent = `High: ${this.highKills}`;
    }

    showGameOverOverlay(kills, kps, isNewHigh) {


          const wrap = document.getElementById("gameOver");


          const textEl = document.getElementById("gameOverText");


          if (!wrap || !textEl) return;


    


          const badge = isNewHigh ? "\nNEW HIGH SCORE" : "";


          wrap.style.display = "block";


          textEl.textContent = `Game Over\nBoqBoqs!: ${kills}\n${badge}`;


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


    spawnEnemyEdge() {
      if (this.enemies.size >= MAX_ENEMIES) return;

      for (let tries = 0; tries < 70; tries++) {
        const side = Phaser.Math.Between(0, 3);
        let x, y;
        if (side === 0) { x = Phaser.Math.Between(0, GRID_W - 1); y = 0; }
        else if (side === 1) { x = GRID_W - 1; y = Phaser.Math.Between(0, GRID_H - 1); }
        else if (side === 2) { x = Phaser.Math.Between(0, GRID_W - 1); y = GRID_H - 1; }
        else { x = 0; y = Phaser.Math.Between(0, GRID_H - 1); }

        if (x === this.playerCell.x && y === this.playerCell.y) continue;
        const k = cellKey(x, y);
        if (this.enemies.has(k)) continue;

        const ex = this.cellToWorldX(x);
        const ey = this.cellToWorldY(y);

        // Enemy logical object (container) with a child sprite (mirrors player pattern)
        const enemy = this.add.container(ex, ey);
        const enemySprite = this.add.image(0, 0, "enemy_fly");

        // Apply cover+crop to fit exactly inside the tile (same approach as player)
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

      const elapsed = (performance.now() - this.startTime) / 1000;
      const kps = this.kills / Math.max(0.001, elapsed);

      const isNewHigh = this.isNewHighScore(this.kills, kps);
      if (isNewHigh) this.saveHighScore(this.kills, kps);

      // Status panel
      setStatus(this.statusLine(`BOQ!: ${reason}. Tap Restart.`));

      // Center overlay
      this.showGameOverOverlay(this.kills, kps, isNewHigh);

      if (this.playerSprite && this.playerSprite.setTint) { this.playerSprite.setTint(0x3b4b5c); }
      if (this.playerSprite && this.playerSprite.setAlpha) { this.playerSprite.setAlpha(0.85); }
    }

    tryMove(dx, dy) {
      if (this.isPlayerMoving) return;
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      const nx = clamp(this.playerCell.x + dx, 0, GRID_W - 1);
      const ny = clamp(this.playerCell.y + dy, 0, GRID_H - 1);
      if (nx === this.playerCell.x && ny === this.playerCell.y) return;

      const k = cellKey(nx, ny);
      if (this.enemies.has(k)) {
        this.playerCell = { x: nx, y: ny };
        this.jumpPlayerTo(nx, ny);
        this.die("stepped onto enemy");
        return;
      }

      this.playerCell = { x: nx, y: ny };
      this.jumpPlayerTo(nx, ny);
      setStatus(this.statusLine());
    }

    
    
    triggerInhale() {
      if (!this.player) return;

      if (!this._inhaleState) this._inhaleState = { s: 1 };

      // Stop any prior inhale tween only
      if (this._inhaleTween) {
        try { this._inhaleTween.stop(); } catch (_) {}
        try { this._inhaleTween.remove(); } catch (_) {}
        this._inhaleTween = null;
      }

      this._inhaleState.s = 1;
      this.player.setScale(1);

      
      if (this.player) this.children.bringToTop(this.player);
var scene = this;
      this._inhaleTween = this.tweens.add({
        targets: this._inhaleState,
        s: 1.12,
        duration: 90,
        ease: "Quad.out",
        yoyo: true,
        hold: 10,
        onUpdate: function () {
          if (scene.player) scene.player.setScale(scene._inhaleState.s);
        },
        onComplete: function () {
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

      var px = this.player ? this.player.x : enemy.x;
      var py = this.player ? this.player.y : enemy.y;

      enemy.setDepth(50);

      var scene = this;
      scene.tweens.add({
        targets: enemy,
        scale: 1.15,
        duration: 70,
        ease: "Quad.out",
        onComplete: function () {
          scene.tweens.add({
            targets: enemy,
            x: px,
            y: py,
            scale: 0,
            alpha: 0,
            duration: 160,
            ease: "Quad.in",
            onComplete: function () { enemy.destroy(); }
          });
        }
      });

      scene.triggerInhale();
    }

playRandomSfx(keys, opts = {}) {
  if (!keys || !keys.length) return;
  if (!this.sound) return;

  const key = pickRandom(keys);
  if (!this.cache.audio.exists(key)) return;

  const vol = Number.isFinite(opts.volume) ? opts.volume : 0.5;

  // Use play(key, config) to avoid creating a ton of Sound instances.
  try {
    this.sound.play(key, { volume: vol });
  } catch (_) {
    // Ignore if audio is blocked until user gesture; it will work after first interaction.
  }
}

    
playAttackFlash(dx, dy) {
      const x0 = this.cellToWorldX(this.playerCell.x);
      const y0 = this.cellToWorldY(this.playerCell.y);
      const x1 = x0 + dx * TILE * 0.95;
      const y1 = y0 + dy * TILE * 0.95;

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
      // Swap the player sprite texture and re-apply cover scale + centered square crop.
      if (!this.playerSprite || !key) return;
      if (!this.textures.exists(key)) return;

      // Clear any previous crop before reading source dimensions
      if (this.playerSprite.setCrop) this.playerSprite.setCrop();

      // Get source image size (more reliable than width/height after crops)
      const tex = this.textures.get(key);
      const src = (tex && tex.getSourceImage) ? tex.getSourceImage() : null;
      const texW = (src && src.width) ? src.width : (this.playerSprite.width || 1);
      const texH = (src && src.height) ? src.height : (this.playerSprite.height || 1);

      this.playerSprite.setTexture(key);

      const targetW = ENTITY_SIZE;
      const targetH = ENTITY_SIZE;

      const sCover = Math.max(targetW / texW, targetH / texH);
      this.playerSprite.setScale(sCover);

      // Crop a centered square region in texture space
      const cropW = targetW / sCover;
      const cropH = targetH / sCover;
      const cropX = (texW - cropW) / 2;
      const cropY = (texH - cropH) / 2;

      if (this.playerSprite.setCrop) this.playerSprite.setCrop(cropX, cropY, cropW, cropH);
    }

flashRandomImage() {
      if (!this.flashKeys.length || !this.centerFlash) return;

      const key = Phaser.Utils.Array.GetRandom(this.flashKeys); // uniform random over all flash images

      // Flash + adopt instantly
      this.updatePlayerSpriteTexture(key);

      const WW = GRID_W * TILE, HH = GRID_H * TILE;
      const minDim = Math.min(WW, HH);
      const target = minDim * FLASH_SCALE;

      this.centerFlash.setTexture(key);

      // Anchor flash at the player's rectangle center (keeps attention on the avatar)
      this.centerFlash.setPosition(this.player.x, this.player.y);
      this.centerFlash.setVisible(true);
      this.centerFlash.setAlpha(0.98);

      const w = this.centerFlash.width || 1;
      const h = this.centerFlash.height || 1;
      const s = target / Math.max(w, h);
      this.centerFlash.setScale(s * 0.90);

      // Pop animation (quick scale-in to full size)
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

    recordKillAndMaybeFlash() {
      const now = performance.now();
      this.killTimes.push(now);

      const cutoff = now - FLASH_WINDOW_MS;
      while (this.killTimes.length && this.killTimes[0] < cutoff) this.killTimes.shift();

      if (this.killTimes.length >= FLASH_KILLS_REQUIRED) {
        this.killTimes = [];
        // Show the player's current score (kills/points) when the "grow" triggers
        this.spawnFloatingScoreText(String(this.kills));
        this.flashRandomImage();
      }

    }

    attackOnce(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;
      this.playAttackFlash(dx, dy);
      const tx = this.playerCell.x + dx;
      const ty = this.playerCell.y + dy;
      if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) {
        // For cascade, don't spam status for edge hits—optional:
        // setStatus(this.statusLine("edge"));
        return;
      }
      const k = cellKey(tx, ty);
      const enemy = this.enemies.get(k);
      if (enemy) {
        this.enemies.delete(k);
        this.playRandomSfx(GOT_SFX, { volume: SFX_VOL_GOT });
        this.animateEnemyDeath(enemy);
        this.kills += 1;
        this.recordKillAndMaybeFlash();
        // setStatus(this.statusLine("HIT"));
      } else {
        // setStatus(this.statusLine("miss"));
      }
    }

    startCascadeAttack() {
      if (this.dead) return;
      if (this.isCascadingAttack) return; // prevent overlap
      this.playRandomSfx(ATTACK_SFX, { volume: SFX_VOL_ATTACK });
      this.isCascadingAttack = true;
      
      // Clockwise ring of 8 directions (starting at NW)
      const dirsCW = [
        { dx: -1, dy: -1 }, // NW
        { dx:  0, dy: -1 }, // N
        { dx:  1, dy: -1 }, // NE
        { dx:  1, dy:  0 }, // E
        { dx:  1, dy:  1 }, // SE
        { dx:  0, dy:  1 }, // S
        { dx: -1, dy:  1 }, // SW
        { dx: -1, dy:  0 }, // W
        ];
      const clockwise = Math.random() < 0.5;
      const startIdx = Math.floor(Math.random() * dirsCW.length);
      // Build ordered sequence of 8 directions
      const seq = [];
      for (let i = 0; i < 8; i++) {
        const step = clockwise ? i : -i;
        const idx = (startIdx + step + 8) % 8;
        seq.push(dirsCW[idx]);
      }
      
      const stepDelayMs = 16; // tight “spin” feel; tune 25–60ms
      
      // Schedule 8 quick attacks; use scene clock for consistent timing
      seq.forEach((dir, i) => {
        this.time.delayedCall(stepDelayMs * i, () => {
          this.attackOnce(dir.dx, dir.dy);
          
          // Release lock after last step
          if (i === seq.length - 1) {
            this.isCascadingAttack = false;
          }
        });
      });
    }

    
    tryAttack(dx, dy) {
      if (this.dead) return;
      if (!isAdjacent(dx, dy)) return;

      this.playAttackFlash(dx, dy);

      const tx = this.playerCell.x + dx;
      const ty = this.playerCell.y + dy;
      if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) {
        setStatus(this.statusLine("edge"));
        return;
      }

      const k = cellKey(tx, ty);
      const enemy = this.enemies.get(k);
      if (enemy) {
        this.enemies.delete(k);
        this.animateEnemyDeath(enemy);
        this.kills += 1;
        this.recordKillAndMaybeFlash();
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
        inputState.attackQueue.shift(); // consume one press/gesture event (direction ignored)
        this.startCascadeAttack();
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
