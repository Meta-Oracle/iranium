const statusPill = document.getElementById('statusPill');
const feedList = document.getElementById('feedList');
const refreshButton = document.getElementById('refreshButton');
const canvas = document.getElementById('riskCanvas');
const ctx = canvas.getContext('2d');
const panels = Array.from(document.querySelectorAll('.draggable-panel'));
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const actionButtons = Array.from(document.querySelectorAll('.action-btn'));

let events = [];
let animationFrame;
let dragState = null;
let lastFrameTime = 0;
const frameInterval = 1000 / 45;
const bridgeEndpoint = '/api/bridge';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

function buildEventCards() {
  feedList.innerHTML = '';
  events.forEach((event) => {
    const card = document.createElement('article');
    card.className = 'feed-card';
    const severity = Math.min(10, Math.max(1, event.severity));
    const color = severity >= 8 ? '#ff355e' : severity >= 6 ? '#ffb84d' : '#2de4a2';

    card.innerHTML = `
      <strong style="color:${color};">${event.kind.replace(/-/g, ' ')}</strong>
      <div class="summary">${event.summary}</div>
      <div class="feed-meta">
        <span>oil ${event.oilImpact > 0 ? '+' : ''}${event.oilImpact}</span>
        <span>${formatTime(event.timestamp)}</span>
      </div>
    `;
    feedList.appendChild(card);
  });
}

function drawGlobe(time) {
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 200;

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createRadialGradient(centerX, centerY, 20, centerX, centerY, 320);
  bg.addColorStop(0, 'rgba(30, 5, 8, 0.95)');
  bg.addColorStop(1, 'rgba(2, 2, 2, 1)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 76, 97, 0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i += 1) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, 40 + i * 28, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const globeGradient = ctx.createRadialGradient(centerX - 80, centerY - 90, 50, centerX, centerY, radius);
  globeGradient.addColorStop(0, '#1c0b11');
  globeGradient.addColorStop(0.55, '#6f0c1f');
  globeGradient.addColorStop(1, '#030303');
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = globeGradient;
  ctx.shadowBlur = 30;
  ctx.shadowColor = 'rgba(255, 76, 97, 0.25)';
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let lat = -80; lat <= 80; lat += 20) {
    const rad = (lat / 180) * Math.PI;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 10) {
      const x = Math.cos((lon / 180) * Math.PI) * (radius - 15) * Math.cos(rad);
      const y = Math.sin(rad) * (radius - 15);
      if (lon === -180) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  for (let lon = -180; lon <= 180; lon += 20) {
    const rad = (lon / 180) * Math.PI;
    ctx.beginPath();
    for (let lat = -80; lat <= 80; lat += 10) {
      const r = (lat / 180) * Math.PI;
      const x = Math.cos(rad) * (radius - 15) * Math.cos(r);
      const y = Math.sin(r) * (radius - 15);
      if (lat === -80) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 76, 97, 0.3)';
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + 20, radius + 40, radius + 10, Math.PI * 0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  const scanY = (time * 140) % (height + 120) - 60;
  ctx.strokeStyle = 'rgba(255, 76, 97, 0.16)';
  ctx.beginPath();
  ctx.moveTo(0, scanY);
  ctx.lineTo(width, scanY);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  const radarPulse = 20 + Math.sin(time * 2.2) * 8;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radarPulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 76, 97, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = '12px monospace';
  ctx.fillStyle = '#ff8a9c';
  ctx.fillText(`[ ${new Date().toLocaleTimeString()} ] ORBITAL INTEL ACTIVE`, 24, 28);
  ctx.fillText(`> STRIKE RISK LEVEL ${events.length ? Math.max(...events.map((e) => e.severity)) : 7}/10`, 24, 48);
  ctx.fillText(`> OIL SHOCK INDEX ${events.length ? Math.max(...events.map((e) => e.oilImpact)) : 9}`, 24, 68);
  ctx.restore();

  events.forEach((event, index) => {
    const severity = clamp(event.severity / 10, 0.2, 1);
    const oilImpact = clamp(event.oilImpact / 20, -1, 1);
    const lat = (index - 1) * 22 + Math.sin(time * 0.35 + index) * 18;
    const lon = (time * 24 + index * 65) % 360 - 180;
    const latRad = (lat / 180) * Math.PI;
    const lonRad = (lon / 180) * Math.PI;
    const x = centerX + Math.cos(latRad) * Math.cos(lonRad) * (radius * 0.76);
    const y = centerY + Math.sin(latRad) * (radius * 0.76) + Math.cos(lonRad) * 24;
    const isStrike = /strike|missile/i.test(event.kind);
    const color = isStrike ? '#ff355e' : severity >= 0.7 ? '#ffb84d' : '#2de4a2';

    ctx.beginPath();
    ctx.arc(x, y, 10 + severity * 6, 0, Math.PI * 2);
    ctx.fillStyle = `${color}44`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4 + severity * 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (isStrike) {
      ctx.beginPath();
      ctx.moveTo(x - 10, y - 10);
      ctx.lineTo(x + 10, y + 10);
      ctx.moveTo(x + 10, y - 10);
      ctx.lineTo(x - 10, y + 10);
      ctx.strokeStyle = '#ff355e';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 18 + severity * 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 53, 94, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255, 240, 240, 0.75)';
    ctx.font = '11px monospace';
    ctx.fillText(event.kind.replace(/-/g, ' '), x + 10, y - 10);
    ctx.fillText(`oil ${event.oilImpact > 0 ? '+' : ''}${event.oilImpact}`, x + 10, y + 4);
  });

  animationFrame = window.requestAnimationFrame(drawGlobeFrame);
}

function drawGlobeFrame(now) {
  if (now - lastFrameTime < frameInterval) {
    animationFrame = window.requestAnimationFrame(drawGlobeFrame);
    return;
  }
  lastFrameTime = now;
  const time = now / 1000;
  drawGlobe(time);
}

async function loadFeed() {
  statusPill.textContent = 'SYNCING STRIKE FEED…';
  try {
    const response = await fetch(bridgeEndpoint);
    if (!response.ok) {
      throw new Error(`feed failed with status ${response.status}`);
    }
    const payload = await response.json();
    events = payload.events || [];
    buildEventCards();
    statusPill.textContent = `LIVE FEED • ${payload.agent}`;
  } catch (error) {
    statusPill.textContent = 'FEED OFFLINE';
    console.error(error);
  }
}

function makePanelsDraggable() {
  panels.forEach((panel) => {
    const handle = panel.querySelector('.panel-handle');
    handle.addEventListener('pointerdown', (event) => {
      dragState = {
        panel,
        offsetX: event.clientX - panel.offsetLeft,
        offsetY: event.clientY - panel.offsetTop,
      };
      panel.style.zIndex = '20';
      panel.style.position = 'absolute';
      panel.setPointerCapture(event.pointerId);
    });

    handle.addEventListener('pointermove', (event) => {
      if (!dragState || dragState.panel !== panel) {
        return;
      }
      const rect = panel.parentElement.getBoundingClientRect();
      const nextLeft = event.clientX - dragState.offsetX;
      const nextTop = event.clientY - dragState.offsetY;
      panel.style.left = `${Math.max(0, Math.min(nextLeft, rect.width - panel.offsetWidth))}px`;
      panel.style.top = `${Math.max(0, Math.min(nextTop, rect.height - panel.offsetHeight))}px`;
    });

    handle.addEventListener('pointerup', () => {
      dragState = null;
    });
  });
}

function addChatMessage(text, type = 'system') {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${type}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const value = chatInput.value.trim();
  if (!value) {
    return;
  }
  addChatMessage(value, 'user');
  chatInput.value = '';

  try {
    const response = await fetch(bridgeEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: value, events }),
    });
    const payload = await response.json();
    const reply = payload.message || 'Threat model reviewed.';
    window.setTimeout(() => addChatMessage(reply, 'system'), 350);
  } catch (error) {
    window.setTimeout(() => addChatMessage('ELIZA OS // Bridge unavailable. Local fallback engaged.', 'system'), 350);
    console.error(error);
  }
}

function handleAction(action) {
  const actionMap = {
    signal: 'Signal broadcast dispatched to the war-room feed.',
    brief: 'Brief request routed to the ElizaOS commentary layer.',
    escalate: 'Threat escalation pulse sent to the utility grid.',
  };
  addChatMessage(actionMap[action] || 'Action acknowledged.', 'system');
}

refreshButton.addEventListener('click', loadFeed);
chatForm.addEventListener('submit', handleChatSubmit);
actionButtons.forEach((button) => {
  button.addEventListener('click', () => handleAction(button.dataset.action));
});
loadFeed();
drawGlobeFrame();
makePanelsDraggable();
addChatMessage('ElizaOS commentary online. Ask for a briefing, signal, or threat escalation.', 'system');

window.addEventListener('beforeunload', () => {
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
  }
});
