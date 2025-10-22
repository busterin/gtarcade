// ====== Referencias ======
const gameWrapper = document.getElementById("gameWrapper");
const gameArea    = document.getElementById("gameArea"); // <div id="gameArea" tabindex="0">
const hud         = document.getElementById("hud");
const player      = document.getElementById("player");
const btnUp       = document.getElementById("btnUp");
const btnDown     = document.getElementById("btnDown");
const coinTxt     = document.getElementById("coinTxt");
const timeTxt     = document.getElementById("timeTxt");
const finalPoints = document.getElementById("finalPoints");

const winOverlay  = document.getElementById("winOverlay");
const restartBtn  = document.getElementById("restartBtn");

// ====== Sonidos ======
const sndHit  = new Audio("sounds/hit.mp3");
const sndStep = new Audio("sounds/jump.mp3");   // bip al cambiar de piso
const sndBg   = new Audio("sounds/bg.mp3");
const sndCoin = new Audio("sounds/coin.mp3");
[sndHit, sndStep, sndBg, sndCoin].forEach(s => { try { s.preload = "auto"; } catch(_){} });
sndBg.loop = true; sndBg.volume = 0.15;

// ====== Música fade ======
function fadeTo(audio, target=0.15, ms=600) {
  const step = (target - audio.volume) / Math.max(ms/30, 1);
  clearInterval(audio._fadeTimer);
  audio._fadeTimer = setInterval(() => {
    const v = Math.max(0, Math.min(1, audio.volume + step));
    audio.volume = v;
    if ((step > 0 && v >= target) || (step < 0 && v <= target)) {
      clearInterval(audio._fadeTimer);
      audio.volume = target;
    }
  }, 30);
}
function musicStart(){ try{ sndBg.currentTime=0; sndBg.play(); }catch(_){} fadeTo(sndBg, 0.15, 500); }
function musicStop(){ fadeTo(sndBg, 0.0, 400); setTimeout(()=>{ try{ sndBg.pause(); }catch(_){} }, 420); }

// ====== Layout/escala ======
const BASE_W = 600, BASE_H = 200;
function getControlsHeight(){
  const c=document.querySelector(".controls");
  if(!c || window.getComputedStyle(c).display==="none") return 0;
  return c.getBoundingClientRect().height + 18;
}
function fitStage(){
  const maxW = Math.min(window.innerWidth, 1100);
  const scaleW = maxW / BASE_W;
  const freeH = window.innerHeight - getControlsHeight() - 16;
  const scaleH = freeH / BASE_H;
  const scale  = Math.max(0.6, Math.min(scaleW, scaleH));
  document.documentElement.style.setProperty("--scale", String(scale));
  if(gameWrapper) gameWrapper.style.height = (BASE_H*scale + 4) + "px";
}

// ====== Estado ======
let running=false, worldX=0;
const MAX_LIVES=3; let lives=MAX_LIVES; let invulnerableUntil=0;
let coins=0;

// Tiempo (1 minuto)
const ROUND_DURATION_S = 60;
let timeLeft = ROUND_DURATION_S;

// 3 pisos (desde el suelo del área)
const LANE_BOTTOMS = [0, 60, 120];
let laneIndex = 0;
const LANE_COOLDOWN_MS = 140;
let laneSwitchUntil = 0;

// Auto-avance + fondo desplazándose
const AUTO_SPEED = 240;              // px/s base
let speedScale = 1;                  // dificultad
const MAX_SPEED_SCALE = 2.0;

// Timers
let obstacleTimer=null, coinTimer=null;

// ====== HUD ======
function renderLives(){
  if(!hud) return;
  hud.innerHTML="";
  for(let i=0;i<lives;i++){
    const el=document.createElement("div");
    el.className="honey";
    hud.appendChild(el);
  }
}
function renderCoins(){ if (coinTxt) coinTxt.textContent = String(coins); }
function formatTime(s){
  const m = Math.floor(s/60);
  const ss = Math.max(0, Math.ceil(s - m*60));
  return `${m}:${ss<10?'0':''}${ss}`;
}
function renderTime(){ if (timeTxt) timeTxt.textContent = formatTime(timeLeft); }

// ====== Inicio / reinicio ======
function startGame(){
  hideWin();
  running=true; worldX=0; speedScale=1; laneIndex=0;
  lives=MAX_LIVES; invulnerableUntil=0; renderLives();
  coins=0; renderCoins();
  timeLeft = ROUND_DURATION_S; renderTime();

  player.style.left = "140px";                           // X fija
  player.style.bottom = LANE_BOTTOMS[laneIndex] + "px";
  player.classList.remove("hurt");

  // Limpia entidades previas
  document.querySelectorAll(".obstacle,.coin").forEach(n=> n.remove());

  fitStage(); musicStart();
  scheduleNextObstacle(); scheduleNextCoin();

  // Enfocar juego (para Genially/iframe)
  focusGame();
}

// ====== Inputs (solo subir/bajar) ======
function tryLane(delta){
  const now = performance.now();
  if (now < laneSwitchUntil || !running) return;
  const ni = Math.max(0, Math.min(LANE_BOTTOMS.length-1, laneIndex + (delta>0?+1:-1)));
  if (ni === laneIndex) return;
  laneIndex = ni;
  laneSwitchUntil = now + LANE_COOLDOWN_MS;
  player.style.bottom = LANE_BOTTOMS[laneIndex] + "px";
  try { sndStep.currentTime=0; sndStep.play(); } catch(_){}
}
// Captura global: trae foco y mueve
window.addEventListener("keydown", (e)=>{
  if (e.code === "ArrowUp" || e.code === "ArrowDown") {
    e.preventDefault(); // evita scroll en contenedor
    focusGame();
    if (e.code === "ArrowUp")   tryLane(+1);
    if (e.code === "ArrowDown") tryLane(-1);
  }
}, { capture: true });

function bindTap(btn, cb){
  if(!btn) return;
  btn.onmousedown  = ev=>{ ev.preventDefault(); cb(); };
  btn.ontouchstart = ev=>{ ev.preventDefault(); cb(); };
}
bindTap(btnUp,   ()=> tryLane(+1));
bindTap(btnDown, ()=> tryLane(-1));

// ====== Bucle principal ======
let lastTime=0;
function moveLoop(t){
  if(!lastTime) lastTime=t;
  const dt=Math.min((t-lastTime)/1000,0.033);
  lastTime=t;

  if(running){
    // dificultad suave
    speedScale = Math.min(MAX_SPEED_SCALE, speedScale + dt * 0.02);
    worldX += AUTO_SPEED * speedScale * dt;

    // Fondo: parallax leve
    gameArea.style.backgroundPositionX = `${-(worldX*0.25)}px`;

    // Tiempo
    timeLeft = Math.max(0, timeLeft - dt);
    renderTime();
    if (timeLeft <= 0) {
      onTimeUp(); // fin por tiempo
    }

    // Colisiones / recogidas
    checkCollisions();
  }
  requestAnimationFrame(moveLoop);
}
requestAnimationFrame(moveLoop);

// ====== Spawners (dos tipos por entidad, sin salto) ======
function rand(a,b){return Math.random()*(b-a)+a;}
function randi(a,b){return Math.floor(rand(a,b));}

function spawnObstacle(){
  if(!running) return;
  const ob = document.createElement("div");
  ob.className = "obstacle";
  const lane = randi(0, LANE_BOTTOMS.length);
  ob.dataset.lane = String(lane);
  ob.style.bottom = LANE_BOTTOMS[lane] + "px";

  // tipo visual aleatorio: obstacle1 / obstacle2
  const type = Math.random() < 0.5 ? "obstacle1" : "obstacle2";
  ob.classList.add(type);

  const dur = (rand(2.8, 3.6) / speedScale).toFixed(2);
  ob.style.setProperty("--obDur", dur + "s");
  gameArea.appendChild(ob);
  ob.addEventListener("animationend", ()=> ob.remove(), { once:true });
}
function scheduleNextObstacle(){
  clearTimeout(obstacleTimer);
  // menos frecuencia (según lo acordado)
  const delay = randi(1800, 2800) / speedScale;
  obstacleTimer = setTimeout(()=>{ spawnObstacle(); scheduleNextObstacle(); }, delay);
}

function spawnCoin(){
  if(!running) return;
  const c = document.createElement("div");
  c.className = "coin";
  const lane = randi(0, LANE_BOTTOMS.length);
  c.dataset.lane = String(lane);
  c.style.bottom = LANE_BOTTOMS[lane] + "px";

  // tipo visual aleatorio: coin1 / coin2
  const type = Math.random() < 0.5 ? "coin1" : "coin2";
  c.classList.add(type);

  const dur = (rand(2.6, 3.6) / Math.min(speedScale,1.7)).toFixed(2);
  c.style.setProperty("--coinDur", dur + "s");
  gameArea.appendChild(c);
  c.addEventListener("animationend", ()=> c.remove(), { once:true });
}
function scheduleNextCoin(){
  clearTimeout(coinTimer);
  // menos frecuencia
  const delay = randi(1200, 2000) / Math.min(speedScale, 1.5);
  coinTimer = setTimeout(()=>{ spawnCoin(); scheduleNextCoin(); }, delay);
}

// ====== Colisiones (SOLO mismo piso) ======
function rectsOverlap(a,b){ return !(a.right<b.left || a.left>b.right || a.bottom<b.top || a.top>b.bottom); }

function checkCollisions(){
  if(!running) return;
  const rp = player.getBoundingClientRect();

  // Monedas del mismo lane
  document.querySelectorAll(".coin").forEach(c=>{
    if (!c.isConnected) return;
    if (Number(c.dataset.lane) !== laneIndex) return;
    const rc = c.getBoundingClientRect();
    if (rectsOverlap(rp, rc)) {
      try { sndCoin.currentTime=0; sndCoin.play(); } catch(_){}
      coins += 1; renderCoins();
      c.classList.add("pop");
      setTimeout(()=> c.remove(), 240);
      // ya no hay condición de victoria por monedas; solo por tiempo
    }
  });

  // Obstáculos del mismo lane
  document.querySelectorAll(".obstacle").forEach(ob=>{
    if (!ob.isConnected) return;
    if (Number(ob.dataset.lane) !== laneIndex) return;
    const ro = ob.getBoundingClientRect();
    if (rectsOverlap(rp, ro)) onHit(ob);
  });
}

function destroyObstacle(ob){
  if(!ob || !ob.isConnected) return;
  try { sndHit.currentTime=0; sndHit.play(); } catch(_){}
  ob.style.animation = "none";
  ob.classList.add("disintegrate");
  setTimeout(()=> ob.remove(), 240);
}

function onHit(ob){
  const now=performance.now();
  if(now < invulnerableUntil || !running) return;
  lives = Math.max(0, lives - 1);
  renderLives();
  player.classList.add("hurt");
  invulnerableUntil = now + 800;
  setTimeout(()=> player.classList.remove("hurt"), 650);
  destroyObstacle(ob);
  if(lives <= 0) onGameOver();
}

// ====== Fin por tiempo / Game Over / Reinicio ======
function showWin(){ winOverlay?.classList.add("visible"); }
function hideWin(){ winOverlay?.classList.remove("visible"); }

function onTimeUp(){
  if (!running) return;
  running = false;
  musicStop();
  clearTimeout(obstacleTimer); clearTimeout(coinTimer);
  if (finalPoints) finalPoints.textContent = String(coins);
  showWin();
}

restartBtn?.addEventListener("click", ()=> startGame());

function onGameOver(){
  running=false;
  clearTimeout(obstacleTimer); clearTimeout(coinTimer);
  musicStop();
  // reinicio suave tras perder por vidas
  setTimeout(()=> startGame(), 1200);
}

// ====== Auto-enfoque (clave para Genially/iframe) ======
function focusGame() {
  if (!gameArea) return;
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
  if (typing) return;
  try { gameArea.focus({ preventScroll: true }); } catch(_) {}
}
window.addEventListener("DOMContentLoaded", () => setTimeout(focusGame, 80));
window.addEventListener("load", () => setTimeout(focusGame, 120));
["pointerdown","pointerup","touchstart","touchend","click","mouseenter"].forEach(ev=>{
  window.addEventListener(ev, focusGame, { capture: true, passive: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") setTimeout(focusGame, 60);
});
window.addEventListener("blur", () => setTimeout(focusGame, 0));

// ====== Layout ======
window.addEventListener("resize", fitStage);
document.addEventListener("DOMContentLoaded", ()=>{ fitStage(); startGame(); });
