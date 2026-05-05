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
    user: 'alimagani@gmail.com',
    pass: 'gwbbmplegcuajkxn',
  },
});

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
      from:    '"Future Media AI" <alimagani@gmail.com>',
      to:      'alimagani@gmail.com',
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

app.listen(PORT, () => {
  console.log(`Voice AI running on http://localhost:${PORT}`);
});