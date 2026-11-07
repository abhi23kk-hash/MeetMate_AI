const path = require('node:path');
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const { createClient } = require('@supabase/supabase-js');

const backendRoot = __dirname;
const projectRoot = path.resolve(backendRoot, '..');
const frontendRoot = path.join(projectRoot, 'frontend');
const port = Number(process.env.PORT) || 3000;
try { process.loadEnvFile(path.join(projectRoot, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = supabaseUrl && supabaseKey
	? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
	: null;
const openRouterKey = process.env.OPENROUTER_API_KEY;
const openAiKey = process.env.OPENAI_API_KEY || openRouterKey;
const usingOpenRouter = !process.env.OPENAI_API_KEY && Boolean(openRouterKey);
const openai = openAiKey ? new OpenAI({
	apiKey: openAiKey,
	...(usingOpenRouter ? {
		baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
		defaultHeaders: { 'X-Title': 'MeetMate AI' }
	} : {})
}) : null;
const app = express();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 25 * 1024 * 1024, files: 1 },
	fileFilter: (_request, file, callback) => {
		const supported = /\.(mp3|m4a|wav|webm|mp4|mpeg|mpga|oga)$/i.test(file.originalname);
		callback(supported ? null : new Error('Upload an MP3, M4A, WAV, WEBM, or MP4 audio file.'), supported);
	}
});
const publicFiles = new Set([
	'homepage.html', 'New_Meeting.html', 'Meetings.html', 'app.css', 'sidebar.css', 'app.js',
	'desktop-type-scale.css', 'layout-fix.css', 'meetings-page.css', 'reference.css',
	'type-scale.css', 'hero.webp', 'side-robot.webp'
]);

function sendError(response, status, message) {
	return response.status(status).json({ error: message });
}

function requireSupabase(response) {
	if (supabase) return true;
	sendError(response, 503, 'Set SUPABASE_URL and SUPABASE_SECRET_KEY in the workspace .env file.');
	return false;
}

function sendSupabaseError(response, error, action) {
	if (error.code === 'PGRST205' || error.code === '42P01') {
		return sendError(response, 503, 'The Supabase meetings table is not ready. Run database/schema.sql in the Supabase SQL Editor.');
	}
	console.error(`Supabase ${action} failed:`, error.code || error.name);
	return sendError(response, 502, `Supabase could not ${action} the meeting. Check the meetings schema and server credentials.`);
}

function dateValue(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function openAiError(response, error, action) {
	console.error(`OpenAI ${action} failed:`, error.status || error.code || error.name);
	if (error.status === 429) return sendError(response, 429, 'OpenAI quota or rate limit reached. Check API billing and usage limits.');
	if (error.status === 401) return sendError(response, 502, 'OpenAI rejected the server key. Check OPENAI_API_KEY in .env.');
	return sendError(response, 502, `OpenAI could not ${action}. Check model access and provider status.`);
}

function fromDatabase(row) {
	return {
		id: row.id,
		title: row.title,
		date: row.date || '',
		endDate: row.end_date || '',
		mode: row.mode || '',
		participants: row.participants || [],
		transcript: row.transcript || '',
		summary: row.summary || '',
		actionItems: row.action_items || [],
		decisions: row.decisions || [],
		clarifications: row.clarifications || [],
		topics: row.topics || [],
		pendingTasks: row.pending_tasks || 0,
		notes: row.notes || '',
		createdAt: row.created_at
	};
}

function toDatabase(payload) {
	const arrayValue = (value, limit = 100) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, limit) : [];
	return {
		title: payload.title.trim().slice(0, 160),
		date: dateValue(payload.date),
		end_date: dateValue(payload.endDate),
		mode: typeof payload.mode === 'string' ? payload.mode.slice(0, 80) : '',
		participants: arrayValue(payload.participants),
		transcript: typeof payload.transcript === 'string' ? payload.transcript.slice(0, 50000) : '',
		summary: typeof payload.summary === 'string' ? payload.summary.slice(0, 5000) : '',
		action_items: arrayValue(payload.actionItems),
		decisions: arrayValue(payload.decisions),
		clarifications: arrayValue(payload.clarifications),
		topics: arrayValue(payload.topics),
		pending_tasks: Number.isInteger(payload.pendingTasks) ? Math.max(0, payload.pendingTasks) : arrayValue(payload.actionItems).length
	};
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/meetings', async (_request, response) => {
	if (!requireSupabase(response)) return;
	const { data, error } = await supabase.from('meetings').select('*').order('date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
	if (error) return sendSupabaseError(response, error, 'load');
	return response.json(data.map(fromDatabase));
});

app.post('/api/meetings', async (request, response) => {
	if (!requireSupabase(response)) return;
	if (typeof request.body.title !== 'string' || !request.body.title.trim()) return sendError(response, 400, 'A meeting title is required.');
	if ((request.body.date && !dateValue(request.body.date)) || (request.body.endDate && !dateValue(request.body.endDate))) return sendError(response, 400, 'Meeting date is invalid.');
	const row = toDatabase(request.body);
	const { data, error } = await supabase.from('meetings').insert(row).select('*').single();
	if (error) return sendSupabaseError(response, error, 'save');
	return response.status(201).json(fromDatabase(data));
});

app.patch('/api/meetings/:id', async (request, response) => {
	if (!requireSupabase(response)) return;
	const updates = {};
	if (typeof request.body.title === 'string' && request.body.title.trim()) updates.title = request.body.title.trim().slice(0, 160);
	if (typeof request.body.notes === 'string') updates.notes = request.body.notes.slice(0, 10000);
	if (!Object.keys(updates).length) return sendError(response, 400, 'No supported meeting fields were provided.');
	const { data, error } = await supabase.from('meetings').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', request.params.id).select('*').maybeSingle();
	if (error) return sendSupabaseError(response, error, 'update');
	if (!data) return sendError(response, 404, 'Meeting not found.');
	return response.json(fromDatabase(data));
});

app.delete('/api/meetings/:id', async (request, response) => {
	if (!requireSupabase(response)) return;
	const { data, error } = await supabase.from('meetings').delete().eq('id', request.params.id).select('id').maybeSingle();
	if (error) return sendSupabaseError(response, error, 'delete');
	if (!data) return sendError(response, 404, 'Meeting not found.');
	return response.status(204).end();
});

app.post('/api/analyze', async (request, response) => {
	if (!openai) return sendError(response, 503, 'Set OPENAI_API_KEY in the workspace .env file to enable AI insights.');
	const transcript = typeof request.body.transcript === 'string' ? request.body.transcript.trim().slice(0, 50000) : '';
	if (!transcript) return sendError(response, 400, 'A transcript is required.');
	try {
		const completion = await openai.chat.completions.create({
			model: process.env.OPENAI_MODEL || (usingOpenRouter ? 'openai/gpt-4.1-mini' : 'gpt-4o-mini'),
			max_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 1024,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: 'Analyze meeting transcripts. Return only JSON with keys summary (string), actionItems (array of strings), decisions (array of strings), clarifications (array of strings), and topics (array of strings). Do not invent details. Use empty arrays when there are none.' },
				{ role: 'user', content: transcript }
			]
		});
		const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
		const asStrings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 20) : [];
		return response.json({
			summary: typeof result.summary === 'string' ? result.summary.slice(0, 5000) : '',
			actionItems: asStrings(result.actionItems),
			decisions: asStrings(result.decisions),
			clarifications: asStrings(result.clarifications),
			topics: asStrings(result.topics)
		});
	} catch (error) {
		return openAiError(response, error, 'analyze this transcript');
	}
});

app.post('/api/transcribe', upload.single('file'), async (request, response) => {
	if (!process.env.OPENAI_API_KEY) return sendError(response, 503, 'Audio transcription requires OPENAI_API_KEY. OPENROUTER_API_KEY currently enables text insights only.');
	if (!request.file) return sendError(response, 400, 'Choose an audio file to transcribe.');
	try {
		const transcription = await openai.audio.transcriptions.create({
			file: await toFile(request.file.buffer, request.file.originalname, { type: request.file.mimetype }),
			model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'
		});
		return response.json({ transcript: transcription.text || '' });
	} catch (error) {
		return openAiError(response, error, 'transcribe this file');
	}
});

app.get('/', (_request, response) => response.redirect('/New_Meeting.html'));
app.get(/^\/(.+\.(?:html|css|js|webp))$/, (request, response, next) => {
	const fileName = path.basename(request.path);
	if (!publicFiles.has(fileName)) return response.sendStatus(404);
	response.sendFile(path.join(frontendRoot, fileName), (error) => { if (error) next(error); });
});
app.use('/api', (_request, response) => sendError(response, 404, 'API route not found.'));
app.use((_request, response) => response.status(404).send('Not found'));
app.use((error, _request, response, _next) => {
	if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return sendError(response, 413, 'Audio files must be 25 MB or smaller.');
	if (error.message?.startsWith('Upload an MP3')) return sendError(response, 415, error.message);
	console.error('Request failed:', error.name || 'Error');
	return sendError(response, 500, 'The request could not be completed.');
});

app.listen(port, () => console.log(`MeetMate server running at http://localhost:${port}`));
