require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3109;

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow future-media.ch (any subdomain), asadmindset.com, localhost
    if (
      origin.includes('future-media.ch') ||
      origin.includes('asadmindset.com') ||
      origin.includes('localhost') ||
      origin.startsWith('blob:')
    ) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  credentials: true
}));

app.use(express.static('public'));
app.use(express.json());

// ─── Gmail Transporter ─────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// ─── Google Calendar ───────────────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://voiceai.asadmindset.com/auth/google/callback'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({
  version: 'v3',
  auth: oauth2Client
});

// ─── Database Setup ────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'leads.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    company TEXT,
    phone TEXT,
    email TEXT,
    goal TEXT,
    challenge TEXT,
    budget TEXT,
    start_date TEXT,
    social_media_experience TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    duration_s INTEGER DEFAULT 0,
    msg_count INTEGER DEFAULT 0,
    user_count INTEGER DEFAULT 0,
    ai_count INTEGER DEFAULT 0,
    transcript TEXT,
    summary TEXT,
    lang TEXT DEFAULT 'de',
    contact_email TEXT DEFAULT '',
    contact_phone TEXT DEFAULT ''
  )
`);

try {
  db.exec(`ALTER TABLE conversations ADD COLUMN contact_email TEXT DEFAULT ''`);
} catch {}

try {
  db.exec(`ALTER TABLE conversations ADD COLUMN contact_phone TEXT DEFAULT ''`);
} catch {}

console.log('Database ready: leads.db');

// ─── Instructions ──────────────────────────────────────────────────────────────
const instructions = `Du bisch Asad, de KI-Assistent vo Future Media — ere modernen Social-Media-Marketing-Agentur us dr Schwiiz.

DINI UFGAB: Qualifizier de Interessent Schritt für Schritt und buech am Schluss en Termin.

SPRACH-REGELN:
- Red IMMER uf Schwiizerdütsch
- Kurzi, direkte Antwörte — wie es es echts Telefongsrpäch wär

FUTURE MEDIA:
- Mir häufe Unternehme bi 3 Sache: Mitarbeitende finde, Chunde gwünne, Sichtbarkeit ufbaue
- Koschtlose Beratig
- Tel: 078 799 35 17 | info@future-media.ch
- Standort: Bern und Zürich

WICHTIG:
- Stell NUR EI FRAG AUF MÄUS
- Immer positiv und professionell bliibe`;

const langPrefix = {
  de: 'Antworte IMMER auf Schweizerdeutsch.',
  en: 'ALWAYS respond in English.',
  fa: 'همیشه به فارسی پاسخ بده.',
};

// ─── OpenAI: Realtime session ──────────────────────────────────────────────────
app.get('/session', async (req, res) => {
  try {
    const voice = req.query.voice || 'alloy';
    const threshold = req.query.threshold || 0.8;
    const silence = req.query.silence || 600;
    const lang = req.query.lang || 'de';

    const fullInstr = (langPrefix[lang] || langPrefix.de) + '\n\n' + instructions;

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice,
        instructions: fullInstr,
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: parseFloat(threshold),
          silence_duration_ms: parseInt(silence),
        },
      }),
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OpenAI: Text chat ─────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        stream: true,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: message },
        ],
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data:'));

      for (const line of lines) {
        const raw = line.replace('data: ', '');

        if (raw === '[DONE]') continue;

        try {
          const text = JSON.parse(raw).choices?.[0]?.delta?.content || '';
          if (text) res.write(text);
        } catch {}
      }
    }

    res.end();
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// ─── ElevenLabs: Session ───────────────────────────────────────────────────────
app.get('/el-session', (req, res) => {
  const agentId = 'agent_9001kqq67q9bfm1bkybvap126qxw';
  res.json({ agent_id: agentId });
});

app.get('/el-config', (req, res) => {
  res.json({
    agentId: process.env.ELEVENLABS_AGENT_ID || '(not set)',
    hasKey: !!process.env.ELEVENLABS_API_KEY,
  });
});

// ─── Webhook: Lead speichern ───────────────────────────────────────────────────
app.post('/webhook/lead', (req, res) => {
  try {
    const {
      name,
      company,
      phone,
      email,
      goal,
      challenge,
      budget,
      start_date,
      social_media_experience,
      notes
    } = req.body;

    const stmt = db.prepare(`
      INSERT INTO leads 
      (name, company, phone, email, goal, challenge, budget, start_date, social_media_experience, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name || '',
      company || '',
      phone || '',
      email || '',
      goal || '',
      challenge || '',
      budget || '',
      start_date || '',
      social_media_experience || '',
      notes || ''
    );

    console.log('New lead saved:', name, email, new Date().toISOString());

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Lead save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Leads anzeigen Admin ──────────────────────────────────────────────────────
app.get('/admin/leads', (req, res) => {
  const secret = req.query.secret;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();

  res.json(leads);
});

// ─── Latest conversation ───────────────────────────────────────────────────────
app.get('/latest-conversation', (req, res) => {
  const row = db.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get();

  res.json({
    id: row ? row.id : null
  });
});

// ─── Update contact ────────────────────────────────────────────────────────────
app.post('/update-contact', (req, res) => {
  try {
    const { conversation_id, email, phone } = req.body;

    if (!conversation_id) {
      return res.status(400).json({ error: 'No conversation_id' });
    }

    db.prepare(`
      UPDATE conversations 
      SET contact_email = ?, contact_phone = ? 
      WHERE id = ?
    `).run(email || '', phone || '', conversation_id);

    console.log('Contact updated for conversation', conversation_id, email, phone);

    res.json({ success: true });
  } catch (err) {
    console.error('Update contact error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Create conversation ───────────────────────────────────────────────────────
app.post('/create-conversation', (req, res) => {
  try {
    const { lang } = req.body;

    const result = db.prepare(`
      INSERT INTO conversations 
      (duration_s, msg_count, user_count, ai_count, transcript, summary, lang)
      VALUES (0, 0, 0, 0, '[]', '', ?)
    `).run(lang || 'de');

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update conversation ───────────────────────────────────────────────────────
app.post('/update-conversation', async (req, res) => {
  try {
    const { id, transcript, duration_s, lang } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'No id' });
    }

    const userMsgs = transcript.filter(m => m.role === 'user');
    const aiMsgs = transcript.filter(m => m.role === 'ai');

    let summary = '';

    try {
      const transcriptText = transcript
        .map(m => `${m.role === 'ai' ? 'AI' : 'Besucher'}: ${m.text}`)
        .join('\n');

      const sumRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 200,
          messages: [
            {
              role: 'system',
              content: 'Fasse das Verkaufsgespräch in 3-4 Sätzen zusammen. Erwähne: Branche, Hauptproblem, Ziel, ob Termin vereinbart. Auf Deutsch.'
            },
            {
              role: 'user',
              content: transcriptText
            }
          ]
        })
      });

      const sumData = await sumRes.json();
      summary = sumData.choices?.[0]?.message?.content || '';
    } catch (e) {
      console.warn('Summary failed:', e.message);
    }

    db.prepare(`
      UPDATE conversations
      SET duration_s = ?, msg_count = ?, user_count = ?, ai_count = ?, transcript = ?, summary = ?, lang = ?
      WHERE id = ?
    `).run(
      duration_s || 0,
      transcript.length,
      userMsgs.length,
      aiMsgs.length,
      JSON.stringify(transcript),
      summary,
      lang || 'de',
      id
    );

    console.log('Conversation updated, id:', id, '| msgs:', transcript.length);

    res.json({ success: true });
  } catch (err) {
    console.error('Update conversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Save conversation ─────────────────────────────────────────────────────────
app.post('/save-conversation', async (req, res) => {
  try {
    const { transcript, duration_s, lang } = req.body;

    if (!transcript || transcript.length === 0) {
      return res.json({
        success: false,
        reason: 'empty'
      });
    }

    const userMsgs = transcript.filter(m => m.role === 'user');
    const aiMsgs = transcript.filter(m => m.role === 'ai');

    let summary = '';

    try {
      const transcriptText = transcript
        .map(m => `${m.role === 'ai' ? 'AI' : 'Besucher'}: ${m.text}`)
        .join('\n');

      const sumRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 200,
          messages: [
            {
              role: 'system',
              content: 'Fasse das Verkaufsgespräch in 3-4 Sätzen zusammen. Erwähne Branche, Hauptproblem, Ziel und ob Termin vereinbart wurde. Auf Deutsch.'
            },
            {
              role: 'user',
              content: transcriptText
            }
          ]
        })
      });

      const sumData = await sumRes.json();
      summary = sumData.choices?.[0]?.message?.content || '';
    } catch (e) {
      console.warn('Summary generation failed:', e.message);
    }

    const stmt = db.prepare(`
      INSERT INTO conversations 
      (duration_s, msg_count, user_count, ai_count, transcript, summary, lang)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      duration_s || 0,
      transcript.length,
      userMsgs.length,
      aiMsgs.length,
      JSON.stringify(transcript),
      summary,
      lang || 'de'
    );

    console.log('Conversation saved, id:', result.lastInsertRowid, '| msgs:', transcript.length);

    res.json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Save conversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin conversations ───────────────────────────────────────────────────────
app.get('/admin/conversations', (req, res) => {
  const secret = req.query.secret;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const conversations = db.prepare(`
    SELECT id, started_at, duration_s, msg_count, user_count, ai_count,
           summary, lang, contact_email, contact_phone
    FROM conversations 
    ORDER BY started_at DESC
  `).all();

  res.json(conversations);
});

app.get('/admin/conversations/:id', (req, res) => {
  const secret = req.query.secret;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);

  if (!conv) {
    return res.status(404).json({ error: 'Not found' });
  }

  conv.transcript = JSON.parse(conv.transcript || '[]');

  res.json(conv);
});

app.delete('/admin/conversations/:id', (req, res) => {
  const secret = req.query.secret;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Calendar events ───────────────────────────────────────────────────────────
app.get('/calendar/events', async (req, res) => {
  try {
    const calendarId = req.query.cal || process.env.GOOGLE_CALENDAR_ID || 'primary';

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).map(e => ({
      id: e.id,
      title: e.summary || '—',
      description: e.description || '',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      attendees: (e.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName || '',
        status: a.responseStatus,
      })),
    }));

    res.json({
      calendar: calendarId,
      date: now.toLocaleDateString('de-CH'),
      events
    });
  } catch (err) {
    console.error('Calendar events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Calendar slots ────────────────────────────────────────────────────────────
app.get('/calendar/slots', async (req, res) => {
  try {
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: weekEnd.toISOString(),
        items: [{ id: calId }],
      },
    });

    const busy = response.data.calendars?.[calId]?.busy || [];

    const slots = [];

    for (let d = 1; d <= 7; d++) {
      const day = new Date(now);
      day.setDate(day.getDate() + d);
      day.setHours(0, 0, 0, 0);

      if (day.getDay() === 0 || day.getDay() === 6) continue;

      for (let h = 9; h < 17; h++) {
        for (let m = 0; m < 60; m += 30) {
          const slotStart = new Date(day);
          slotStart.setHours(h, m, 0, 0);

          const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

          const isBusy = busy.some(b =>
            new Date(b.start) < slotEnd && new Date(b.end) > slotStart
          );

          if (!isBusy) {
            slots.push({
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
              label: slotStart.toLocaleString('de-CH', {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Zurich'
              }),
            });
          }
        }
      }
    }

    res.json({
      slots: slots.slice(0, 10)
    });
  } catch (err) {
    console.error('Calendar slots error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Calendar next slot ────────────────────────────────────────────────────────
app.get('/calendar/next-slot', async (req, res) => {
  try {
    // Artificial delay so ElevenLabs typing sound plays
    await new Promise(r => setTimeout(r, 3000));
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const now = new Date();

    const start = new Date(now);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    const fbRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: calId }]
      },
    });

    const busy = (fbRes.data.calendars?.[calId]?.busy || []).map(b => ({
      s: new Date(b.start),
      e: new Date(b.end),
    }));

    for (let d = 0; d < 14; d++) {
      const day = new Date(start);
      day.setDate(day.getDate() + d);

      const dow = day.getDay();

      if (dow === 0 || dow === 6) continue;

      for (let h = 9; h < 17; h++) {
        for (let m = 0; m < 60; m += 30) {
          const slotStart = new Date(day);
          slotStart.setHours(h, m, 0, 0);

          const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

          const isBusy = busy.some(b => b.s < slotEnd && b.e > slotStart);

          if (!isBusy) {
            const label = slotStart.toLocaleString('de-CH', {
              weekday: 'long',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Zurich',
            });

            return res.json({
              available: true,
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
              label,
            });
          }
        }
      }
    }

    res.json({
      available: false,
      message: 'Keine freien Slots in den nächsten 14 Tagen'
    });
  } catch (err) {
    console.error('Next-slot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Calendar check slot ───────────────────────────────────────────────────────
app.get('/calendar/check-slot', async (req, res) => {
  try {
    // Artificial delay so ElevenLabs typing sound plays
    await new Promise(r => setTimeout(r, 3000));
    const calId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    const requested = new Date(req.query.datetime);

    if (isNaN(requested)) {
      return res.status(400).json({ error: 'Invalid datetime' });
    }

    const windowStart = new Date(requested.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(requested.getTime() + 4 * 60 * 60 * 1000);

    const fbRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        items: [{ id: calId }]
      },
    });

    const busy = (fbRes.data.calendars?.[calId]?.busy || []).map(b => ({
      s: new Date(b.start),
      e: new Date(b.end),
    }));

    const slotEnd = new Date(requested.getTime() + 30 * 60 * 1000);

    const isReqBusy = busy.some(b => b.s < slotEnd && b.e > requested);

    if (!isReqBusy) {
      const label = requested.toLocaleString('de-CH', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Zurich',
      });

      return res.json({
        available: true,
        start: requested.toISOString(),
        end: slotEnd.toISOString(),
        label
      });
    }

    for (let offset = 30; offset <= 180; offset += 30) {
      for (const sign of [1, -1]) {
        const candidate = new Date(requested.getTime() + sign * offset * 60 * 1000);
        const candidateEnd = new Date(candidate.getTime() + 30 * 60 * 1000);

        const h = candidate.getHours();
        const dow = candidate.getDay();

        if (dow === 0 || dow === 6 || h < 9 || h >= 17) continue;

        const isBusy = busy.some(b => b.s < candidateEnd && b.e > candidate);

        if (!isBusy) {
          const label = candidate.toLocaleString('de-CH', {
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Zurich',
          });

          return res.json({
            available: false,
            nearest: true,
            start: candidate.toISOString(),
            end: candidateEnd.toISOString(),
            label
          });
        }
      }
    }

    res.json({
      available: false,
      nearest: false,
      message: 'Kein freier Slot in der Nähe gefunden'
    });
  } catch (err) {
    console.error('Check-slot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Calendar book ─────────────────────────────────────────────────────────────
app.post('/calendar/book', async (req, res) => {
  try {
    const {
      start,
      end,
      name,
      email,
      phone,
      business,
      budget,
      team_size
    } = req.body;

    const computedEnd = end || new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();

    const description = [
      `Name: ${name || '—'}`,
      `Email: ${email || '—'}`,
      `Telefon: ${phone || '—'}`,
      `Unternehmen: ${business || '—'}`,
      `Budget: ${budget || '—'}`,
      `Teamgrösse: ${team_size || '—'}`,
    ].join('\n');

    let eventId = null;
    let eventLink = null;

    try {
      const event = await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        requestBody: {
          summary: `15-Min Beratung — ${name || 'Kunde'}`,
          description,
          start: {
            dateTime: start,
            timeZone: 'Europe/Zurich'
          },
          end: {
            dateTime: computedEnd,
            timeZone: 'Europe/Zurich'
          },
          attendees: email ? [{ email }] : [],
        },
      });

      eventId = event.data.id;
      eventLink = event.data.htmlLink;

      console.log('Calendar event created:', eventId, name, start);
    } catch (calErr) {
      console.warn('Calendar write skipped:', calErr.message);
    }

    const apptDate = new Date(start).toLocaleString('de-CH', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Zurich',
    });

    await mailer.sendMail({
      from: `"Future Media AI" <${process.env.MAIL_USER}>`,
      to: process.env.MAIL_USER,
      subject: `📅 Neuer Termin: ${name || 'Kunde'} — ${apptDate}`,
      html: `
        <h2>Neuer Beratungstermin</h2>
        <p><strong>Termin:</strong> ${apptDate}</p>
        <p><strong>Name:</strong> ${name || '—'}</p>
        <p><strong>Email:</strong> ${email || '—'}</p>
        <p><strong>Telefon:</strong> ${phone || '—'}</p>
        <p><strong>Unternehmen:</strong> ${business || '—'}</p>
        <p><strong>Budget:</strong> ${budget || '—'}</p>
        <p><strong>Teamgrösse:</strong> ${team_size || '—'}</p>
        ${eventLink ? `<p><a href="${eventLink}">Im Kalender ansehen</a></p>` : ''}
      `
    });

    if (email && /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(email)) {
      await mailer.sendMail({
        from: `"Future Media GmbH" <${process.env.MAIL_USER}>`,
        to: email,
        subject: `✅ Dein Beratungstermin – ${apptDate}`,
        html: `
          <h2>Termin bestätigt</h2>
          <p>Hallo ${name || ''},</p>
          <p>vielen Dank. Dein kostenloses Gespräch ist eingetragen.</p>
          <p><strong>Termin:</strong> ${apptDate}</p>
          <p>Bei Fragen erreichst du uns unter info@future-media.ch oder 078 799 35 17.</p>
          <p>Future Media GmbH</p>
        `
      });
    }

    res.json({
      success: true,
      eventId,
      link: eventLink,
      appointment: apptDate
    });
  } catch (err) {
    console.error('Calendar book error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Voice AI running on http://localhost:${PORT}`);
});