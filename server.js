require('dotenv').config();
const express    = require('express');
const Database   = require('better-sqlite3');
const path       = require('path');
const nodemailer = require('nodemailer');
const app  = express();
const PORT = process.env.PORT || 3109;

// ─── Gmail Transporter ─────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

// ─── Google Calendar ───────────────────────────────────────────────────────────
const { google } = require('googleapis');
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://voiceai.asadmindset.com/auth/google/callback'
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

app.use(express.static('public'));
app.use(express.json());

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
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    duration_s    INTEGER DEFAULT 0,
    msg_count     INTEGER DEFAULT 0,
    user_count    INTEGER DEFAULT 0,
    ai_count      INTEGER DEFAULT 0,
    transcript    TEXT,
    summary       TEXT,
    lang          TEXT DEFAULT 'de',
    contact_email TEXT DEFAULT '',
    contact_phone TEXT DEFAULT ''
  )
`);

// ── Migrate existing DB: add columns if missing ───────────────────────────────
try { db.exec(`ALTER TABLE conversations ADD COLUMN contact_email TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN contact_phone TEXT DEFAULT ''`); } catch {}

console.log('Database ready: leads.db');

// ─── Instructions ──────────────────────────────────────────────────────────────
const instructions = `Du bisch Asad, de KI-Assistent vo Future Media — ere modernen Social-Media-Marketing-Agentur us dr Schwiiz.

DINI UFGAB: Qualifizier de Interessent Schritt für Schritt und buech am Schluss en Termin.

SPRACH-REGELN:
- Red IMMER uf Schwiizerdütsch (Schweizer Hochdeutsch mit schwiizer Ussdrück)
- Verwend: "grüezi", "merci viumau", "en Guete", "gäll", "öppis", "chli", "lueg mau"
- Sag "ade" statt "tschüss", "Weggli" statt "Brötchen"
- Kurzi, direkte Antwörte — wie es es echts Telefongsrpäch wär

FUTURE MEDIA:
- Mir häufe Unternehme bi 3 Sache: Mitarbeitende finde, Chunde gwünne, Sichtbarkeit ufbaue
- Ergebnis in 90 Täg
- Koschtlose Beratig: calendly.com/future-media-gmbh/kostenlose-erstberatung
- Tel: 078 799 35 17 | info@future-media.ch
- Standort: Bern und Zürich
- Kunde: Victorinox, Mazda, SBB, Transsicura, Spitex, Jobdoor u.v.m.

QUALIFIZIERUNGS-FLOW (Schritt für Schritt — NUR EI FRAG AUF MÄUS!):

Schritt 1 — Begrüssung:
"Grüezi! Ich bin Asad vom Team vo Future Media. Schön, dass du dich gmäudet hesch! Darf ich dich churz öppis frage, damit ich dir optimal häufe cha?"

Schritt 2 — Unternehmen versteh:
"Verzeu mir churz — was machsch du genau? Was isch dis Unternehme?"

Schritt 3 — Problem identifiziere:
"Was isch aktuell dini grössti Useforderig im Bereich Marketing? Was bereitet dir Chopfweh?"

Schritt 4 — Ziel versteh:
"Was wärsch du gärn i de nächste 90 Täg erreiche? Was isch dis Ziel?"

Schritt 5 — Aktuelle Situation:
"Wie gwinsch du aktuell Nöichunde oder Mitarbeitende? Nützisch scho Social Media?"

Schritt 6 — Budget:
"Wieviel wärsch du bereit z'investiere, um das Problem z'löse?"

Schritt 7 — Entscheidungsträger:
"Bisch du de Enscheider, oder ghört da no öpper anders derzue?"

Schritt 8 — Start:
"Super! Ab wenn chönntisch du starte?"

Schritt 9 — Kontaktdaten:
"Perfekt, ich mach dir gärn en kostenlosen Beratigstermin. Darf ich no dine Name, E-Mail und Telefonnummer ha?"

Schritt 10 — Abschluss:
"Merci viumau! Ich schicki dr jetzt de Link für ds koschtlose Erstgsrpäch: calendly.com/future-media-gmbh/kostenlose-erstberatung — mir fröie üs uf ds Gsrpäch!"

WICHTIG:
- Stell NUR EI FRAG AUF MÄUS
- Wenn öpper sait er het kei Zit → vereinbar en Rückruf-Termin
- Wenn öpper fragt über Prise → "Das bsprächemer im kostenlosen Beratigsgsprach"
- Immer positiv und professionell bliibe`;

const langPrefix = {
  de: 'Antworte IMMER auf Schweizerdeutsch.',
  en: 'ALWAYS respond in English.',
  fa: 'همیشه به فارسی پاسخ بده.',
};

// ─── OpenAI: Realtime session ──────────────────────────────────────────────────
app.get('/session', async (req, res) => {
  try {
    const voice     = req.query.voice     || 'alloy';
    const threshold = req.query.threshold || 0.8;
    const silence   = req.query.silence   || 600;
    const lang      = req.query.lang      || 'de';
    const fullInstr = (langPrefix[lang] || langPrefix.de) + '\n\n' + instructions;

    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OpenAI: Text chat ─────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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

  const reader  = response.body.getReader();
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
});

// ─── ElevenLabs: Session ───────────────────────────────────────────────────────
app.get('/el-session', (req, res) => {
  const agentId = 'agent_9001kqq67q9bfm1bkybvap126qxw';
  res.json({ agent_id: agentId });
});

app.get('/el-config', (req, res) => {
  res.json({
    agentId: process.env.ELEVENLABS_AGENT_ID || '(not set)',
    hasKey:  !!process.env.ELEVENLABS_API_KEY,
  });
});

// ─── Webhook: Lead speichern ───────────────────────────────────────────────────
app.post('/webhook/lead', (req, res) => {
  try {
    const {
      name, company, phone, email,
      goal, challenge, budget,
      start_date, social_media_experience, notes
    } = req.body;

    const stmt = db.prepare(`
      INSERT INTO leads (name, company, phone, email, goal, challenge, budget, start_date, social_media_experience, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name || '', company || '', phone || '', email || '',
      goal || '', challenge || '', budget || '',
      start_date || '', social_media_experience || '', notes || ''
    );

    console.log('New lead saved:', name, email, new Date().toISOString());
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Lead save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Leads anzeigen (Admin) ────────────────────────────────────────────────────
app.get('/admin/leads', (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const leads = db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all();
  res.json(leads);
});

// ─── Send Transcript via Email ─────────────────────────────────────────────────
app.post('/send-transcript', async (req, res) => {
  try {
    const { transcript, duration } = req.body;
    if (!transcript || transcript.length === 0) {
      return res.json({ success: false, reason: 'empty' });
    }

    const now     = new Date();
    const dateStr = now.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });

    // Build HTML email
    const rows = transcript.map(m => {
      const isUser  = m.role === 'user';
      const bg      = isUser ? '#f0f4ff' : '#f0fff8';
      const label   = isUser ? '🎤 Besucher' : '🤖 Asad (AI)';
      const color   = isUser ? '#3b5bdb'    : '#1a7f5a';
      return `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #eee;">
            <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:4px;">${label}</div>
            <div style="font-size:14px;color:#1a1a1a;line-height:1.5;background:${bg};
              padding:8px 12px;border-radius:8px;">${m.text}</div>
          </td>
        </tr>`;
    }).join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:620px;margin:30px auto;background:#fff;border-radius:14px;
    box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a7f5a,#5dcaa5);padding:24px 28px;">
      <div style="color:#fff;font-size:20px;font-weight:700;">Future Media – Voice AI</div>
      <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">
        Gesprächsprotokoll · ${dateStr}${duration ? ' · ' + duration : ''}
      </div>
    </div>

    <!-- Transcript -->
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-collapse:collapse;">
      ${rows}
    </table>

    <!-- Footer -->
    <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #eee;
      font-size:11px;color:#999;text-align:center;">
      Future Media GmbH · Bern &amp; Zürich · info@future-media.ch
    </div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
      from:    '"Future Media AI" <' + (process.env.MAIL_USER) + '>',
      to:      process.env.MAIL_USER,
      subject: `🎙️ Voice-Gespräch – ${dateStr}`,
      html,
    });

    console.log('Transcript email sent:', dateStr);
    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Get latest conversation ID ───────────────────────────────────────────────
app.get('/latest-conversation', (req, res) => {
  const row = db.prepare('SELECT id FROM conversations ORDER BY id DESC LIMIT 1').get();
  res.json({ id: row ? row.id : null });
});

// ─── Update conversation contact info ─────────────────────────────────────────
app.post('/update-contact', (req, res) => {
  try {
    const { conversation_id, email, phone } = req.body;
    if (!conversation_id) return res.status(400).json({ error: 'No conversation_id' });
    db.prepare(`
      UPDATE conversations SET contact_email=?, contact_phone=? WHERE id=?
    `).run(email || '', phone || '', conversation_id);
    console.log('Contact updated for conversation', conversation_id, email, phone);
    res.json({ success: true });
  } catch (err) {
    console.error('Update contact error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Create empty conversation (to get ID early) ──────────────────────────────
app.post('/create-conversation', (req, res) => {
  try {
    const { lang } = req.body;
    const result = db.prepare(`
      INSERT INTO conversations (duration_s, msg_count, user_count, ai_count, transcript, summary, lang)
      VALUES (0, 0, 0, 0, '[]', '', ?)
    `).run(lang || 'de');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update conversation after session ends ────────────────────────────────────
app.post('/update-conversation', async (req, res) => {
  try {
    const { id, transcript, duration_s, lang } = req.body;
    if (!id) return res.status(400).json({ error: 'No id' });

    const userMsgs = transcript.filter(m => m.role === 'user');
    const aiMsgs   = transcript.filter(m => m.role === 'ai');

    // Generate summary
    let summary = '';
    try {
      const transcriptText = transcript
        .map(m => `${m.role === 'ai' ? 'AI' : 'Besucher'}: ${m.text}`)
        .join('\n');
      const sumRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{ 'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json' },
        body: JSON.stringify({
          model:'gpt-4o-mini', max_tokens:200,
          messages:[
            { role:'system', content:'Fasse das Verkaufsgespräch in 3-4 Sätzen zusammen. Erwähne: Branche, Hauptproblem, Ziel, ob Termin vereinbart. Auf Deutsch.' },
            { role:'user', content: transcriptText },
          ],
        }),
      });
      const sumData = await sumRes.json();
      summary = sumData.choices?.[0]?.message?.content || '';
    } catch(e) { console.warn('Summary failed:', e.message); }

    db.prepare(`
      UPDATE conversations
      SET duration_s=?, msg_count=?, user_count=?, ai_count=?, transcript=?, summary=?, lang=?
      WHERE id=?
    `).run(
      duration_s||0, transcript.length, userMsgs.length, aiMsgs.length,
      JSON.stringify(transcript), summary, lang||'de', id
    );

    console.log('Conversation updated, id:', id, '| msgs:', transcript.length);
    res.json({ success:true });
  } catch(err) {
    console.error('Update conversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Save Conversation + Generate Summary ─────────────────────────────────────
app.post('/save-conversation', async (req, res) => {
  try {
    const { transcript, duration_s, lang } = req.body;
    if (!transcript || transcript.length === 0)
      return res.json({ success: false, reason: 'empty' });

    const userMsgs = transcript.filter(m => m.role === 'user');
    const aiMsgs   = transcript.filter(m => m.role === 'ai');

    // ── Generate summary with GPT-4o-mini (cheap: ~$0.001 per call) ──
    let summary = '';
    try {
      const transcriptText = transcript
        .map(m => `${m.role === 'ai' ? 'AI' : 'Besucher'}: ${m.text}`)
        .join('\n');

      const sumRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 200,
          messages: [
            {
              role: 'system',
              content: 'Du bist ein Assistent. Fasse das folgende Verkaufsgespräch in 3-4 Sätzen zusammen. Erwähne: Branche/Unternehmen des Besuchers, sein Hauptproblem, sein Ziel, und ob ein Termin vereinbart wurde. Antworte auf Deutsch.',
            },
            { role: 'user', content: transcriptText },
          ],
        }),
      });
      const sumData = await sumRes.json();
      summary = sumData.choices?.[0]?.message?.content || '';
    } catch (e) {
      console.warn('Summary generation failed:', e.message);
    }

    const stmt = db.prepare(`
      INSERT INTO conversations (duration_s, msg_count, user_count, ai_count, transcript, summary, lang)
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
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Save conversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: Conversations list ─────────────────────────────────────────────────
app.get('/admin/conversations', (req, res) => {
  const conversations = db.prepare(`
    SELECT id, started_at, duration_s, msg_count, user_count, ai_count,
           summary, lang, contact_email, contact_phone
    FROM conversations ORDER BY started_at DESC
  `).all();
  res.json(conversations);
});

// ─── Admin: Delete conversation ────────────────────────────────────────────────
app.delete('/admin/conversations/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin: Single conversation detail ────────────────────────────────────────
app.get('/admin/conversations/:id', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Not found' });
  conv.transcript = JSON.parse(conv.transcript || '[]');
  res.json(conv);
});

// ─── Google Calendar: Get today's events ──────────────────────────────────────
app.get('/calendar/events', async (req, res) => {
  try {
    const calendarId = req.query.cal || process.env.GOOGLE_CALENDAR_ID || 'primary';
    const now   = new Date();
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
      id:          e.id,
      title:       e.summary || '—',
      description: e.description || '',
      start:       e.start?.dateTime || e.start?.date,
      end:         e.end?.dateTime   || e.end?.date,
      attendees:   (e.attendees || []).map(a => ({
        email:  a.email,
        name:   a.displayName || '',
        status: a.responseStatus,
      })),
    }));

    res.json({ calendar: calendarId, date: now.toLocaleDateString('de-CH'), events });
  } catch (err) {
    console.error('Calendar events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Google Calendar: Check availability ──────────────────────────────────────
app.get('/calendar/slots', async (req, res) => {
  try {
    const now      = new Date();
    const weekEnd  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: weekEnd.toISOString(),
        items: [{ id: process.env.GOOGLE_CALENDAR_ID || 'primary' }],
      },
    });

    const busy = response.data.calendars?.primary?.busy || [];

    // Generate available slots (9:00-17:00, 30 min each, next 7 days)
    const slots = [];
    for (let d = 1; d <= 7; d++) {
      const day = new Date(now);
      day.setDate(day.getDate() + d);
      day.setHours(0, 0, 0, 0);

      // Skip weekends
      if (day.getDay() === 0 || day.getDay() === 6) continue;

      for (let h = 9; h < 17; h++) {
        for (let m = 0; m < 60; m += 30) {
          const start = new Date(day);
          start.setHours(h, m, 0, 0);
          const end = new Date(start.getTime() + 30 * 60 * 1000);

          // Check if slot is free
          const isBusy = busy.some(b =>
            new Date(b.start) < end && new Date(b.end) > start
          );
          if (!isBusy) {
            slots.push({
              start: start.toISOString(),
              end:   end.toISOString(),
              label: start.toLocaleString('de-CH', {
                weekday:'short', day:'2-digit', month:'2-digit',
                hour:'2-digit', minute:'2-digit', timeZone:'Europe/Zurich'
              }),
            });
          }
        }
      }
    }

    res.json({ slots: slots.slice(0, 10) }); // return first 10 slots
  } catch (err) {
    console.error('Calendar error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Google Calendar: Next available slot (from tomorrow) ─────────────────────
app.get('/calendar/next-slot', async (req, res) => {
  try {
    const calId  = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const now    = new Date();
    // Start from tomorrow 00:00 Zurich
    const start  = new Date(now);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    const end    = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000); // 2 weeks ahead

    const fbRes  = await calendar.freebusy.query({
      requestBody: { timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: calId }] },
    });
    const busy = (fbRes.data.calendars?.[calId]?.busy || []).map(b => ({
      s: new Date(b.start), e: new Date(b.end),
    }));

    // Iterate day by day, 9-17, 30-min slots
    for (let d = 0; d < 14; d++) {
      const day = new Date(start);
      day.setDate(day.getDate() + d);
      const dow = day.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends

      for (let h = 9; h < 17; h++) {
        for (let m = 0; m < 60; m += 30) {
          const slotStart = new Date(day);
          slotStart.setHours(h, m, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
          const isBusy  = busy.some(b => b.s < slotEnd && b.e > slotStart);
          if (!isBusy) {
            const label = slotStart.toLocaleString('de-CH', {
              weekday: 'long', day: '2-digit', month: '2-digit',
              hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
            });
            return res.json({
              available: true,
              start: slotStart.toISOString(),
              end:   slotEnd.toISOString(),
              label,
            });
          }
        }
      }
    }
    res.json({ available: false, message: 'Keine freien Slots in den nächsten 14 Tagen' });
  } catch (err) {
    console.error('Next-slot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Google Calendar: Check specific slot, return nearest free if busy ─────────
app.get('/calendar/check-slot', async (req, res) => {
  try {
    const calId     = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const requested = new Date(req.query.datetime);
    if (isNaN(requested)) return res.status(400).json({ error: 'Invalid datetime' });

    const windowStart = new Date(requested.getTime() - 2 * 60 * 60 * 1000); // 2h before
    const windowEnd   = new Date(requested.getTime() + 4 * 60 * 60 * 1000); // 4h after

    const fbRes = await calendar.freebusy.query({
      requestBody: { timeMin: windowStart.toISOString(), timeMax: windowEnd.toISOString(), items: [{ id: calId }] },
    });
    const busy = (fbRes.data.calendars?.[calId]?.busy || []).map(b => ({
      s: new Date(b.start), e: new Date(b.end),
    }));

    const slotEnd = new Date(requested.getTime() + 30 * 60 * 1000);
    const isReqBusy = busy.some(b => b.s < slotEnd && b.e > requested);

    if (!isReqBusy) {
      const label = requested.toLocaleString('de-CH', {
        weekday: 'long', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
      });
      return res.json({ available: true, start: requested.toISOString(), end: slotEnd.toISOString(), label });
    }

    // Find nearest free slot — search ±3h in 30-min steps
    for (let offset = 30; offset <= 180; offset += 30) {
      for (const sign of [1, -1]) {
        const candidate    = new Date(requested.getTime() + sign * offset * 60 * 1000);
        const candidateEnd = new Date(candidate.getTime() + 30 * 60 * 1000);
        const h            = candidate.getHours();
        const dow          = candidate.getDay();
        if (dow === 0 || dow === 6 || h < 9 || h >= 17) continue;
        const isBusy = busy.some(b => b.s < candidateEnd && b.e > candidate);
        if (!isBusy) {
          const label = candidate.toLocaleString('de-CH', {
            weekday: 'long', day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
          });
          return res.json({ available: false, nearest: true, start: candidate.toISOString(), end: candidateEnd.toISOString(), label });
        }
      }
    }

    res.json({ available: false, nearest: false, message: 'Kein freier Slot in der Nähe gefunden' });
  } catch (err) {
    console.error('Check-slot error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Google Calendar: Book appointment ────────────────────────────────────────
app.post('/calendar/book', async (req, res) => {
  try {
    const { start, end, name, email, phone, business, budget, team_size } = req.body;

    // 1. Write to Google Calendar
    const computedEnd = end || new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
    const description = [
      `Name: ${name       || '—'}`,
      `Email: ${email     || '—'}`,
      `Telefon: ${phone   || '—'}`,
      `Unternehmen: ${business  || '—'}`,
      `Budget: ${budget   || '—'}`,
      `Teamgrösse: ${team_size || '—'}`,
    ].join('\n');

    let eventId = null;
    let eventLink = null;
    try {
      const event = await calendar.events.insert({
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        requestBody: {
          summary:     `15-Min Beratung — ${name || 'Kunde'}`,
          description,
          start: { dateTime: start,        timeZone: 'Europe/Zurich' },
          end:   { dateTime: computedEnd,  timeZone: 'Europe/Zurich' },
          attendees: email ? [{ email }] : [],
        },
      });
      eventId   = event.data.id;
      eventLink = event.data.htmlLink;
      console.log('Calendar event created:', eventId, name, start);
    } catch (calErr) {
      // Calendar write may fail if no write permission yet — continue to send email anyway
      console.warn('Calendar write skipped (no write access yet):', calErr.message);
    }

    // 2. Format appointment time nicely
    const apptDate = new Date(start).toLocaleString('de-CH', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich',
    });

    // 3. Send notification email to Future Media
    const internalHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#111;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#111;padding:24px 28px;display:flex;align-items:center;gap:14px;">
      <div>
        <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Future Media GmbH</div>
        <div style="color:#666;font-size:12px;margin-top:2px;">Neuer Beratungstermin — Voice AI</div>
      </div>
    </div>
    <div style="background:#f7f7f5;padding:28px 32px;">
      <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:4px;letter-spacing:-0.3px;">📅 Neuer Termin eingegangen</div>
      <div style="font-size:13px;color:#888;margin-bottom:22px;">Ein Interessent hat einen Termin über den Voice AI Assistenten gebucht.</div>
      <div style="background:#111;color:#fff;border-radius:10px;padding:16px 20px;margin-bottom:22px;">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Termin</div>
        <div style="font-size:17px;font-weight:700;letter-spacing:-0.3px;">${apptDate}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        ${[
          ['Name',        name       || '—'],
          ['E-Mail',      email      || '—'],
          ['Telefon',     phone      || '—'],
          ['Unternehmen', business   || '—'],
          ['Budget',      budget     || '—'],
          ['Teamgrösse',  team_size  || '—'],
        ].map(([k, v]) => `
          <tr style="border-bottom:1px solid #e8e8e5;">
            <td style="padding:10px 0;font-size:13px;color:#888;width:130px;">${k}</td>
            <td style="padding:10px 0;font-size:14px;color:#111;font-weight:500;">${v}</td>
          </tr>`).join('')}
      </table>
      ${eventLink ? `<a href="${eventLink}" style="display:inline-block;background:#111;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Im Kalender ansehen →</a>` : ''}
    </div>
    <div style="background:#111;padding:14px 32px;text-align:center;">
      <div style="font-size:11px;color:#555;">Future Media GmbH · Bern &amp; Zürich · info@future-media.ch</div>
    </div>
  </div>
</body></html>`;

    await mailer.sendMail({
      from:    '"Future Media AI" <' + (process.env.MAIL_USER) + '>',
      to:      process.env.MAIL_USER,
      subject: `📅 Neuer Termin: ${name || 'Kunde'} — ${apptDate}`,
      html:    internalHtml,
    });
    console.log('Booking email sent to team:', name, apptDate);

    // 4. Send confirmation email to user (only if email provided)
    if (email && /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(email)) {
      const userHtml = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#111;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#111;padding:24px 28px;">
      <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Future Media GmbH</div>
      <div style="color:#666;font-size:12px;margin-top:2px;">Schweizer Social Media Agentur</div>
    </div>
    <div style="background:#f7f7f5;padding:28px 32px;">
      <div style="font-size:20px;font-weight:700;color:#111;margin-bottom:4px;letter-spacing:-0.3px;">✅ Termin bestätigt</div>
      <div style="font-size:13px;color:#888;margin-bottom:22px;">Dein kostenloses 15-Minuten-Gespräch ist eingetragen.</div>
      <p style="font-size:14px;color:#444;margin:0 0 18px;line-height:1.7;">Hallo ${name || ''},<br>vielen Dank! Wir freuen uns auf unser Gespräch.</p>
      <div style="background:#111;color:#fff;border-radius:10px;padding:16px 20px;margin-bottom:22px;">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Dein Termin</div>
        <div style="font-size:17px;font-weight:700;letter-spacing:-0.3px;">📅 ${apptDate}</div>
      </div>
      <p style="font-size:13px;color:#777;line-height:1.7;margin:0 0 22px;">
        Unser Team meldet sich in Kürze bei dir.<br>
        Bei Fragen erreichst du uns unter
        <a href="mailto:info@future-media.ch" style="color:#111;font-weight:600;text-decoration:none;">info@future-media.ch</a>
        oder <a href="tel:+41787993517" style="color:#111;font-weight:600;text-decoration:none;">078 799 35 17</a>.
      </p>
      <div style="border-top:1px solid #e8e8e5;padding-top:18px;font-size:12px;color:#888;line-height:1.6;">
        <strong style="color:#111;">Future Media GmbH</strong><br>
        Weltpoststrasse 5, 3015 Bern · Hardstrasse 201, 8005 Zürich
      </div>
    </div>
    <div style="background:#111;padding:14px 32px;text-align:center;">
      <div style="font-size:11px;color:#555;">© 2026 Future Media GmbH · future-media.ch</div>
    </div>
  </div>
</body></html>`;

      await mailer.sendMail({
        from:    '"Future Media GmbH" <' + (process.env.MAIL_USER) + '>',
        to:      email,
        subject: `✅ Dein Beratungstermin – ${apptDate}`,
        html:    userHtml,
      });
      console.log('Confirmation email sent to user:', email);
    }

    res.json({ success: true, eventId, link: eventLink, appointment: apptDate });
  } catch (err) {
    console.error('Calendar book error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Voice AI running on http://localhost:${PORT}`);
});