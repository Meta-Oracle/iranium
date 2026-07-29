const fs = require('fs');
const path = require('path');

let XMLParser;
try {
  ({ XMLParser } = require('fast-xml-parser'));
} catch {
  XMLParser = null;
}

const DEFAULT_MODEL = 'gpt-5.6-luna';
const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12000;

const LIVE_SOURCES = [
  { name: 'BBC Middle East', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml' },
  { name: 'Oilprice', url: 'https://oilprice.com/rss/main' },
];

const FOCUS_TERMS = [
  'iran',
  'tehran',
  'hormuz',
  'persian gulf',
  'oil',
  'crude',
  'opec',
  'sanction',
  'nuclear',
  'missile',
  'drone',
  'shipping',
  'red sea',
  'israel',
  'gulf',
  'energy',
];

let payloadCache = {
  expiresAt: 0,
  payload: null,
};

function getOpenAIConfig(env = process.env) {
  return {
    apiKey: env.OPENAI_API_KEY || env.ELIZA_OPENAI_API_KEY || '',
    model: env.ELIZA_OPENAI_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL,
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
}

function getCacheMs(env = process.env) {
  const configured = Number(env.LIVE_FEED_REFRESH_MS || env.IRANIUM_LIVE_FEED_CACHE_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_CACHE_MS;
}

function loadStaticFeed(rootDir = process.cwd()) {
  const feedPath = path.join(rootDir, 'data', 'scenario-feed.json');
  try {
    return JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  } catch {
    return {
      agent: 'elizaos-static-fallback',
      generatedAt: new Date().toISOString(),
      events: [
        {
          id: 'fallback-1',
          kind: 'regional-tension',
          severity: 6,
          oilImpact: 5,
          marketImpact: -6,
          summary: 'Static fallback active while live public-source feeds are unavailable.',
          timestamp: new Date().toISOString(),
          sourceTitle: 'Iranium fallback feed',
          sourceUrl: '',
        },
      ],
    };
  }
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return decodeEntities(String(value)).trim();
  }
  if (typeof value === 'object') {
    return decodeEntities(String(value['#text'] || value.__cdata || value._ || value.href || '')).trim();
  }
  return '';
}

function decodeEntities(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '-');
}

function stripHtml(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseRss(xml, source) {
  if (XMLParser) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      cdataPropName: '__cdata',
      trimValues: true,
    });
    const document = parser.parse(xml);
    const channel = document.rss?.channel || document.feed || {};
    const items = toArray(channel.item || channel.entry);

    return items.map((item) => {
      const link = typeof item.link === 'object' ? textOf(item.link['@_href'] || item.link.href) : textOf(item.link);
      return {
        sourceName: source.name,
        sourceUrl: source.url,
        title: textOf(item.title),
        description: stripHtml(textOf(item.description || item.summary || item.content)),
        link,
        publishedAt: normalizeDate(textOf(item.pubDate || item.published || item.updated || item['dc:date'])),
      };
    });
  }

  return toArray(xml.match(/<item\b[\s\S]*?<\/item>/gi)).map((itemXml) => ({
    sourceName: source.name,
    sourceUrl: source.url,
    title: extractTag(itemXml, 'title'),
    description: stripHtml(extractTag(itemXml, 'description')),
    link: extractTag(itemXml, 'link'),
    publishedAt: normalizeDate(extractTag(itemXml, 'pubDate')),
  }));
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripHtml(match[1]) : '';
}

function normalizeDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

async function fetchWithTimeout(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...options.request,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Iranium-ElizaOS-Bridge/1.0',
        ...(options.request?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRssSource(source, options = {}) {
  const response = await fetchWithTimeout(source.url, options);
  if (!response.ok) {
    throw new Error(`${source.name} returned ${response.status}`);
  }
  const xml = await response.text();
  return parseRss(xml, source);
}

async function fetchLiveArticles(options = {}) {
  const sources = options.sources || LIVE_SOURCES;
  const results = await Promise.allSettled(sources.map((source) => fetchRssSource(source, options)));
  const articles = results
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter((article) => article.title)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const deduped = [];
  const seen = new Set();
  for (const article of articles) {
    const key = article.link || article.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(article);
  }

  const relevant = deduped.filter(isRelevantArticle);
  return (relevant.length >= 3 ? relevant : deduped).slice(0, 10);
}

function isRelevantArticle(article) {
  const haystack = `${article.title} ${article.description}`.toLowerCase();
  return FOCUS_TERMS.some((term) => haystack.includes(term));
}

function classifyKind(article) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  if (/(missile|strike|drone|airstrike|attack)/.test(text)) {
    return 'missile-strike-alert';
  }
  if (/(ship|shipping|hormuz|red sea|tanker|suez|gulf)/.test(text)) {
    return 'shipping-disruption';
  }
  if (/(oil|crude|opec|barrel|energy|refinery|pipeline)/.test(text)) {
    return 'oil-price-spike';
  }
  if (/(sanction|embargo|tariff|restriction)/.test(text)) {
    return 'sanctions-watch';
  }
  if (/(nuclear|uranium|iaea|enrich)/.test(text)) {
    return 'nuclear-negotiation';
  }
  return 'regional-tension';
}

function scoreArticle(article) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  let severity = 4;
  let oilImpact = 1;
  let marketImpact = -2;

  if (/(missile|strike|drone|airstrike|attack|killed|war)/.test(text)) {
    severity += 4;
    marketImpact -= 8;
  }
  if (/(oil|crude|opec|barrel|energy|refinery|pipeline)/.test(text)) {
    severity += 2;
    oilImpact += 8;
    marketImpact -= 5;
  }
  if (/(hormuz|shipping|tanker|suez|red sea|gulf)/.test(text)) {
    severity += 2;
    oilImpact += 6;
    marketImpact -= 4;
  }
  if (/(sanction|nuclear|iran|tehran)/.test(text)) {
    severity += 1;
    oilImpact += 2;
    marketImpact -= 3;
  }

  return {
    severity: clamp(Math.round(severity), 1, 10),
    oilImpact: clamp(Math.round(oilImpact), -10, 20),
    marketImpact: clamp(Math.round(marketImpact), -25, 15),
  };
}

function buildHeuristicEvents(articles, now = new Date()) {
  return articles.slice(0, 6).map((article, index) => {
    const score = scoreArticle(article);
    return {
      id: `live-${Date.parse(article.publishedAt) || now.getTime()}-${index + 1}`,
      kind: classifyKind(article),
      severity: score.severity,
      oilImpact: score.oilImpact,
      marketImpact: score.marketImpact,
      summary: summarizeArticle(article),
      timestamp: article.publishedAt || now.toISOString(),
      sourceTitle: article.sourceName,
      sourceUrl: article.link || article.sourceUrl,
    };
  });
}

function summarizeArticle(article) {
  const title = stripHtml(article.title);
  const description = stripHtml(article.description);
  if (!description || description === title) {
    return title.slice(0, 220);
  }
  return `${title}: ${description}`.slice(0, 240);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEvent(event, index, now = new Date()) {
  const timestamp = event.timestamp || event.publishedAt || now.toISOString();
  return {
    id: String(event.id || `event-${index + 1}`),
    kind: String(event.kind || 'regional-tension'),
    severity: clamp(Number(event.severity || 5), 1, 10),
    oilImpact: clamp(Number(event.oilImpact || 0), -10, 20),
    marketImpact: clamp(Number(event.marketImpact || 0), -25, 15),
    summary: String(event.summary || 'Risk signal received.').slice(0, 260),
    timestamp,
    sourceTitle: event.sourceTitle ? String(event.sourceTitle) : '',
    sourceUrl: event.sourceUrl ? String(event.sourceUrl) : '',
  };
}

const feedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'severity', 'oilImpact', 'marketImpact', 'summary', 'timestamp', 'sourceTitle', 'sourceUrl'],
        properties: {
          id: { type: 'string' },
          kind: {
            type: 'string',
            enum: [
              'regional-tension',
              'oil-price-spike',
              'missile-strike-alert',
              'shipping-disruption',
              'sanctions-watch',
              'nuclear-negotiation',
              'energy-supply-shift',
            ],
          },
          severity: { type: 'integer', minimum: 1, maximum: 10 },
          oilImpact: { type: 'integer', minimum: -10, maximum: 20 },
          marketImpact: { type: 'integer', minimum: -25, maximum: 15 },
          summary: { type: 'string' },
          timestamp: { type: 'string' },
          sourceTitle: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
      },
    },
  },
};

const replySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'signalPriority', 'oilPremium'],
  properties: {
    message: { type: 'string' },
    signalPriority: { type: 'integer', minimum: 1, maximum: 10 },
    oilPremium: { type: 'integer', minimum: -10, maximum: 20 },
  },
};

async function callOpenAIJson(config, request, options = {}) {
  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/responses`, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    request: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI request failed with ${response.status}: ${body.slice(0, 240)}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) {
    throw new Error('OpenAI response did not include output text');
  }
  return JSON.parse(text);
}

function extractResponseText(payload) {
  if (payload.output_text) {
    return payload.output_text;
  }

  const fragments = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) {
        fragments.push(content.text);
      } else if (content.text) {
        fragments.push(content.text);
      }
    }
  }
  return fragments.join('').trim();
}

async function buildOpenAIEvents(articles, options = {}) {
  const env = options.env || process.env;
  const config = getOpenAIConfig(env);
  const now = options.now || new Date();
  const system = [
    'You are Iranium, an ElizaOS risk-intelligence character.',
    'Transform public-source headlines into high-level risk events for a token utility dashboard.',
    'Do not invent confirmed attacks, military orders, targets, or tactical advice.',
    'Use cautious OSINT language and keep summaries suitable for a market and energy risk feed.',
  ].join(' ');
  const user = JSON.stringify({
    now: now.toISOString(),
    articles: articles.map((article) => ({
      sourceName: article.sourceName,
      title: article.title,
      description: article.description,
      link: article.link,
      publishedAt: article.publishedAt,
    })),
  });

  const payload = await callOpenAIJson(
    config,
    {
      model: config.model,
      store: false,
      max_output_tokens: 1400,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: user }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'iranium_live_feed',
          strict: true,
          schema: feedSchema,
        },
      },
    },
    options,
  );

  return {
    events: toArray(payload.events),
    model: config.model,
  };
}

async function buildVisualizerPayload(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const cacheMs = options.cacheMs ?? getCacheMs(env);

  if (!options.disableCache && payloadCache.payload && payloadCache.expiresAt > now.getTime()) {
    return payloadCache.payload;
  }

  const staticFeed = loadStaticFeed(options.rootDir);
  const staticEvents = toArray(staticFeed.events).map((event, index) => normalizeEvent(event, index, now));
  const articles = await fetchLiveArticles(options).catch(() => []);
  const config = getOpenAIConfig(env);
  let events;
  let mode;
  let model = null;

  if (articles.length && config.apiKey) {
    try {
      const openAIResult = await buildOpenAIEvents(articles, options);
      events = openAIResult.events.map((event, index) => normalizeEvent(event, index, now));
      mode = 'openai-live';
      model = openAIResult.model;
    } catch {
      events = buildHeuristicEvents(articles, now).map((event, index) => normalizeEvent(event, index, now));
      mode = 'heuristic-live';
    }
  } else if (articles.length) {
    events = buildHeuristicEvents(articles, now).map((event, index) => normalizeEvent(event, index, now));
    mode = 'heuristic-live';
  } else {
    events = staticEvents;
    mode = 'static-fallback';
  }

  const payload = {
    agent: mode === 'openai-live' ? 'elizaos-openai-bridge' : 'elizaos-live-bridge',
    generatedAt: now.toISOString(),
    mode,
    live: mode !== 'static-fallback',
    model,
    sourceCount: articles.length,
    sources: articles.slice(0, 6).map((article) => ({
      title: article.title,
      sourceName: article.sourceName,
      url: article.link || article.sourceUrl,
      publishedAt: article.publishedAt,
    })),
    events,
  };

  if (!options.disableCache && cacheMs > 0) {
    payloadCache = {
      expiresAt: now.getTime() + cacheMs,
      payload,
    };
  }

  return payload;
}

async function buildAgentReply(query, requestEvents, options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const events = toArray(requestEvents).length
    ? toArray(requestEvents).map((event, index) => normalizeEvent(event, index, now))
    : toArray(loadStaticFeed(options.rootDir).events).map((event, index) => normalizeEvent(event, index, now));
  const config = getOpenAIConfig(env);

  if (!config.apiKey) {
    return buildFallbackReply(query, events);
  }

  const system = [
    'You are Iranium, an ElizaOS commentary agent for a public-source risk dashboard.',
    'Answer in one concise dashboard-style sentence prefixed with "ELIZA OS //".',
    'Do not provide operational military instructions, target selection, or tactical guidance.',
    'Ground the reply only in the supplied events and use uncertainty-aware language.',
  ].join(' ');

  try {
    const payload = await callOpenAIJson(
      config,
      {
        model: config.model,
        store: false,
        max_output_tokens: 500,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  query: query || 'brief',
                  events,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'iranium_agent_reply',
            strict: true,
            schema: replySchema,
          },
        },
      },
      options,
    );
    return {
      message: ensureElizaPrefix(payload.message),
      signalPriority: clamp(Number(payload.signalPriority || 5), 1, 10),
      oilPremium: clamp(Number(payload.oilPremium || 0), -10, 20),
      model: config.model,
    };
  } catch {
    return buildFallbackReply(query, events);
  }
}

function buildFallbackReply(query, events) {
  const prompt = String(query || 'brief').toLowerCase();
  const highestSeverity = Math.max(5, ...events.map((event) => Number(event.severity || 0)));
  const highestOil = Math.max(0, ...events.map((event) => Number(event.oilImpact || 0)));
  let message = 'Threat model reviewed. Public-source grid remains in monitoring posture.';

  if (prompt.includes('escalate')) {
    message = 'Escalation risk marked for defensive monitoring; no operational action is recommended.';
  } else if (prompt.includes('signal')) {
    message = 'Risk signal emitted from current public-source energy and regional indicators.';
  } else if (prompt.includes('brief') || prompt.includes('commentary')) {
    message = 'Briefing compiled from live-source context with elevated energy and regional risk watch.';
  }

  return {
    message: `ELIZA OS // ${message}`,
    signalPriority: highestSeverity,
    oilPremium: highestOil,
    model: null,
  };
}

function ensureElizaPrefix(message) {
  const value = String(message || 'Threat model reviewed.');
  return value.toUpperCase().startsWith('ELIZA OS //') ? value : `ELIZA OS // ${value}`;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }
  if (typeof req.on !== 'function') {
    return {};
  }

  const body = await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
  return body ? JSON.parse(body) : {};
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(payload);
    return;
  }
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function sendEmpty(res, status) {
  if (typeof res.status === 'function') {
    res.status(status).end();
    return;
  }
  res.statusCode = status;
  res.end();
}

async function handleBridgeRequest(req, res, options = {}) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204);
    return;
  }

  try {
    if (req.method === 'GET') {
      sendJson(res, 200, await buildVisualizerPayload(options));
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 200, await buildAgentReply(body.query, body.events || [], options));
      return;
    }

    sendJson(res, 405, { error: 'method not allowed' });
  } catch (error) {
    sendJson(res, 500, {
      error: 'bridge failed',
      message: process.env.IRANIUM_DEBUG === 'true' ? error.message : 'live bridge unavailable',
    });
  }
}

module.exports = {
  LIVE_SOURCES,
  buildAgentReply,
  buildFallbackReply,
  buildHeuristicEvents,
  buildOpenAIEvents,
  buildVisualizerPayload,
  fetchLiveArticles,
  handleBridgeRequest,
  loadStaticFeed,
  normalizeEvent,
  parseRss,
};
