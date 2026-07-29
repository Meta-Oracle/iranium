const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const feedPath = path.join(process.cwd(), 'data', 'scenario-feed.json');
  const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));

  if (req.method === 'GET') {
    res.status(200).json({
      agent: feed.agent || 'elizaos-bridge',
      generatedAt: feed.generatedAt,
      events: feed.events || [],
    });
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const request = JSON.parse(body || '{}');
      const events = request.events || [];
      const highestSeverity = Math.max(...events.map((event) => Number(event.severity || 0)), 5);
      const highestOil = Math.max(...events.map((event) => Number(event.oilImpact || 0)), 6);
      const prompt = (request.query || '').toLowerCase();
      let message = 'Threat model reviewed. The command grid remains on watch and ready to pulse.';

      if (prompt.includes('escalate')) {
        message = 'Threat escalation accepted. Priority channels locked to defensive posture.';
      } else if (prompt.includes('signal')) {
        message = 'Signal packet generated. Market risk and oil premium projected upward.';
      } else if (prompt.includes('brief') || prompt.includes('commentary')) {
        message = 'Briefing compiled. Regional pressure remains elevated with selective supply constraints.';
      }

      res.status(200).json({
        message: `ELIZA OS // ${message}`,
        signalPriority: highestSeverity,
        oilPremium: highestOil,
      });
    });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
